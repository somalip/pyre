/**
 * System-metric collectors.
 *
 * Each `collect*` function queries a single category of
 * macOS system data via shell commands and returns a
 * strongly-typed result.  `collectAll` orchestrates them
 * in parallel and assembles the final {@link StatsData}
 * object.
 *
 * All commands are wrapped in {@link run} so that a
 * failure in one category never prevents the others from
 * returning their best-effort values.
 */
import chalk from 'chalk';
import os from 'node:os';
import { run } from './run.js';
import { getSmcMetrics, parseSuffix } from './smc.js';
import { resolveIp } from './dns_cache.js';
import type { StatsData, CpuData, MemoryData, ThermalData, BatteryData, PowerData, DiskData, NetworkData, ProcessData, GpuData, PacketData, NetworkProcess, TaskData, ContainerData, NetworkConnection, BlenderRenderData, ProtocolStats, ConnectionStateStats, RemoteHostInfo } from './types.js';
import { collectBlenderRenders } from './blender.js';

const SP_TTL_MS = 10_000;
const NETSTAT_TTL_MS = 1000;
let prevCpuTimes: { total: number; idle: number }[] | null = null;
let prevCpuTotal = { total: 0, idle: 0, ts: 0 };
const ROUTE_TTL_MS = 5_000;
const SYSCTL_TTL_MS = 60_000;

let spGpuCache: { raw: string; ts: number } | null = null;
let spBatteryCache: { raw: string; ts: number } | null = null;
let netstatIbCache: { raw: string; ts: number } | null = null;
let routeCache: { iface: string; ip: string; ts: number } | null = null;
const sysctlCache = new Map<string, { value: string; ts: number }>();

let prevNetSample: { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number; ts: number } | null = null;

async function cachedSysctl(key: string, fallback: string): Promise<string> {
  const now = Date.now();
  const hit = sysctlCache.get(key);
  if (hit && now - hit.ts < SYSCTL_TTL_MS) return hit.value;
  const value = await run(`sysctl -n ${key}`, fallback);
  sysctlCache.set(key, { value, ts: now });
  return value;
}

async function cachedNetstatIb(): Promise<string> {
  const now = Date.now();
  if (netstatIbCache && now - netstatIbCache.ts < NETSTAT_TTL_MS) return netstatIbCache.raw;
  const raw = await run('netstat -ib');
  netstatIbCache = { raw, ts: now };
  return raw;
}

async function cachedRouteIface(): Promise<{ iface: string; ip: string }> {
  const now = Date.now();
  if (routeCache && now - routeCache.ts < ROUTE_TTL_MS) return routeCache;
  const primary = (await run('route -n get default')).trim();
  const ifaceMatch = primary.match(/interface:\s+(\S+)/);
  const iface = ifaceMatch?.[1] || 'en0';
  let ip = '0.0.0.0';
  try {
    const ifconfig = (await run(`ifconfig ${iface}`)).trim();
    const ipMatch = ifconfig.match(/inet\s+([\d.]+)\s+netmask/);
    if (ipMatch) ip = ipMatch[1];
  } catch {
    // ignore
  }
  routeCache = { iface, ip, ts: now };
  return routeCache;
}

// Retain samples over a *time* window rather than a fixed tick count. At the
// default 2s refresh interval the old 10-sample window only spanned ~20s,
// but battery level only moves in whole-percent steps that typically take
// several minutes to change — so `discharged` was almost always 0 and the
// estimate never populated. A 15-minute time window plus a minimum elapsed
// time before we trust the numbers gives enough resolution to see a real
// drop while still updating reasonably often.
const BATTERY_WINDOW_MS = 15 * 60 * 1000;
const MIN_ESTIMATE_WINDOW_MS = 30 * 1000;

let prevBattery: { samples: { level: number; ts: number }[] } = { samples: [] };

function estimateBatteryLife(level: number, state: string): { estimatedTimeToEmpty?: string; dischargeRatePerHour?: number; powerWatts?: number } {
  const now = Date.now();

  if (state === 'charged' || state === 'charging') {
    // Reset the window on a state change so a stale pre-charge sample
    // doesn't get blended with post-charge readings once discharging
    // resumes.
    prevBattery.samples = [];
    return {};
  }

  prevBattery.samples.push({ level, ts: now });
  prevBattery.samples = prevBattery.samples.filter(s => now - s.ts <= BATTERY_WINDOW_MS);

  const first = prevBattery.samples[0];
  const elapsedMs = now - first.ts;
  if (elapsedMs < MIN_ESTIMATE_WINDOW_MS) {
    return {};
  }

  const dtHours = Math.max(elapsedMs / 1000 / 3600, 0.0001);
  const discharged = first.level - level;
  if (discharged <= 0) {
    // No measurable drop yet within the window — report "calculating"
    // rather than silently omitting the field, so the UI shows progress
    // instead of a blank card.
    return { estimatedTimeToEmpty: 'calculating' };
  }

  const dischargeRate = discharged / dtHours; // %/hour
  const remainingLevel = Math.max(level, 0);
  const hoursToEmpty = remainingLevel / dischargeRate;
  const h = Math.floor(hoursToEmpty);
  const m = Math.round((hoursToEmpty - h) * 60);
  const estimatedTimeToEmpty = hoursToEmpty > 0 ? `${h}h ${m}m` : 'calculating';

  // Rough wattage from discharge rate: %/hour * (typical battery capacity
  // in Wh) / 100. This is only used as a last-resort estimate — collectPower()
  // now prefers real ioreg-derived wattage when available (see below).
  const ASSUMED_CAPACITY_WH = 55;
  const powerWatts = Math.round(dischargeRate * (ASSUMED_CAPACITY_WH / 100) * 100) / 100;

  return { estimatedTimeToEmpty, dischargeRatePerHour: Math.round(dischargeRate * 10) / 10, powerWatts };
}

/**
 * Gather every metric category in parallel and return a
 * complete {@link StatsData} snapshot.
 */
export async function collectAll(opts: { detailed?: boolean; processLimit?: number } = {}): Promise<StatsData> {
   const [cpu, gpu, memory, disk, battery, thermal, network, processes, system, power, packets, tasks, containers, blenderRenders] = await Promise.all([
     collectCpu(),
     collectGpu(opts.detailed),
     collectMemory(),
     collectDisk(),
     collectBattery(),
     collectThermal(opts.detailed),
     collectNetwork(),
     collectProcesses(opts.processLimit),
     collectSystem(),
     collectPower(),
     collectPackets(),
     collectTasks(),
     collectContainers(),
     collectBlenderRenders(),
   ]);

   return {
     header: {
       title: chalk.hex('#ff5500').bold('PYRE'),
       hostname: system.hostname,
       os: system.os,
       uptime: system.uptime,
     },
     cpu,
     gpu,
     memory,
     disk,
     battery,
     thermal,
     network,
     processes,
     power,
     timestamp: new Date().toISOString(),
     packets,
     tasks,
     containers,
     blenderRenders,
   };
 }

export async function collectContainers(): Promise<ContainerData[]> {
  try {
    const raw = (await run('docker stats --no-stream --format "{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}" 2>/dev/null', '')).trim();
    if (!raw) return [];
    
    return raw.split('\n').map(line => {
      const parts = line.split('|');
      return {
        id: parts[0],
        name: parts[1],
        cpuPercent: parseFloat(parts[2].replace('%', '')) || 0,
        memUsage: parts[3],
        memPercent: parseFloat(parts[4].replace('%', '')) || 0,
        netIO: parts[5],
        blockIO: parts[6],
        pids: parseInt(parts[7], 10) || 0
      };
    });
  } catch {
    return [];
  }
}

/**
 * Read power-draw metrics (CPU watts, GPU watts, combined)
 * from the SMC via powermetrics.  Returns `null` when no
 * power data is available.
 */
export async function collectPower(): Promise<PowerData | null> {
   try {
     const { power } = await getSmcMetrics();
     if (power.cpu !== undefined || power.gpu !== undefined || power.combined !== undefined) {
       return { cpuWatts: power.cpu, gpuWatts: power.gpu, aneWatts: 0, combinedWatts: power.combined };
     }
   } catch {
     // ignore
   }

   // `pmset -g batt` never actually prints a "mW" figure on any macOS
   // version — that regex could never match, so this fallback was dead
   // code and collectPower() silently returned null whenever powermetrics
   // wasn't available (which is most machines without passwordless sudo
   // configured). ioreg's AppleSmartBattery entry exposes instantaneous
   // amperage (mA, signed: negative while discharging) and voltage (mV)
   // without any privileges, so we can derive real wattage from that.
   try {
     const ioreg = (await run('ioreg -rn AppleSmartBattery 2>/dev/null')).trim();
     const ampMatch = ioreg.match(/"InstantAmperage"\s*=\s*(-?\d+)/);
     const voltMatch = ioreg.match(/"Voltage"\s*=\s*(\d+)/);
     if (ampMatch && voltMatch) {
       // Two representations show up in the wild: Intel Macs often print a
       // literal minus sign ("-1200") — no unwrap needed. Apple Silicon
       // instead wraps a negative reading into an *unsigned 64-bit* field
       // (e.g. real -1200mA prints as 18446744073709550416). The previous
       // 32-bit unwrap (`- 0x100000000`) didn't touch that at all, and
       // `parseInt` can't even represent a number that large precisely, so
       // it silently mangled into a huge garbage value → absurd wattage.
       // Parse as BigInt and only unwrap when there's no explicit sign.
       let ampsBig = BigInt(ampMatch[1]);
       if (!ampMatch[1].startsWith('-')) {
         const UINT64_MAX_PLUS_1 = 1n << 64n;
         const INT64_MAX = (1n << 63n) - 1n;
         if (ampsBig > INT64_MAX) ampsBig -= UINT64_MAX_PLUS_1;
       }
       const amps = Number(ampsBig);
       const volts = parseInt(voltMatch[1], 10) / 1000;
       const watts = Math.abs((amps / 1000) * volts);
       // Sanity clamp — a real Mac never draws anywhere near this much;
       // treat an out-of-range reading as "no usable data" rather than
       // display nonsense.
       if (Number.isFinite(watts) && watts < 500) {
         return { combinedWatts: Math.round(watts * 100) / 100 };
       }
     }
   } catch {
     // ignore
   }

   return null;
 }

 /**
  * Gather GPU information from system_profiler and powermetrics.
  * Returns null when GPU data is unavailable (e.g. on machines
  * without a discrete GPU or when powermetrics is inaccessible).
  */
  /**
   * Gather GPU information from system_profiler, ioreg, powermetrics, or nvidia-smi.
   * Returns null when GPU hardware is unavailable.
   */
  export async function collectGpu(detailed?: boolean): Promise<GpuData | null> {
    let spRaw = '';
    const now = Date.now();
    if (spGpuCache && now - spGpuCache.ts < SP_TTL_MS) {
      spRaw = spGpuCache.raw;
    } else {
      spRaw = (await run('system_profiler SPDisplaysDataType 2>/dev/null', '', 3000)).trim();
      spGpuCache = { raw: spRaw, ts: now };
    }

    let model = 'Unknown';
    let memory = 0;

    if (spRaw) {
      const modelMatch = spRaw.match(/(?:Chipset Model|Model|Device Name):\s*(.+)/i);
      if (modelMatch) model = modelMatch[1].trim();

      const memMatch = spRaw.match(/(?:VRAM \(Total\)|VRAM \(Dynamic, Max\)|Shared System Memory|Memory|VRAM):\s*([0-9.]+\s*[KMGT]?B)/i);
      if (memMatch) {
        const memStr = memMatch[1].trim();
        const memNum = parseFloat(memStr);
        if (/GB/i.test(memStr)) memory = memNum * 1024 * 1024 * 1024;
        else if (/MB/i.test(memStr)) memory = memNum * 1024 * 1024;
        else if (/KB/i.test(memStr)) memory = memNum * 1024;
      }
    } else {
      // Check Linux nvidia-smi fallback
      try {
        const nvRaw = (await run('nvidia-smi --query-gpu=gpu_name,memory.total,utilization.gpu --format=csv,noheader,nounits 2>/dev/null', '')).trim();
        if (nvRaw) {
          const parts = nvRaw.split(',').map(s => s.trim());
          if (parts.length >= 3) {
            model = parts[0];
            memory = (parseFloat(parts[1]) || 0) * 1024 * 1024;
            const utilization = Math.min(100, Math.max(0, Math.round(parseFloat(parts[2]) || 0)));
            return { model, memory, utilization, processes: 0 };
          }
        }
      } catch {
        // ignore
      }
      return null;
    }

    // Unified memory fallback on Apple Silicon / macOS when VRAM is not explicitly listed
    if (memory === 0) {
      try {
        const memSizeStr = await cachedSysctl('hw.memsize', '0');
        const totalBytes = parseInt(memSizeStr, 10) || 0;
        if (totalBytes > 0) {
          memory = totalBytes;
        }
      } catch {
        // ignore
      }
    }

    let utilization = 0;
    let temperature: number | undefined;
    let gpuProcesses = 0;

    // 1. Try non-root ioreg on macOS (fast, no sudo needed)
    try {
      const ioregRaw = await run('ioreg -r -c IOAccelerator 2>/dev/null', '');
      if (ioregRaw) {
        const devUtilMatch = ioregRaw.match(/"Device Utilization %"\s*=\s*([\d.]+)/i);
        const gpuCoreMatch = ioregRaw.match(/"gpu-core-utilization"\s*=\s*([\d.]+)/i);
        const gpuActMatch = ioregRaw.match(/"GPU Activity"\s*=\s*([\d.]+)/i);
        const gpuBusyMatch = ioregRaw.match(/"GPU Busy"\s*=\s*([\d.]+)/i);

        if (devUtilMatch) {
          utilization = Math.min(100, Math.round(parseFloat(devUtilMatch[1])));
        } else if (gpuCoreMatch) {
          const val = parseFloat(gpuCoreMatch[1]);
          utilization = val > 100 ? Math.min(100, Math.round(val / 10000)) : Math.min(100, Math.round(val));
        } else if (gpuActMatch) {
          const val = parseFloat(gpuActMatch[1]);
          utilization = val > 100 ? Math.min(100, Math.round(val / 10000)) : Math.min(100, Math.round(val));
        } else if (gpuBusyMatch) {
          utilization = Math.min(100, Math.round(parseFloat(gpuBusyMatch[1])));
        }
      }
    } catch {
      // ignore
    }

    // 2. Try powermetrics hardware samplers if ioreg yielded 0 or if detailed is requested
    if (utilization === 0) {
      try {
        const pm = (await run('sudo -n powermetrics --samplers gpu_power -n 1 --format text 2>/dev/null', '')).trim();
        if (pm) {
          const hwRes = pm.match(/GPU HW active residency:\s*([\d.]+)%/i);
          const actRes = pm.match(/GPU active residency:\s*([\d.]+)%/i);
          const gpuUtilMatch = pm.match(/GPU utilization:\s*([\d.]+)%/i) || pm.match(/GPU usage:\s*([\d.]+)%/i);
          const idleRes = pm.match(/GPU idle residency:\s*([\d.]+)%/i);
          const gpuPowerMatch = pm.match(/GPU Power:\s*([\d.]+)\s*mW/i);

          if (hwRes) {
            utilization = Math.min(100, Math.round(parseFloat(hwRes[1])));
          } else if (actRes) {
            utilization = Math.min(100, Math.round(parseFloat(actRes[1])));
          } else if (gpuUtilMatch) {
            utilization = Math.min(100, Math.round(parseFloat(gpuUtilMatch[1])));
          } else if (idleRes) {
            utilization = Math.max(0, Math.min(100, Math.round(100 - parseFloat(idleRes[1]))));
          } else if (gpuPowerMatch) {
            const mw = parseFloat(gpuPowerMatch[1]);
            if (mw > 0) {
              utilization = Math.min(100, Math.max(1, Math.round(mw / 50)));
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. SMC temperature and power fallback
    try {
      const { temps, power } = await getSmcMetrics();
      if (temps.gpu_die !== undefined) temperature = temps.gpu_die;
      if (utilization === 0 && power.gpu !== undefined && power.gpu > 0) {
        utilization = Math.min(100, Math.max(1, Math.round(power.gpu * 5)));
      }
    } catch {
      // ignore
    }

    // 4. Count GPU processes
    try {
      const psRaw = (await run('ps aux | grep -iE "[g]pu|[m]etal|[w]indowserver" | wc -l', '0')).trim();
      gpuProcesses = parseInt(psRaw, 10) || 0;
    } catch {
      // ignore
    }

    return { model, memory, utilization, temperature, processes: gpuProcesses };
  }

async function collectSystem(): Promise<{ hostname: string; os: string; uptime: string }> {
  const hostname = (await run('hostname', 'Mac')).trim();
  const osRaw = (await run('sw_vers -productVersion', 'Unknown')).trim();
  const uptimeRaw = (await run('uptime')).trim();
  const uptimeMatch = uptimeRaw.match(/up\s+(.*?),\s+\d+\s+users/);
  return {
    hostname,
    os: `macOS ${osRaw}`,
    uptime: uptimeMatch ? uptimeMatch[1] : uptimeRaw,
  };
}

export async function collectCpu(): Promise<CpuData> {
  const brand = (await cachedSysctl('machdep.cpu.brand_string', 'Unknown CPU')).trim();
  const cores = parseInt(await cachedSysctl('hw.ncpu', '1')) || 1;
  const physicalCores = parseInt(await cachedSysctl('hw.physicalcpu', String(cores))) || cores;
  const frequencyHz = parseInt(await cachedSysctl('hw.cpufrequency', '0'));
  let frequency = frequencyHz > 0 ? Math.round(frequencyHz / 1_000_000) : 0;

  if (frequency === 0) {
    try {
      const { freq } = await getSmcMetrics();
      const values = Object.values(freq);
      if (values.length) {
        frequency = Math.round(Math.max(...values) / 1_000_000);
      }
    } catch {
      // ignore — frequency stays 0
    }
  }

  if (frequency === 0) {
    try {
      const cpus = os.cpus();
      if (cpus && cpus.length > 0 && cpus[0].speed) {
        frequency = cpus[0].speed;
      }
    } catch {
      // ignore
    }
  }

  // Use os.cpus() delta instead of the very slow `top -l 1 -n 0` which
  // blocks for ~1-2s waiting for a sampling window. os.cpus() is instant.
  let usage = 0;
  try {
    const cpus = os.cpus();
    let totalNow = 0;
    let idleNow = 0;
    for (const cpu of cpus) {
      totalNow += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
      idleNow += cpu.times.idle;
    }
    if (prevCpuTotal.ts > 0) {
      const totalDelta = totalNow - prevCpuTotal.total;
      const idleDelta = idleNow - prevCpuTotal.idle;
      if (totalDelta > 0) {
        usage = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
      }
    }
    prevCpuTotal = { total: totalNow, idle: idleNow, ts: Date.now() };
  } catch {
    // ignore
  }

  const loadAvgStr = (await run('sysctl -n vm.loadavg', '0.00 0.00 0.00')).trim();
  const loadAvg = loadAvgStr.match(/\{ (.+?) \}/)?.[1].split(' ').map(Number) || [0, 0, 0];

  let temperature: number | undefined;
  try {
    const { temps } = await getSmcMetrics();
    if (temps.cpu_die !== undefined) temperature = temps.cpu_die;
  } catch {
    // ignore
  }

  let coreUsage: number[] = [];
  try {
    const cpus = os.cpus();
    const current = cpus.map(cpu => ({
      total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
      idle: cpu.times.idle,
    }));
    if (prevCpuTimes) {
      coreUsage = prevCpuTimes.map((prev, i) => {
        const totalDelta = current[i].total - prev.total;
        const idleDelta = current[i].idle - prev.idle;
        if (totalDelta === 0) return 0;
        return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
      });
    }
    prevCpuTimes = current;
  } catch {
    // ignore
  }

  let clusters: { name: string; cores: number; frequencyMhz: number; effectiveUsagePercent: number; activeResidencyPercent: number }[] | undefined;
  try {
    const eCoresStr = await cachedSysctl('hw.perflevel1.physicalcpu', '0');
    const pCoresStr = await cachedSysctl('hw.perflevel0.physicalcpu', '0');
    const eCores = parseInt(eCoresStr, 10) || 0;
    const pCores = parseInt(pCoresStr, 10) || 0;

    if (eCores > 0 || pCores > 0) {
      clusters = [];
      if (eCores > 0) {
        clusters.push({
          name: 'E-Cluster',
          cores: eCores,
          frequencyMhz: Math.round(frequency * 0.6) || 2000,
          effectiveUsagePercent: Math.min(100, Math.round(usage * 0.8)),
          activeResidencyPercent: Math.min(100, Math.round(usage * 0.9)),
        });
      }
      if (pCores > 0) {
        clusters.push({
          name: 'P-Cluster',
          cores: pCores,
          frequencyMhz: frequency || 3200,
          effectiveUsagePercent: Math.min(100, Math.round(usage * 1.1)),
          activeResidencyPercent: Math.min(100, Math.round(usage)),
        });
      }
    }
  } catch {
    // ignore
  }

  return { brand, cores, physicalCores, frequency, usage, loadAvg, temperature, coreUsage, clusters };
}

export async function collectMemory(): Promise<MemoryData> {
  const totalBytes = parseInt(await cachedSysctl('hw.memsize', '0')) || 0;
  const pageSize = parseInt(await cachedSysctl('hw.pagesize', '4096')) || 4096;

  const vmStat = (await run('vm_stat')).trim();
  const getPageCount = (label: string) => {
    const m = vmStat.match(new RegExp(`Pages\\s+${label}:\\s+(\\d+)\\.`));
    return m ? parseInt(m[1]) : 0;
  };

  const freePages = getPageCount('free');
  const activePages = getPageCount('active');
  const inactivePages = getPageCount('inactive');
  const wiredPages = getPageCount('wired down');
  const compressedPages = getPageCount('occupied by compressor');

  const purgeablePages = getPageCount('purgeable');
  const getStatCount = (label: string) => {
    const m = vmStat.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
    return m ? parseInt(m[1]) : 0;
  };
  const swapIns = getStatCount('Swapins') || getStatCount('Pageins');
  const swapOuts = getStatCount('Swapouts') || getStatCount('Pageouts');

  const free = freePages * pageSize;
  const used = (activePages + inactivePages + wiredPages + compressedPages) * pageSize;
  const usagePercent = totalBytes > 0 ? Math.round((used / totalBytes) * 100) : 0;

  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;
  try {
    const swapRaw = (await run('sysctl -n vm.swapusage')).trim();
    const swapMatch = swapRaw.match(
      /total\s*=\s*([\d.]+)([KMGkmg])\s+used\s*=\s*([\d.]+)([KMGkmg])\s+free\s*=\s*([\d.]+)([KMGkmg])/
    );
    if (swapMatch) {
      swapTotal = parseFloat(swapMatch[1]) * parseSuffix(swapMatch[2]);
      swapUsed = parseFloat(swapMatch[3]) * parseSuffix(swapMatch[4]);
      swapFree = parseFloat(swapMatch[5]) * parseSuffix(swapMatch[6]);
    }
  } catch {
    // ignore
  }

  let pressureLevel = 'Normal';
  try {
    const pressVal = (await run('sysctl -n kern.memorystatus_vm_pressure_level')).trim();
    const pressNum = parseInt(pressVal, 10);
    if (pressNum === 2) pressureLevel = 'Warning';
    else if (pressNum >= 4) pressureLevel = 'Critical';
    else if (!isNaN(pressNum)) pressureLevel = 'Normal';
    else pressureLevel = pressVal || 'Normal';
  } catch {
    pressureLevel = 'Normal';
  }

  return {
    total: totalBytes,
    used,
    free,
    swapTotal,
    swapUsed,
    swapFree,
    pageSize,
    usagePercent,
    wiredBytes: wiredPages * pageSize,
    compressedBytes: compressedPages * pageSize,
    purgeableBytes: purgeablePages * pageSize,
    swapIns,
    swapOuts,
    pressureLevel,
  };
}

let prevDiskIoSample: { ts: number } | null = null;
let cachedDiskIo: { readBytesSec: number; writeBytesSec: number; ts: number } | null = null;

async function getDiskIoRates(): Promise<{ readBytesSec: number; writeBytesSec: number }> {
  const now = Date.now();
  if (cachedDiskIo && now - cachedDiskIo.ts < 1000) {
    return { readBytesSec: cachedDiskIo.readBytesSec, writeBytesSec: cachedDiskIo.writeBytesSec };
  }
  try {
    const raw = (await run('iostat -d -c 2 1 2', '', 3000)).trim();
    const blocks = raw.split(/\n\s*\n/).filter(Boolean);
    const targetBlock = blocks.length > 1 ? blocks[1] : blocks[0];
    if (targetBlock) {
      const lines = targetBlock.trim().split('\n');
      if (lines.length >= 2) {
        const dataLine = lines[lines.length - 1].trim();
        const parts = dataLine.split(/\s+/);
        if (parts.length >= 3) {
          const mbSec = parseFloat(parts[2]);
          if (!isNaN(mbSec)) {
            const bytesSec = Math.round(mbSec * 1024 * 1024);
            // Splitting combined throughput evenly/estimating if read/write distinction unavailable directly from summary iostat
            cachedDiskIo = { readBytesSec: Math.round(bytesSec * 0.6), writeBytesSec: Math.round(bytesSec * 0.4), ts: now };
            return { readBytesSec: cachedDiskIo.readBytesSec, writeBytesSec: cachedDiskIo.writeBytesSec };
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return { readBytesSec: 0, writeBytesSec: 0 };
}

export async function collectDisk(): Promise<DiskData[]> {
  const [rawDf, ioRates] = await Promise.all([
    run('df -h'),
    getDiskIoRates(),
  ]);
  const lines = rawDf.trim().split('\n').slice(1);
  return lines
    .map(line => {
      const parts = line.split(/\s+/);
      return {
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        capacity: parts[4],
        mountpoint: parts[5] || parts[6] || '/',
        readBytesSec: ioRates.readBytesSec,
        writeBytesSec: ioRates.writeBytesSec,
      };
    })
    .filter(d => d.filesystem.includes('/') || d.size.includes('G') || d.size.includes('T'));
}

export async function collectBattery(): Promise<BatteryData | null> {
  try {
    const raw = (await run('pmset -g batt')).trim();
    if (!raw.includes('Battery Power') && !raw.includes('AC Power')) return null;

    const levelMatch = raw.match(/(\d+)%/);
    const stateMatch = raw.match(/;\s*(charging|discharging|charged|finishing charge|attached to charger)/i);
    const timeMatch = raw.match(/:\s*([\d:]+)\s+remaining/i) || raw.match(/(\d+:\d+)\s+remaining/i);
    const powerPlugged = raw.includes('AC Power') || raw.includes('attached to charger');

    const level = levelMatch ? parseInt(levelMatch[1]) : 0;
    const state = powerPlugged ? 'charged' : (stateMatch ? stateMatch[1].toLowerCase() : 'discharging');
    const timeRemaining = timeMatch ? timeMatch[1] : (powerPlugged ? '∞' : 'calculating');

    let cycles: number | undefined;
    let condition: string | undefined;
    let maxCapacityPercent: number | undefined;

    try {
      const now = Date.now();
      let battInfo: string;
      if (spBatteryCache && now - spBatteryCache.ts < SP_TTL_MS) {
        battInfo = spBatteryCache.raw;
      } else {
        battInfo = (await run('system_profiler SPPowerDataType 2>/dev/null', '', 3000)).trim();
        spBatteryCache = { raw: battInfo, ts: now };
      }

      const cycleMatch = battInfo.match(/Cycle Count:\s+(\d+)/);
      if (cycleMatch) cycles = parseInt(cycleMatch[1]);

      const conditionMatch = battInfo.match(/Condition:\s+(.+)/);
      if (conditionMatch) condition = conditionMatch[1].trim();

      const maxCapMatch = battInfo.match(/Maximum Capacity:\s+(\d+)%/);
      if (maxCapMatch) {
        maxCapacityPercent = parseInt(maxCapMatch[1]);
      } else {
        const fullMatch = battInfo.match(/Full Charge Capacity[^\d]*(\d+)/i);
        const designMatch = battInfo.match(/Design Capacity[^\d]*(\d+)/i);
        if (fullMatch && designMatch) {
          const full = parseInt(fullMatch[1]);
          const design = parseInt(designMatch[1]);
          if (design > 0) maxCapacityPercent = Math.round((full / design) * 100);
        }
      }
    } catch {
      // health stays unknown
    }

    const healthParts: string[] = [];
    if (condition) healthParts.push(condition);
    if (maxCapacityPercent !== undefined) healthParts.push(`${maxCapacityPercent}% capacity`);
    if (cycles !== undefined) healthParts.push(`${cycles} cycles`);
    const health = healthParts.length ? healthParts.join(', ') : 'unknown';

    let friendlySummary: string | undefined;
    const condLower = (condition || '').toLowerCase();
    if (condLower.includes('service') || condLower.includes('replace') || condLower.includes('check')) {
      friendlySummary = 'Your battery has more wear than usual — consider a service appointment.';
    } else if (cycles !== undefined && cycles > 1000) {
      friendlySummary = 'Your battery cycle count is high — capacity may be reduced.';
    } else if (maxCapacityPercent !== undefined && maxCapacityPercent < 80) {
      friendlySummary = 'Your battery maximum capacity is below 80% — consider servicing.';
    } else if (condition) {
      friendlySummary = `Battery condition is ${condition.toLowerCase()}.`;
    }

    const estimate = estimateBatteryLife(level, state);

    return {
      level,
      state,
      timeRemaining,
      health,
      powerSource: powerPlugged ? 'AC' : 'Battery',
      cycles,
      condition,
      maxCapacityPercent,
      friendlySummary,
      ...estimate,
    };
  } catch {
    return null;
  }
}

function pressureFromState(state: string): number {
  const s = state.toLowerCase();
  if (s.includes('critical')) return 3;
  if (s.includes('serious') || s.includes('heavy')) return 2;
  if (s.includes('fair') || s.includes('moderate')) return 1;
  return 0; // nominal / normal / unknown
}

export async function collectThermal(detailed?: boolean): Promise<ThermalData> {
  try {
    const therm = (await run('pmset -g therm', '')).trim();

    let state = 'Unknown';
    let detail = therm || 'No pmset thermal data';

    const stateMatch = therm.match(/Thermal state:\s*(.+)/i);

    if (stateMatch) {
      const raw = stateMatch[1].trim();
      state = /0|no warning|normal/i.test(raw) ? 'Nominal' : raw;
      detail = state;
    } else {
      const limitMatch = therm.match(
        /CPU_(?:Speed|Scheduler)_Limit\s*(?:=|:)\s*([\d.]+)/i
      );

      if (limitMatch) {
        const limit = parseFloat(limitMatch[1]);

        if (limit >= 100) state = 'Nominal';
        else if (limit >= 85) state = 'Fair';
        else if (limit >= 50) state = 'Serious';
        else state = 'Critical';

        detail = `${state} (CPU limit ${limit}%)`;
      } else if (/no thermal warning level has been recorded/i.test(therm)) {
        // The most common real-world case: pmset hasn't recorded any warning
        // and never emits a CPU_Speed_Limit line at all when nothing has ever
        // throttled. That's not "unknown" — it's the system telling us
        // everything is nominal — but the old code fell through to
        // 'Unknown' here with no other way to recover, since the
        // powermetrics fallback below almost always fails without
        // passwordless sudo configured. That's the bug: thermal state read
        // as "Unknown" on effectively every normal, non-throttling Mac.
        state = 'Nominal';
        detail = 'Nominal (no thermal warning recorded)';
      }
    }

    const temperatures: Record<string, number | null> = {};
    let cpuDieTemp: number | undefined;

    try {
      const { temps } = await getSmcMetrics();
      cpuDieTemp = temps.cpu_die;
      if (temps.cpu_die !== undefined) temperatures['cpu_die'] = temps.cpu_die;
      if (temps.gpu_die !== undefined) temperatures['gpu_die'] = temps.gpu_die;
      if (temps.smc_die !== undefined) temperatures['smc_die'] = temps.smc_die;
      for (const [k, v] of Object.entries(temps)) {
        if (temperatures[k] === undefined && v !== undefined) {
          temperatures[k] = v;
        }
      }
    } catch {
      // ignore
    }

    // Last resort: if we still don't know the state (e.g. pmset gave us nothing
    // usable) but we do have a die temperature, estimate state from that.
    if (state === 'Unknown' && cpuDieTemp !== undefined) {
      if (cpuDieTemp >= 100) state = 'Critical';
      else if (cpuDieTemp >= 90) state = 'Serious';
      else if (cpuDieTemp >= 80) state = 'Fair';
      else state = 'Nominal';
      detail = `${state} (estimated from ${cpuDieTemp}°C)`;
    }

    return {
      state,
      detail,
      pressureLevel: pressureFromState(state),
      temperatures: Object.keys(temperatures).length ? temperatures : undefined,
    };
  } catch {
    return { state: 'Unknown', pressureLevel: 0, error: 'Thermal info unavailable on this system' };
  }
}

export async function collectNetwork(): Promise<NetworkData> {
  try {
    const { iface, ip } = await cachedRouteIface();
    const netStat = await cachedNetstatIb();
    let rxBytes = 0;
    let txBytes = 0;
    let rxPackets = 0;
    let txPackets = 0;

    for (const line of netStat.split('\n')) {
      if (line.startsWith(iface) || line.startsWith(iface + ':')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          rxPackets += parseInt(parts[4]) || 0;
          rxBytes += parseInt(parts[5]) || 0;
          txPackets += parseInt(parts[6]) || 0;
          txBytes += parseInt(parts[7]) || 0;
        }
      }
    }

    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;
    if (prevNetSample && prevNetSample.ts > 0) {
      const dt = Math.max((now - prevNetSample.ts) / 1000, 0.001);
      rxRate = Math.max(0, (rxBytes - prevNetSample.rxBytes) / dt);
      txRate = Math.max(0, (txBytes - prevNetSample.txBytes) / dt);
    }
    prevNetSample = { rxBytes, txBytes, rxPackets, txPackets, ts: now };

    const protocolStats = await getProtocolStats();
    const connectionStates = await getConnectionStates();
    const listeningPorts = await getListeningPorts();
    const establishedConnections = connectionStates.established;
    const topRemoteHosts = await getTopRemoteHosts();

    return {
      interface: iface,
      ip,
      rxBytes,
      txBytes,
      rxPackets,
      txPackets,
      rxRate,
      txRate,
      connections: establishedConnections,
      protocols: protocolStats,
      connectionStates,
      listeningPorts,
      establishedConnections,
      topRemoteHosts,
    };
  } catch {
    return {
      interface: 'unknown',
      ip: '0.0.0.0',
      rxBytes: 0,
      txBytes: 0,
      rxPackets: 0,
      txPackets: 0,
      rxRate: 0,
      txRate: 0,
      connections: 0,
      protocols: { tcp: { connections: 0, rxBytes: 0, txBytes: 0 }, udp: { connections: 0, rxBytes: 0, txBytes: 0 } },
      connectionStates: { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 },
      listeningPorts: [],
      establishedConnections: 0,
      topRemoteHosts: [],
    };
  }
}

async function getProtocolStats(): Promise<ProtocolStats> {
  try {
    const raw = await run("netstat -n -p tcp 2>/dev/null | tail -n +3 | awk '{print $1}' | sort | uniq -c", '');
    const tcpConnections = (await run("netstat -n -p tcp 2>/dev/null | tail -n +3 | wc -l", '0')).trim();
    const udpConnections = (await run("netstat -n -p udp 2>/dev/null | tail -n +3 | wc -l", '0')).trim();
    
    let tcpRxBytes = 0;
    let tcpTxBytes = 0;
    let udpRxBytes = 0;
    let udpTxBytes = 0;
    
    try {
      const netstat = await cachedNetstatIb();
      for (const line of netstat.split('\n')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 9 && parts[0] && !parts[0].startsWith('Name')) {
          const iface = parts[0];
          if (iface.includes('lo')) continue;
          const rx = parseInt(parts[5]) || 0;
          const tx = parseInt(parts[7]) || 0;
          tcpRxBytes += rx;
          tcpTxBytes += tx;
        }
      }
    } catch {
      // ignore
    }
    
    return {
      tcp: {
        connections: parseInt(tcpConnections) || 0,
        rxBytes: tcpRxBytes,
        txBytes: tcpTxBytes,
      },
      udp: {
        connections: parseInt(udpConnections) || 0,
        rxBytes: udpRxBytes,
        txBytes: udpTxBytes,
      },
    };
  } catch {
    return { tcp: { connections: 0, rxBytes: 0, txBytes: 0 }, udp: { connections: 0, rxBytes: 0, txBytes: 0 } };
  }
}

async function getConnectionStates(): Promise<ConnectionStateStats> {
  try {
    const raw = await run("netstat -n -p tcp 2>/dev/null | tail -n +3 | awk '{print $6}' | sort | uniq -c", '');
    const lines = raw.split('\n').filter(Boolean);
    const stats: ConnectionStateStats = { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 };
    
    for (const line of lines) {
      const match = line.match(/(\d+)\s+(\S+)/);
      if (!match) continue;
      const count = parseInt(match[1]);
      const state = match[2].toUpperCase();
      
      if (state.includes('ESTABLISHED')) stats.established += count;
      else if (state.includes('LISTEN')) stats.listening += count;
      else if (state.includes('TIME_WAIT')) stats.timeWait += count;
      else if (state.includes('CLOSE_WAIT')) stats.closeWait += count;
      else stats.other += count;
    }
    
    return stats;
  } catch {
    return { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 };
  }
}

async function getListeningPorts(): Promise<number[]> {
  try {
    const raw = await run("netstat -n -p tcp 2>/dev/null | grep LISTEN | awk '{print $4}' | rev | cut -d. -f1 | rev", '');
    const ports = raw.split('\n')
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p) && p > 0);
    return [...new Set(ports)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function getTopRemoteHosts(): Promise<RemoteHostInfo[]> {
  try {
    const raw = await run("netstat -n -p tcp 2>/dev/null | tail -n +3 | grep ESTABLISHED | awk '{print $5}' | rev | cut -d. -f1 | rev", '');
    const ports = raw.split('\n').filter(Boolean);
    const hostMap = new Map<string, { count: number; bytes: number }>();
    
    for (const port of ports) {
      const host = port.split(':')[0];
      if (!host || host === '127.0.0.1' || host === '::1') continue;
      const existing = hostMap.get(host) || { count: 0, bytes: 0 };
      hostMap.set(host, { count: existing.count + 1, bytes: existing.bytes });
    }
    
    const result: RemoteHostInfo[] = [];
    for (const [host, info] of hostMap.entries()) {
      result.push({
        host,
        ip: host,
        bytesTransferred: info.bytes,
        connectionCount: info.count,
      });
    }
    
    return result.sort((a, b) => b.connectionCount - a.connectionCount).slice(0, 10);
  } catch {
    return [];
  }
}

export async function collectProcesses(limit?: number): Promise<ProcessData[]> {
   try {
      const isMac = process.platform === 'darwin';
      const sortArg = isMac ? '-r' : '--sort=-pcpu';
      const headClause = limit && limit > 0 ? ` | head -n ${limit + 1}` : '';
      const raw = (await run(`ps -eo pid,ppid,user,pcpu,pmem,state,time,comm ${sortArg}${headClause}`)).trim();
      const lines = raw.split('\n').slice(1);
      return lines
        .map(line => {
           const parts = line.match(/\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+([\d:.]+)\s+(.+)/);
           if (!parts) return null;
           const runtimeSec = parts[7].split(':').reduce((acc, val, idx) => acc + parseInt(val) * Math.pow(60, 2 - idx), 0);
           const command = parts[8];
           const isGpuOrMl = /gpu|metal|vulkan|cuda|ollama|llama|torch|mps|mlx|coreml|python/i.test(command);
           return { pid: parseInt(parts[1]), ppid: parseInt(parts[2]), user: parts[3], cpu: parseFloat(parts[4]), mem: parseFloat(parts[5]), state: parts[6], threads: 0, runtime: runtimeSec, command, isGpuOrMlAttributed: isGpuOrMl };
        })
        .filter((p): p is ProcessData => p !== null && p.pid > 0);
  } catch {
    return [];
  }
}

export async function collectPackets(): Promise<PacketData | null> {
   try {
     const netStat = await cachedNetstatIb();
     const lines = netStat.split('\n').slice(1);
     let totalRxPackets = 0;
     let totalTxPackets = 0;
     let totalRxBytes = 0;
     let totalTxBytes = 0;
     const ifaceStats: { iface: string; rxPackets: number; txPackets: number; rxBytes: number; txBytes: number }[] = [];

     for (const line of lines) {
       const parts = line.split(/\s+/);
       if (parts.length >= 11 && parts[0] && !parts[0].startsWith('Name')) {
         const iface = parts[0];
         const rxPackets = parseInt(parts[4]) || 0;
         const rxBytes = parseInt(parts[5]) || 0;
         const txPackets = parseInt(parts[6]) || 0;
         const txBytes = parseInt(parts[7]) || 0;
         totalRxPackets += rxPackets;
         totalTxPackets += txPackets;
         totalRxBytes += rxBytes;
         totalTxBytes += txBytes;
         if (iface && !iface.includes('lo')) {
           ifaceStats.push({ iface, rxPackets, txPackets, rxBytes, txBytes });
         }
       }
     }

     let connections = 0;
     let allProcesses: NetworkProcess[] = [];
     
     try {
       const nettop = (await run('nettop -L 1 -J bytes_in,bytes_out,state 2>/dev/null', '', 2000)).trim();
       const rows = nettop.split('\n');
       
       let currentProc: NetworkProcess | null = null;
       
       for (const row of rows) {
         if (!row || row.startsWith(',state,')) continue;
         
         const cols = row.split(',');
         const nameCol = cols[0];
         
         // If it doesn't contain <->, it's a process row
         if (!nameCol.includes('<->')) {
           if (currentProc) {
             if (currentProc.connections && currentProc.connections.length > 0) {
               allProcesses.push(currentProc);
             }
           }
           
           // Extract PID and Name (e.g., "syslogd.369")
           const lastDot = nameCol.lastIndexOf('.');
           let pid = 0;
           let command = nameCol;
           if (lastDot > 0) {
             const possiblePid = parseInt(nameCol.substring(lastDot + 1));
             if (!isNaN(possiblePid)) {
               pid = possiblePid;
               command = nameCol.substring(0, lastDot);
             }
           }
           
           const rx = parseInt(cols[2]) || 0;
           const tx = parseInt(cols[3]) || 0;
           
           currentProc = { pid, command, rxBytes: rx, txBytes: tx, connections: [] };
         } else {
           // Connection row
           if (currentProc) {
             const state = cols[1];
             const rx = parseInt(cols[2]) || 0;
             const tx = parseInt(cols[3]) || 0;
             if (state === 'Established') connections++;
             
             // Parse endpoints (e.g. "tcp4 172.16.0.2:49844<->17.242.13.5:5223")
             const spaceIdx = nameCol.indexOf(' ');
             const protocol = spaceIdx > 0 ? nameCol.substring(0, spaceIdx) : '';
             const endpoints = spaceIdx > 0 ? nameCol.substring(spaceIdx + 1) : nameCol;
             const arrowIdx = endpoints.indexOf('<->');
             let local = '';
             let remote = '';
             if (arrowIdx > 0) {
               local = endpoints.substring(0, arrowIdx);
               remote = endpoints.substring(arrowIdx + 3);
               
               // Attempt DNS resolution on remote IP
               remote = resolveIp(remote);
             } else {
               local = endpoints;
             }
             
             // Ignore purely local communication if you want, but for now include all
             currentProc.connections!.push({ protocol, local, remote, state, rxBytes: rx, txBytes: tx });
           }
         }
       }
       if (currentProc && currentProc.connections && currentProc.connections.length > 0) {
         allProcesses.push(currentProc);
       }
     } catch {
       allProcesses = [];
     }
     
      // Sort processes by total bandwidth (tx + rx) to get top processes
      const topProcesses = [...allProcesses].sort((a, b) => (b.rxBytes + b.txBytes) - (a.rxBytes + a.txBytes));
      
      const protocolStats = await getProtocolStats();
      const connectionStates = await getConnectionStates();
      const listeningPorts = await getListeningPorts();

       return {
         totalPackets: totalRxPackets + totalTxPackets,
         rxPackets: totalRxPackets,
         txPackets: totalTxPackets,
         rxRate: 0,
         txRate: 0,
         connections,
         topProcesses,
         interfaces: ifaceStats,
         allProcesses,
         protocolStats,
         connectionStates,
         listeningPorts,
       };
    } catch {
      return null;
    }
  }

export async function collectTasks(limit = 12): Promise<TaskData[]> {
   try {
     const isMac = process.platform === 'darwin';
     const sortArg = isMac ? '-r' : '--sort=-pcpu';
     const raw = (await run(`ps -eo pid,user,pcpu,pmem,state,time,comm ${sortArg} | head -n ${limit + 1}`)).trim();
     const lines = raw.split('\n').slice(1);
     return lines
       .map(line => {
          const parts = line.match(/\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+([\d:.]+)\s+(.+)/);
          if (!parts) return null;
          const runtimeSec = parts[6].split(':').reduce((acc, val, idx) => acc + parseInt(val) * Math.pow(60, 2 - idx), 0);
          return { pid: parseInt(parts[1]), user: parts[2], cpu: parseFloat(parts[3]), mem: parseFloat(parts[4]), state: parts[5], runtime: runtimeSec, command: parts[7] };
       })
       .filter((t): t is TaskData => t !== null && t.pid > 0);
   } catch {
     return [];
   }
 }

export interface DisplayInfo {
  name: string;
  resolution: string;
  connectionType?: string;
  isMain?: boolean;
}

export async function getDisplayInfo(): Promise<DisplayInfo[]> {
  try {
    const raw = await run('system_profiler SPDisplaysDataType 2>&1', '');
    const displays: DisplayInfo[] = [];
    const lines = raw.split('\n');
    let currentName = '';
    let currentRes = '';
    let isMain = false;
    let connType = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith(':') && !trimmed.startsWith('Chipset') && !trimmed.startsWith('Displays') && !trimmed.startsWith('Graphics')) {
        if (currentName && currentRes) {
          displays.push({ name: currentName, resolution: currentRes, isMain, connectionType: connType || undefined });
          currentRes = '';
          isMain = false;
          connType = '';
        }
        currentName = trimmed.slice(0, -1);
      } else if (trimmed.startsWith('Resolution:')) {
        currentRes = trimmed.replace('Resolution:', '').trim();
      } else if (trimmed.startsWith('Main Display: Yes')) {
        isMain = true;
      } else if (trimmed.startsWith('Connection Type:')) {
        connType = trimmed.replace('Connection Type:', '').trim();
      }
    }
    if (currentName && currentRes) {
      displays.push({ name: currentName, resolution: currentRes, isMain, connectionType: connType || undefined });
    }
    return displays;
  } catch {
    return [];
  }
}

export interface TimeMachineStatus {
  configured: boolean;
  running: boolean;
  percent?: number;
  latestBackup?: string;
}

export async function getTimeMachineStatus(): Promise<TimeMachineStatus> {
  try {
    const statusRaw = await run('tmutil status 2>&1', '');
    if (statusRaw.includes('No Time Machine destination') || statusRaw.includes('not configured')) {
      return { configured: false, running: false };
    }

    const running = statusRaw.includes('Running = 1;');
    let percent: number | undefined = undefined;
    const pctMatch = statusRaw.match(/Percent\s*=\s*"?(0\.\d+|\d+)"?/i);
    if (pctMatch) {
      percent = Math.round(parseFloat(pctMatch[1]) * 100);
    }

    let latestBackup = 'Unknown';
    try {
      const latestRaw = await run('tmutil latestbackup 2>&1', '');
      if (latestRaw.trim() && !latestRaw.includes('error') && !latestRaw.includes('No backups')) {
        const basename = latestRaw.trim().split('/').pop() || latestRaw.trim();
        latestBackup = basename.replace('.previous', '').replace('.backup', '');
      } else {
        latestBackup = 'No backup found / Unmounted';
      }
    } catch {
      latestBackup = 'Not mounted';
    }

    return { configured: true, running, percent, latestBackup };
  } catch {
    return { configured: false, running: false };
  }
}
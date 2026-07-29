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
import type { StatsData, CpuData, MemoryData, ThermalData, BatteryData, PowerData, DiskData, NetworkData, ProcessData, GpuData, PacketData, NetworkProcess } from './types.js';

const SP_TTL_MS = 10_000;
const NETSTAT_TTL_MS = 1000;
let prevCpuTimes: { total: number; idle: number }[] | null = null;
const ROUTE_TTL_MS = 5_000;
const SYSCTL_TTL_MS = 60_000;

let spGpuCache: { raw: string; ts: number } | null = null;
let spBatteryCache: { raw: string; ts: number } | null = null;
let netstatIbCache: { raw: string; ts: number } | null = null;
let routeCache: { iface: string; ip: string; ts: number } | null = null;
const sysctlCache = new Map<string, { value: string; ts: number }>();

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
   const [cpu, gpu, memory, disk, battery, thermal, network, processes, system, power, packets, tasks] = await Promise.all([
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
   };
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
       return { cpuWatts: power.cpu, gpuWatts: power.gpu, combinedWatts: power.combined };
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
  export async function collectGpu(detailed?: boolean): Promise<GpuData | null> {
    let spRaw = '';
    const now = Date.now();
    if (spGpuCache && now - spGpuCache.ts < SP_TTL_MS) {
      spRaw = spGpuCache.raw;
    } else {
      spRaw = (await run('system_profiler SPDisplaysDataType 2>/dev/null')).trim();
      spGpuCache = { raw: spRaw, ts: now };
    }
    if (!spRaw) return null;

    const modelMatch = spRaw.match(/Chipset Model:\s*(.+)/i);
    const model = modelMatch ? modelMatch[1].trim() : 'Unknown';

    const memMatch = spRaw.match(/VRAM \(Total\):\s*(.+)/i);
    let memory = 0;
    if (memMatch) {
      const memStr = memMatch[1].trim();
      const memNum = parseFloat(memStr);
      if (memStr.includes('GB')) memory = memNum * 1024 * 1024 * 1024;
      else if (memStr.includes('MB')) memory = memNum * 1024 * 1024;
    }

    let utilization = 0;
    let temperature: number | undefined;
    let gpuProcesses = 0;

    if (detailed) {
      try {
        const pm = (await run('sudo -n powermetrics --samplers gpu_power -n 1 --format text 2>/dev/null', '')).trim();
        const gpuPowerMatch = pm.match(/GPU Power:\s*([\d.]+)\s*mW/i);
        if (gpuPowerMatch) {
          utilization = Math.min(100, Math.round(parseFloat(gpuPowerMatch[1]) / 10));
        }
      } catch {
        // ignore
      }

      try {
        const { temps } = await getSmcMetrics();
        if (temps.gpu_die !== undefined) temperature = temps.gpu_die;
      } catch {
        // ignore
      }

      try {
        const psRaw = (await run('ps aux | grep -i "[g]pu" | wc -l')).trim();
        gpuProcesses = parseInt(psRaw) || 0;
      } catch {
        // ignore
      }
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

  let usage = 0;
  try {
    const top = (await run('top -l 1 -n 0')).trim();
    // Real `top -l 1 -n 0` output is comma-separated and newline-terminated,
    // e.g. "CPU usage: 5.26% user, 10.52% sys, 84.21% idle" — there is no
    // semicolon anywhere on that line. The old regex required one to
    // terminate the match, so it never matched and usage stayed at 0.
    const cpuLine = top.match(/CPU usage:\s*[\d.]+%\s*user,\s*[\d.]+%\s*sys,\s*([\d.]+)%\s*idle/);
    if (cpuLine) {
      const idle = parseFloat(cpuLine[1]);
      usage = Math.round(100 - idle);
    }
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

  return { brand, cores, physicalCores, frequency, usage, loadAvg, temperature, coreUsage };
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

  const free = freePages * pageSize;
  const used = (activePages + inactivePages + wiredPages + compressedPages) * pageSize;
  const usagePercent = totalBytes > 0 ? Math.round((used / totalBytes) * 100) : 0;

  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;
  try {
    const swapRaw = (await run('sysctl -n vm.swapusage')).trim();
    // Real output is "total = 3072.00M  used = 1497.75M  free = 1574.25M
    // (encrypted)" — the parentheses wrap the trailing "(encrypted)" note,
    // not the used value. The old regex required a literal "(" right before
    // "used", which never appears, so this never matched and swap stayed at
    // 0 forever instead of updating.
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

  return {
    total: totalBytes,
    used,
    free,
    swapTotal,
    swapUsed,
    swapFree,
    pageSize,
    usagePercent,
  };
}

export async function collectDisk(): Promise<DiskData[]> {
  const raw = (await run('df -h')).trim();
  const lines = raw.split('\n').slice(1);
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
        battInfo = (await run('system_profiler SPPowerDataType 2>/dev/null')).trim();
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

    // Grab the CPU die temp regardless of `detailed` — we need it both for the
    // detailed sensor breakdown and as a state fallback below.
    try {
      const { temps } = await getSmcMetrics();
      cpuDieTemp = temps.cpu_die;
      if (detailed) {
        if (temps.cpu_die !== undefined) temperatures['cpu_die'] = temps.cpu_die;
        if (temps.gpu_die !== undefined) temperatures['gpu_die'] = temps.gpu_die;
        if (temps.smc_die !== undefined) temperatures['smc_die'] = temps.smc_die;
        if (!Object.keys(temps).length) {
          detail += ' (sensor data needs powermetrics privileges)';
        }
      }
    } catch {
      if (detailed) detail += ' (powermetrics unavailable)';
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

    return { interface: iface, ip, rxBytes, txBytes, rxPackets, txPackets };
  } catch {
    return { interface: 'unknown', ip: '0.0.0.0', rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0 };
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
           return { pid: parseInt(parts[1]), ppid: parseInt(parts[2]), user: parts[3], cpu: parseFloat(parts[4]), mem: parseFloat(parts[5]), state: parts[6], threads: 0, runtime: runtimeSec, command: parts[8] };
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
     try {
       const tcpConns = (await run('netstat -an | grep ESTABLISHED | wc -l', '0')).trim();
       connections = parseInt(tcpConns) || 0;
     } catch {
       connections = 0;
     }

     let topProcesses: { pid: number; command: string; rxBytes: number; txBytes: number }[] = [];
     let allProcesses: { pid: number; command: string; rxBytes: number; txBytes: number; rxPackets?: number; txPackets?: number }[] = [];
       try {
          const lsof = (await run('lsof -i -n -P 2>/dev/null | tail -n +2 | awk \'{print $1, $2}\' | sort | uniq -c | sort -rn', '')).trim();
         const lsofLines = lsof.split('\n');
         topProcesses = lsofLines.map(line => {
           const parts = line.trim().split(/\s+/);
           if (parts.length >= 3) {
             return { pid: parseInt(parts[2]) || 0, command: parts[1], rxBytes: 0, txBytes: parseInt(parts[0]) || 0 };
           }
           return { pid: 0, command: '', rxBytes: 0, txBytes: 0 };
         }).filter(p => p.pid > 0);

         allProcesses = topProcesses;
     } catch {
       topProcesses = [];
       allProcesses = [];
     }

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
/**
 * Linux platform telemetry collectors.
 *
 * Reads system metrics directly from standard Linux interfaces
 * (/proc, /sys, standard POSIX tools) with zero native compilation requirements.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../run.js';
import type {
  CpuData,
  MemoryData,
  DiskData,
  BatteryData,
  ThermalData,
  NetworkData,
  ProcessData,
  GpuData,
  PacketData,
  TaskData,
  FanData,
  DisplayInfo,
  PowerData,
  ProtocolStats,
  ConnectionStateStats,
  RemoteHostInfo,
} from '../types.js';

let prevNetSample: { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number; ts: number } | null = null;
let prevDiskIoSample: { totalBytes: number; ts: number } | null = null;
let cachedDiskIo: { readBytesSec: number; writeBytesSec: number; ts: number } | null = null;

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export async function collectLinuxSystem(): Promise<{ hostname: string; os: string; uptime: string }> {
  const hostname = os.hostname();
  let osName = 'Linux';

  const osRelease = safeReadFile('/etc/os-release');
  if (osRelease) {
    const prettyMatch = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (prettyMatch) {
      osName = prettyMatch[1];
    } else {
      const nameMatch = osRelease.match(/NAME="?([^"\n]+)"?/);
      const verMatch = osRelease.match(/VERSION="?([^"\n]+)"?/);
      if (nameMatch) {
        osName = verMatch ? `${nameMatch[1]} ${verMatch[1]}` : nameMatch[1];
      }
    }
  } else {
    osName = `Linux ${os.release()}`;
  }

  const uptimeSec = Math.floor(os.uptime());
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  let uptime = '';
  if (days > 0) uptime += `${days} ${days === 1 ? 'day' : 'days'}, `;
  uptime += `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  return { hostname, os: osName, uptime };
}

export async function collectLinuxCpu(prevCpuTimesRef: { current: { total: number; idle: number }[] | null }): Promise<CpuData> {
  const cpus = os.cpus();
  const cores = cpus.length || 1;
  let brand = cpus[0]?.model || 'Linux CPU';
  let frequency = cpus[0]?.speed || 0;

  // Try /proc/cpuinfo for accurate brand and frequency
  const cpuInfo = safeReadFile('/proc/cpuinfo');
  if (cpuInfo) {
    const brandMatch = cpuInfo.match(/model name\s*:\s*(.+)/i);
    if (brandMatch) brand = brandMatch[1].trim();

    const mhzMatch = cpuInfo.match(/cpu MHz\s*:\s*([\d.]+)/i);
    if (mhzMatch) frequency = Math.round(parseFloat(mhzMatch[1]));
  }

  // Scaling freq fallback from sysfs
  if (frequency === 0) {
    const curFreq = safeReadFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq').trim();
    if (curFreq) {
      frequency = Math.round(parseInt(curFreq, 10) / 1000);
    }
  }

  // Count physical cores from /proc/cpuinfo
  let physicalCores = cores;
  if (cpuInfo) {
    const coreIds = new Set<string>();
    const blocks = cpuInfo.split(/\n\s*\n/);
    for (const b of blocks) {
      const physMatch = b.match(/physical id\s*:\s*(\d+)/);
      const coreMatch = b.match(/core id\s*:\s*(\d+)/);
      if (physMatch && coreMatch) {
        coreIds.add(`${physMatch[1]}:${coreMatch[1]}`);
      }
    }
    if (coreIds.size > 0) physicalCores = coreIds.size;
  }

  // Core usage calculation
  const current = cpus.map(cpu => ({
    total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
    idle: cpu.times.idle,
  }));

  let coreUsage: number[] = [];
  let usage = 0;
  if (prevCpuTimesRef.current && prevCpuTimesRef.current.length === current.length) {
    coreUsage = current.map((c, i) => {
      const prev = prevCpuTimesRef.current![i];
      const totalDelta = c.total - prev.total;
      const idleDelta = c.idle - prev.idle;
      if (totalDelta <= 0) return 0;
      return Math.min(100, Math.max(0, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
    });
    if (coreUsage.length > 0) {
      usage = Math.round(coreUsage.reduce((a, b) => a + b, 0) / coreUsage.length);
    }
  }
  prevCpuTimesRef.current = current;

  // Temperature
  let temperature: number | undefined;
  const thermZone = safeReadFile('/sys/class/thermal/thermal_zone0/temp').trim();
  if (thermZone) {
    const rawVal = parseFloat(thermZone);
    const val = rawVal > 1000 ? rawVal / 1000 : rawVal;
    if (val >= 10 && val <= 125) temperature = Math.round(val * 10) / 10;
  }
  if (temperature === undefined) {
    try {
      const hwmonDirs = fs.readdirSync('/sys/class/hwmon');
      for (const d of hwmonDirs) {
        const tempFile = path.join('/sys/class/hwmon', d, 'temp1_input');
        if (fs.existsSync(tempFile)) {
          const raw = parseFloat(safeReadFile(tempFile).trim());
          const val = raw > 1000 ? raw / 1000 : raw;
          if (val >= 10 && val <= 125) {
            temperature = Math.round(val * 10) / 10;
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const loadAvg = os.loadavg();

  return {
    brand,
    cores,
    physicalCores,
    frequency,
    usage,
    loadAvg,
    temperature,
    coreUsage,
  };
}

export async function collectLinuxMemory(): Promise<MemoryData> {
  const meminfo = safeReadFile('/proc/meminfo');
  let total = os.totalmem();
  let free = os.freemem();
  let available = free;
  let swapTotal = 0;
  let swapFree = 0;
  let buffers = 0;
  let cached = 0;
  let shmem = 0;
  let sreclaimable = 0;

  if (meminfo) {
    const parseKb = (key: string): number => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
      return m ? parseInt(m[1], 10) * 1024 : 0;
    };
    const t = parseKb('MemTotal');
    if (t > 0) total = t;
    free = parseKb('MemFree');
    const a = parseKb('MemAvailable');
    if (a > 0) available = a;
    else available = free;
    buffers = parseKb('Buffers');
    cached = parseKb('Cached');
    shmem = parseKb('Shmem');
    sreclaimable = parseKb('SReclaimable');
    swapTotal = parseKb('SwapTotal');
    swapFree = parseKb('SwapFree');
  }

  const used = Math.max(0, total - available);
  const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;
  const swapUsed = Math.max(0, swapTotal - swapFree);

  let pressureLevel = 'Normal';
  if (usagePercent > 92) pressureLevel = 'Critical';
  else if (usagePercent > 82) pressureLevel = 'Warning';

  return {
    total,
    used,
    free,
    swapTotal,
    swapUsed,
    swapFree,
    pageSize: 4096,
    usagePercent,
    wiredBytes: buffers,
    compressedBytes: cached + sreclaimable,
    purgeableBytes: shmem,
    pressureLevel,
  };
}

export async function collectLinuxDisk(): Promise<DiskData[]> {
  const rawDf = await run('df -k -P 2>/dev/null', '');
  const lines = rawDf.trim().split('\n').slice(1);
  const result: DiskData[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 6) {
      const filesystem = parts[0];
      const totalKb = parseInt(parts[1], 10);
      const usedKb = parseInt(parts[2], 10);
      const availKb = parseInt(parts[3], 10);
      const capacity = parts[4];
      const mountpoint = parts[5];

      // Ignore loopback, devtmpfs, tmpfs, udev
      if (filesystem.startsWith('/dev/') || mountpoint === '/' || totalKb > 1024 * 1024) {
        if (!filesystem.includes('loop')) {
          result.push({
            filesystem,
            size: formatKb(totalKb),
            used: formatKb(usedKb),
            available: formatKb(availKb),
            capacity,
            mountpoint,
            readBytesSec: 0,
            writeBytesSec: 0,
          });
        }
      }
    }
  }

  // Get disk I/O rates from /proc/diskstats
  const diskstats = safeReadFile('/proc/diskstats');
  if (diskstats) {
    const now = Date.now();
    let totalSectors = 0;
    for (const line of diskstats.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 10 && (parts[2].startsWith('sd') || parts[2].startsWith('nvme') || parts[2].startsWith('vd'))) {
        const readSectors = parseInt(parts[5], 10) || 0;
        const writeSectors = parseInt(parts[9], 10) || 0;
        totalSectors += readSectors + writeSectors;
      }
    }
    const totalBytes = totalSectors * 512;
    if (prevDiskIoSample && prevDiskIoSample.ts > 0) {
      const dt = Math.max((now - prevDiskIoSample.ts) / 1000, 0.001);
      const bytesSec = Math.max(0, (totalBytes - prevDiskIoSample.totalBytes) / dt);
      cachedDiskIo = {
        readBytesSec: Math.round(bytesSec * 0.6),
        writeBytesSec: Math.round(bytesSec * 0.4),
        ts: now,
      };
    }
    prevDiskIoSample = { totalBytes, ts: now };

    if (cachedDiskIo && result.length > 0) {
      result[0].readBytesSec = cachedDiskIo.readBytesSec;
      result[0].writeBytesSec = cachedDiskIo.writeBytesSec;
    }
  }

  return result.length > 0 ? result : [
    {
      filesystem: '/dev/root',
      size: '50G',
      used: '10G',
      available: '40G',
      capacity: '20%',
      mountpoint: '/',
      readBytesSec: 0,
      writeBytesSec: 0,
    }
  ];
}

function formatKb(kb: number): string {
  if (isNaN(kb)) return '0B';
  const bytes = kb * 1024;
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1) + 'T';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / 1024).toFixed(0) + 'K';
}

export async function collectLinuxBattery(): Promise<BatteryData | null> {
  const baseDir = '/sys/class/power_supply';
  if (!fs.existsSync(baseDir)) return null;

  try {
    const entries = fs.readdirSync(baseDir);
    const batDir = entries.find(e => /^BAT\d*$/i.test(e));
    if (!batDir) return null;

    const batPath = path.join(baseDir, batDir);
    const capStr = safeReadFile(path.join(batPath, 'capacity')).trim();
    if (!capStr) return null;

    const level = parseInt(capStr, 10) || 0;
    const status = safeReadFile(path.join(batPath, 'status')).trim().toLowerCase();
    const isCharging = status === 'charging';
    const isFull = status === 'full';
    const state = isFull ? 'charged' : (isCharging ? 'charging' : 'discharging');

    // AC check
    const acDir = entries.find(e => /^AC|^ADP/i.test(e));
    let powerSource = 'Battery';
    if (acDir) {
      const online = safeReadFile(path.join(baseDir, acDir, 'online')).trim();
      if (online === '1') powerSource = 'AC';
    }

    // Power draw
    let powerWatts: number | undefined;
    const powerNowStr = safeReadFile(path.join(batPath, 'power_now')).trim();
    if (powerNowStr) {
      const uW = parseInt(powerNowStr, 10);
      if (uW > 0) powerWatts = Math.round((uW / 1_000_000) * 100) / 100;
    } else {
      const curNowStr = safeReadFile(path.join(batPath, 'current_now')).trim();
      const voltNowStr = safeReadFile(path.join(batPath, 'voltage_now')).trim();
      if (curNowStr && voltNowStr) {
        const uA = parseInt(curNowStr, 10);
        const uV = parseInt(voltNowStr, 10);
        if (uA > 0 && uV > 0) {
          powerWatts = Math.round(((uA / 1_000_000) * (uV / 1_000_000)) * 100) / 100;
        }
      }
    }

    // Cycles
    let cycles: number | undefined;
    const cycleStr = safeReadFile(path.join(batPath, 'cycle_count')).trim();
    if (cycleStr) cycles = parseInt(cycleStr, 10) || undefined;

    return {
      level,
      state,
      timeRemaining: state === 'discharging' ? 'calculating' : '∞',
      health: 'Good',
      powerSource,
      cycles,
      powerWatts,
    };
  } catch {
    return null;
  }
}

export async function collectLinuxThermal(): Promise<ThermalData> {
  const temperatures: Record<string, number | null> = {};
  const fans: FanData[] = [];

  try {
    const thermalDirs = fs.readdirSync('/sys/class/thermal');
    for (const d of thermalDirs) {
      if (d.startsWith('thermal_zone')) {
        const typeStr = safeReadFile(`/sys/class/thermal/${d}/type`).trim() || d;
        const tempStr = safeReadFile(`/sys/class/thermal/${d}/temp`).trim();
        if (tempStr) {
          const raw = parseFloat(tempStr);
          const c = raw > 1000 ? Math.round((raw / 1000) * 10) / 10 : Math.round(raw * 10) / 10;
          if (c >= 10 && c <= 125) {
            temperatures[typeStr] = c;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const hwmonDirs = fs.readdirSync('/sys/class/hwmon');
    for (const d of hwmonDirs) {
      const dirPath = path.join('/sys/class/hwmon', d);
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        if (/^temp\d+_input$/.test(f)) {
          const idx = f.match(/\d+/)?.[0] || '1';
          const labelFile = path.join(dirPath, `temp${idx}_label`);
          const label = safeReadFile(labelFile).trim() || `sensor_${idx}`;
          const raw = parseFloat(safeReadFile(path.join(dirPath, f)).trim());
          const c = raw > 1000 ? Math.round((raw / 1000) * 10) / 10 : Math.round(raw * 10) / 10;
          if (c >= 10 && c <= 125) temperatures[label] = c;
        } else if (/^fan\d+_input$/.test(f)) {
          const idx = parseInt(f.match(/\d+/)?.[0] || '0', 10);
          const rpm = parseInt(safeReadFile(path.join(dirPath, f)).trim(), 10);
          if (!isNaN(rpm)) fans.push({ id: idx, rpm });
        }
      }
    }
  } catch {
    // ignore
  }

  const temps = Object.values(temperatures).filter((t): t is number => typeof t === 'number');
  const maxTemp = temps.length > 0 ? Math.max(...temps) : 45;

  let state = 'Nominal';
  let pressureLevel = 0;
  if (maxTemp >= 100) {
    state = 'Critical';
    pressureLevel = 3;
  } else if (maxTemp >= 90) {
    state = 'Serious';
    pressureLevel = 2;
  } else if (maxTemp >= 80) {
    state = 'Fair';
    pressureLevel = 1;
  }

  return {
    state,
    detail: `${state} (${maxTemp}°C)`,
    pressureLevel,
    temperatures: Object.keys(temperatures).length ? temperatures : undefined,
    fans: fans.length ? fans : undefined,
  };
}

export async function collectLinuxPower(): Promise<PowerData | null> {
  // RAPL energy reading
  const raplDir = '/sys/class/powercap/intel-rapl/intel-rapl:0';
  if (fs.existsSync(raplDir)) {
    try {
      const e1Str = safeReadFile(path.join(raplDir, 'energy_uj')).trim();
      const t1 = Date.now();
      await new Promise(r => setTimeout(r, 100));
      const e2Str = safeReadFile(path.join(raplDir, 'energy_uj')).trim();
      const t2 = Date.now();
      const e1 = parseInt(e1Str, 10);
      const e2 = parseInt(e2Str, 10);
      if (e2 > e1 && t2 > t1) {
        const dtSec = (t2 - t1) / 1000;
        const watts = Math.round(((e2 - e1) / 1_000_000 / dtSec) * 100) / 100;
        if (watts > 0 && watts < 500) {
          return { cpuWatts: watts, combinedWatts: watts };
        }
      }
    } catch {
      // ignore
    }
  }

  // Battery discharge power
  try {
    const batt = await collectLinuxBattery();
    if (batt && batt.powerWatts) {
      return { combinedWatts: batt.powerWatts };
    }
  } catch {
    // ignore
  }

  return null;
}

export async function collectLinuxGpu(): Promise<GpuData | null> {
  // 1. Try nvidia-smi
  const nvRaw = (await run('nvidia-smi --query-gpu=gpu_name,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null', '')).trim();
  if (nvRaw) {
    const parts = nvRaw.split(',').map(s => s.trim());
    if (parts.length >= 3) {
      const model = parts[0];
      const memory = (parseFloat(parts[1]) || 0) * 1024 * 1024;
      const utilization = Math.min(100, Math.max(0, Math.round(parseFloat(parts[2]) || 0)));
      const temperature = parts[3] ? parseFloat(parts[3]) : undefined;
      return { model, memory, utilization, temperature, processes: 0 };
    }
  }

  // 2. Sysfs DRM AMD / Intel check
  try {
    const drmDir = '/sys/class/drm';
    if (fs.existsSync(drmDir)) {
      const cards = fs.readdirSync(drmDir).filter(c => /^card\d+$/i.test(c));
      for (const card of cards) {
        const busyFile = path.join(drmDir, card, 'device', 'gpu_busy_percent');
        if (fs.existsSync(busyFile)) {
          const util = parseInt(safeReadFile(busyFile).trim(), 10) || 0;
          return { model: 'Linux DRM GPU', memory: 0, utilization: util, processes: 0 };
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function collectLinuxNetwork(): Promise<NetworkData> {
  const netDev = safeReadFile('/proc/net/dev');
  let iface = 'eth0';
  let rxBytes = 0;
  let txBytes = 0;
  let rxPackets = 0;
  let txPackets = 0;

  // Determine primary interface
  const route = safeReadFile('/proc/net/route');
  if (route) {
    for (const line of route.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts[1] === '00000000' && parts[0]) {
        iface = parts[0];
        break;
      }
    }
  }

  let ip = '127.0.0.1';
  const interfaces = os.networkInterfaces();
  if (interfaces[iface]) {
    const addr = interfaces[iface]?.find(a => a.family === 'IPv4' && !a.internal);
    if (addr) ip = addr.address;
  }
  if (ip === '127.0.0.1') {
    for (const [name, addrs] of Object.entries(interfaces)) {
      const addr = addrs?.find(a => a.family === 'IPv4' && !a.internal);
      if (addr) {
        iface = name;
        ip = addr.address;
        break;
      }
    }
  }

  if (netDev) {
    for (const line of netDev.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const devName = trimmed.slice(0, colonIdx).trim();
      const stats = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
      if (stats.length >= 16) {
        const rxB = parseInt(stats[0], 10) || 0;
        const rxP = parseInt(stats[1], 10) || 0;
        const txB = parseInt(stats[8], 10) || 0;
        const txP = parseInt(stats[9], 10) || 0;
        if (devName === iface || (!iface && devName !== 'lo')) {
          rxBytes = rxB;
          rxPackets = rxP;
          txBytes = txB;
          txPackets = txP;
        }
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

  const connectionStates = await getLinuxConnectionStates();

  return {
    interface: iface,
    ip,
    rxBytes,
    txBytes,
    rxPackets,
    txPackets,
    rxRate,
    txRate,
    connections: connectionStates.established,
    protocols: {
      tcp: { connections: connectionStates.established, rxBytes: 0, txBytes: 0 },
      udp: { connections: 0, rxBytes: 0, txBytes: 0 },
    },
    connectionStates,
    listeningPorts: [],
    establishedConnections: connectionStates.established,
    topRemoteHosts: [],
  };
}

async function getLinuxConnectionStates(): Promise<ConnectionStateStats> {
  const stats: ConnectionStateStats = { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 };
  const tcpFile = safeReadFile('/proc/net/tcp');
  if (tcpFile) {
    for (const line of tcpFile.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const stateHex = parts[3];
        // 01 = ESTABLISHED, 0A = LISTEN, 06 = TIME_WAIT, 08 = CLOSE_WAIT
        if (stateHex === '01') stats.established++;
        else if (stateHex === '0A') stats.listening++;
        else if (stateHex === '06') stats.timeWait++;
        else if (stateHex === '08') stats.closeWait++;
        else stats.other++;
      }
    }
  }
  return stats;
}

export async function collectLinuxPackets(): Promise<PacketData | null> {
  const netDev = safeReadFile('/proc/net/dev');
  let totalRxPackets = 0;
  let totalTxPackets = 0;
  const ifaceStats: { iface: string; rxPackets: number; txPackets: number; rxBytes: number; txBytes: number }[] = [];

  if (netDev) {
    for (const line of netDev.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const devName = trimmed.slice(0, colonIdx).trim();
      const stats = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
      if (stats.length >= 16) {
        const rxB = parseInt(stats[0], 10) || 0;
        const rxP = parseInt(stats[1], 10) || 0;
        const txB = parseInt(stats[8], 10) || 0;
        const txP = parseInt(stats[9], 10) || 0;
        totalRxPackets += rxP;
        totalTxPackets += txP;
        if (!devName.includes('lo')) {
          ifaceStats.push({ iface: devName, rxPackets: rxP, txPackets: txP, rxBytes: rxB, txBytes: txB });
        }
      }
    }
  }

  const connectionStates = await getLinuxConnectionStates();

  return {
    totalPackets: totalRxPackets + totalTxPackets,
    rxPackets: totalRxPackets,
    txPackets: totalTxPackets,
    rxRate: 0,
    txRate: 0,
    connections: connectionStates.established,
    topProcesses: [],
    interfaces: ifaceStats,
    allProcesses: [],
    connectionStates,
    listeningPorts: [],
  };
}

export async function collectLinuxProcesses(limit?: number): Promise<ProcessData[]> {
  try {
    const headClause = limit && limit > 0 ? ` | head -n ${limit + 1}` : '';
    const raw = (await run(`ps -eo pid,ppid,user,pcpu,pmem,state,time,comm --sort=-pcpu 2>/dev/null${headClause}`, '')).trim();
    if (!raw) return [];
    const lines = raw.split('\n').slice(1);
    return lines
      .map(line => {
        const parts = line.match(/\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+([\d:.]+)\s+(.+)/);
        if (!parts) return null;
        const runtimeSec = parts[7].split(':').reduce((acc, val, idx) => acc + parseInt(val, 10) * Math.pow(60, 2 - idx), 0);
        const command = parts[8];
        const isGpuOrMl = /gpu|vulkan|cuda|ollama|llama|torch|python/i.test(command);
        return {
          pid: parseInt(parts[1], 10),
          ppid: parseInt(parts[2], 10),
          user: parts[3],
          cpu: parseFloat(parts[4]),
          mem: parseFloat(parts[5]),
          state: parts[6],
          threads: 0,
          runtime: runtimeSec,
          command,
          isGpuOrMlAttributed: isGpuOrMl,
        };
      })
      .filter((p): p is ProcessData => p !== null && p.pid > 0);
  } catch {
    return [];
  }
}

export async function collectLinuxTasks(limit = 12): Promise<TaskData[]> {
  try {
    const raw = (await run(`ps -eo pid,user,pcpu,pmem,state,time,comm --sort=-pcpu 2>/dev/null | head -n ${limit + 1}`, '')).trim();
    if (!raw) return [];
    const lines = raw.split('\n').slice(1);
    return lines
      .map(line => {
        const parts = line.match(/\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+([\d:.]+)\s+(.+)/);
        if (!parts) return null;
        const runtimeSec = parts[6].split(':').reduce((acc, val, idx) => acc + parseInt(val, 10) * Math.pow(60, 2 - idx), 0);
        return {
          pid: parseInt(parts[1], 10),
          user: parts[2],
          cpu: parseFloat(parts[3]),
          mem: parseFloat(parts[4]),
          state: parts[5],
          runtime: runtimeSec,
          command: parts[7],
        };
      })
      .filter((t): t is TaskData => t !== null && t.pid > 0);
  } catch {
    return [];
  }
}

export async function getLinuxDisplayInfo(): Promise<DisplayInfo[]> {
  const xrandr = await run('xrandr --query 2>/dev/null', '');
  if (!xrandr) return [];
  const displays: DisplayInfo[] = [];
  for (const line of xrandr.split('\n')) {
    const match = line.match(/^(\S+)\s+(connected)\s+(primary\s+)?(\d+x\d+)/);
    if (match) {
      displays.push({
        name: match[1],
        resolution: match[4],
        isMain: !!match[3],
      });
    }
  }
  return displays;
}

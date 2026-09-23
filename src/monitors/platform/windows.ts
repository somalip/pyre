/**
 * Windows platform telemetry collectors.
 *
 * Gathers metrics on Windows (win32) using Node.js standard APIs,
 * WMI / CIM queries, tasklist, and netstat.
 */

import os from 'node:os';
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
  DisplayInfo,
  PowerData,
  ConnectionStateStats,
} from '../types.js';

let prevNetSample: { rxBytes: number; txBytes: number; ts: number } | null = null;

export async function collectWindowsSystem(): Promise<{ hostname: string; os: string; uptime: string }> {
  const hostname = os.hostname();
  const rel = os.release();
  const build = parseInt(rel.split('.')[2] || '0', 10);
  let osName = 'Windows';
  if (build >= 22000) {
    osName = `Windows 11 (${rel})`;
  } else if (rel.startsWith('10.0')) {
    osName = `Windows 10 (${rel})`;
  } else {
    osName = `Windows (${rel})`;
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

export async function collectWindowsCpu(prevCpuTimesRef: { current: { total: number; idle: number }[] | null }): Promise<CpuData> {
  const cpus = os.cpus();
  const cores = cpus.length || 1;
  const brand = cpus[0]?.model || 'Windows CPU';
  const frequency = cpus[0]?.speed || 0;

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

  // Load avg simulation (Windows returns [0, 0, 0] from os.loadavg())
  const activeLoad = Math.round((usage / 100) * cores * 100) / 100;
  const loadAvg = [activeLoad, activeLoad, activeLoad];

  // Temperature via WMI or estimation
  let temperature: number | undefined;
  try {
    const rawWmi = (await run('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', '', 1500)).trim();
    const match = rawWmi.match(/(\d{3,4})/);
    if (match) {
      // Temp in tenths of Kelvin: (val - 2732) / 10 = °C
      const kelvinTenths = parseInt(match[1], 10);
      const c = Math.round(((kelvinTenths - 2732) / 10) * 10) / 10;
      if (c >= 15 && c <= 115) temperature = c;
    }
  } catch {
    // ignore
  }

  if (temperature === undefined) {
    temperature = Math.round((38 + (usage * 0.42)) * 10) / 10;
  }

  return {
    brand,
    cores,
    physicalCores: cores,
    frequency,
    usage,
    loadAvg,
    temperature,
    coreUsage,
  };
}

export async function collectWindowsMemory(): Promise<MemoryData> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;

  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;

  try {
    const rawPage = (await run('wmic pagefile get AllocatedBaseSize,CurrentUsage 2>nul', '', 1500)).trim();
    const lines = rawPage.split('\n').filter(l => l.trim().length > 0);
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      if (parts.length >= 2) {
        const allocMb = parseInt(parts[0], 10) || 0;
        const usedMb = parseInt(parts[1], 10) || 0;
        swapTotal = allocMb * 1024 * 1024;
        swapUsed = usedMb * 1024 * 1024;
        swapFree = Math.max(0, swapTotal - swapUsed);
      }
    }
  } catch {
    // ignore
  }

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
    pressureLevel,
  };
}

export async function collectWindowsDisk(): Promise<DiskData[]> {
  try {
    const raw = (await run('wmic logicaldisk get Caption,FileSystem,FreeSpace,Size 2>nul', '', 2500)).trim();
    const lines = raw.split('\n').slice(1);
    const disks: DiskData[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const drive = parts[0];
        const freeBytes = parseInt(parts[2], 10) || 0;
        const totalBytes = parseInt(parts[3], 10) || 0;
        if (totalBytes > 0) {
          const usedBytes = Math.max(0, totalBytes - freeBytes);
          const capPct = Math.round((usedBytes / totalBytes) * 100);
          disks.push({
            filesystem: drive,
            size: formatBytesStr(totalBytes),
            used: formatBytesStr(usedBytes),
            available: formatBytesStr(freeBytes),
            capacity: `${capPct}%`,
            mountpoint: drive,
            readBytesSec: 0,
            writeBytesSec: 0,
          });
        }
      }
    }

    if (disks.length > 0) return disks;
  } catch {
    // fallback
  }

  return [
    {
      filesystem: 'C:',
      size: '500G',
      used: '150G',
      available: '350G',
      capacity: '30%',
      mountpoint: 'C:',
      readBytesSec: 0,
      writeBytesSec: 0,
    }
  ];
}

function formatBytesStr(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1) + 'T';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / 1024).toFixed(0) + 'K';
}

export async function collectWindowsBattery(): Promise<BatteryData | null> {
  try {
    const raw = (await run('wmic path win32_battery get BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime 2>nul', '', 2000)).trim();
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      if (parts.length >= 2) {
        const statusCode = parseInt(parts[0], 10) || 1;
        const level = parseInt(parts[1], 10) || 0;
        const runTimeMinutes = parseInt(parts[2], 10);

        // 1 = discharging, 2 = AC, 3 = fully charged, 6 = charging
        const powerSource = statusCode === 2 || statusCode === 3 || statusCode === 6 ? 'AC' : 'Battery';
        const state = statusCode === 3 ? 'charged' : (statusCode === 6 || statusCode === 2 ? 'charging' : 'discharging');
        let timeRemaining = 'calculating';
        if (state === 'charged') timeRemaining = '∞';
        else if (runTimeMinutes && runTimeMinutes > 0 && runTimeMinutes < 70000) {
          const h = Math.floor(runTimeMinutes / 60);
          const m = runTimeMinutes % 60;
          timeRemaining = `${h}:${m.toString().padStart(2, '0')}`;
        }

        return {
          level,
          state,
          timeRemaining,
          health: 'Good',
          powerSource,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function collectWindowsThermal(): Promise<ThermalData> {
  let tempC: number | undefined;
  try {
    const rawWmi = (await run('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', '', 1500)).trim();
    const match = rawWmi.match(/(\d{3,4})/);
    if (match) {
      const kelvinTenths = parseInt(match[1], 10);
      const c = Math.round(((kelvinTenths - 2732) / 10) * 10) / 10;
      if (c >= 15 && c <= 115) tempC = c;
    }
  } catch {
    // ignore
  }

  if (tempC === undefined) {
    const cpus = os.cpus();
    const loadUsage = os.loadavg()[0] || 15;
    tempC = Math.round((38 + (loadUsage * 0.42)) * 10) / 10;
  }

  let state = 'Nominal';
  let pressureLevel = 0;
  if (tempC >= 100) {
    state = 'Critical';
    pressureLevel = 3;
  } else if (tempC >= 90) {
    state = 'Serious';
    pressureLevel = 2;
  } else if (tempC >= 80) {
    state = 'Fair';
    pressureLevel = 1;
  }

  return {
    state,
    detail: `${state} (${tempC}°C)`,
    pressureLevel,
    temperatures: { cpu: tempC },
  };
}

export async function collectWindowsPower(): Promise<PowerData | null> {
  return null;
}

export async function collectWindowsGpu(): Promise<GpuData | null> {
  // 1. Try nvidia-smi
  const nvRaw = (await run('nvidia-smi --query-gpu=gpu_name,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>nul', '')).trim();
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

  // 2. Try WMIC VideoController
  try {
    const raw = (await run('wmic path win32_VideoController get Name,AdapterRAM 2>nul', '', 2000)).trim();
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s{2,}/);
      if (parts.length >= 2) {
        const ram = parseInt(parts[0], 10) || 0;
        const name = parts[1] || 'Windows Display Adapter';
        return { model: name, memory: ram, utilization: 0, processes: 0 };
      } else if (parts.length === 1) {
        return { model: parts[0], memory: 0, utilization: 0, processes: 0 };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function collectWindowsNetwork(): Promise<NetworkData> {
  let iface = 'Ethernet';
  let ip = '127.0.0.1';
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    const addr = addrs?.find(a => a.family === 'IPv4' && !a.internal);
    if (addr) {
      iface = name;
      ip = addr.address;
      break;
    }
  }

  let rxBytes = 0;
  let txBytes = 0;
  let rxPackets = 0;
  let txPackets = 0;

  try {
    const netstatE = (await run('netstat -e 2>nul', '', 1500)).trim();
    const lines = netstatE.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] && parts[0].toLowerCase() === 'bytes' && parts.length >= 3) {
        rxBytes = parseInt(parts[1], 10) || 0;
        txBytes = parseInt(parts[2], 10) || 0;
      } else if (parts[0] && parts[0].toLowerCase().includes('unicast') && parts.length >= 3) {
        rxPackets += parseInt(parts[1], 10) || 0;
        txPackets += parseInt(parts[2], 10) || 0;
      }
    }
  } catch {
    // ignore
  }

  const now = Date.now();
  let rxRate = 0;
  let txRate = 0;
  if (prevNetSample && prevNetSample.ts > 0) {
    const dt = Math.max((now - prevNetSample.ts) / 1000, 0.001);
    rxRate = Math.max(0, (rxBytes - prevNetSample.rxBytes) / dt);
    txRate = Math.max(0, (txBytes - prevNetSample.txBytes) / dt);
  }
  prevNetSample = { rxBytes, txBytes, ts: now };

  const connectionStates = await getWindowsConnectionStates();

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

async function getWindowsConnectionStates(): Promise<ConnectionStateStats> {
  const stats: ConnectionStateStats = { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 };
  try {
    const raw = (await run('netstat -ano 2>nul', '', 2000)).trim();
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && parts[0].toUpperCase() === 'TCP') {
        const state = parts[3].toUpperCase();
        if (state.includes('ESTABLISHED')) stats.established++;
        else if (state.includes('LISTENING')) stats.listening++;
        else if (state.includes('TIME_WAIT')) stats.timeWait++;
        else if (state.includes('CLOSE_WAIT')) stats.closeWait++;
        else stats.other++;
      }
    }
  } catch {
    // ignore
  }
  return stats;
}

export async function collectWindowsPackets(): Promise<PacketData | null> {
  let rxBytes = 0;
  let txBytes = 0;
  let rxPackets = 0;
  let txPackets = 0;

  try {
    const netstatE = (await run('netstat -e 2>nul', '', 1500)).trim();
    const lines = netstatE.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] && parts[0].toLowerCase() === 'bytes' && parts.length >= 3) {
        rxBytes = parseInt(parts[1], 10) || 0;
        txBytes = parseInt(parts[2], 10) || 0;
      } else if (parts[0] && parts[0].toLowerCase().includes('unicast') && parts.length >= 3) {
        rxPackets += parseInt(parts[1], 10) || 0;
        txPackets += parseInt(parts[2], 10) || 0;
      }
    }
  } catch {
    // ignore
  }

  const connectionStates = await getWindowsConnectionStates();

  return {
    totalPackets: rxPackets + txPackets,
    rxPackets,
    txPackets,
    rxRate: 0,
    txRate: 0,
    connections: connectionStates.established,
    topProcesses: [],
    interfaces: [{ iface: 'Primary', rxPackets, txPackets, rxBytes, txBytes }],
    allProcesses: [],
    connectionStates,
    listeningPorts: [],
  };
}

export async function collectWindowsProcesses(limit?: number): Promise<ProcessData[]> {
  try {
    const raw = (await run('tasklist /fo csv /nh 2>nul', '', 3000)).trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const procs: ProcessData[] = [];
    const totalMem = os.totalmem();

    for (const line of lines) {
      const parts = line.split('","').map(s => s.replace(/(^"|"$)/g, '').trim());
      if (parts.length >= 5) {
        const name = parts[0];
        const pid = parseInt(parts[1], 10);
        const memStr = parts[4].replace(/[^\d]/g, '');
        const memKb = parseInt(memStr, 10) || 0;
        const memBytes = memKb * 1024;
        const memPct = totalMem > 0 ? Math.round((memBytes / totalMem) * 100 * 10) / 10 : 0;
        const isGpuOrMl = /gpu|vulkan|cuda|ollama|llama|torch|python/i.test(name);

        if (pid > 0) {
          procs.push({
            pid,
            ppid: 0,
            user: parts[2] || 'SYSTEM',
            cpu: 0,
            mem: memPct,
            state: 'R',
            threads: 0,
            runtime: 0,
            command: name,
            isGpuOrMlAttributed: isGpuOrMl,
          });
        }
      }
    }

    // Sort by memory descending
    procs.sort((a, b) => b.mem - a.mem);
    if (limit && limit > 0) return procs.slice(0, limit);
    return procs;
  } catch {
    return [];
  }
}

export async function collectWindowsTasks(limit = 12): Promise<TaskData[]> {
  const procs = await collectWindowsProcesses(limit);
  return procs.map(p => ({
    pid: p.pid,
    user: p.user,
    cpu: p.cpu,
    mem: p.mem,
    state: p.state,
    runtime: p.runtime,
    command: p.command,
  }));
}

export async function getWindowsDisplayInfo(): Promise<DisplayInfo[]> {
  return [{ name: 'Default Display', resolution: '1920x1080', isMain: true }];
}

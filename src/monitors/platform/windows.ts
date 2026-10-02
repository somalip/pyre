/**
 * Windows platform telemetry collectors.
 *
 * Gathers metrics on Windows (win32) using Node.js standard APIs,
 * PowerShell CIM/WMI, Windows Performance Counters, tasklist, and netstat.
 */

import os from 'node:os';
import { run, runPowerShell } from '../run.js';
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

function safeParseFloat(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function safeParseInt(s: string | undefined, def = 0): number {
  if (!s) return def;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : def;
}

function parsePipeOutput(raw: string): string[][] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.split('|').map(s => s.trim()));
}

async function getCimProperty(className: string, property: string): Promise<string> {
  const raw = await runPowerShell(
    `(Get-CimInstance -ClassName ${className} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ${property}) -join '|'`,
    ''
  );
  return raw.split('|')[0] || '';
}

async function getCimRow(className: string): Promise<Record<string, string>> {
  const raw = await runPowerShell(
    `Get-CimInstance -ClassName ${className} -ErrorAction SilentlyContinue | Select-Object -Property * -ExcludeProperty CIM* | ConvertTo-Csv -NoTypeInformation`,
    ''
  );
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return {};
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    row[h] = values[i] || '';
  });
  return row;
}

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

  let brand = cpus[0]?.model || 'Windows CPU';
  let physicalCores = cores;
  let frequency = cpus[0]?.speed || 0;

  try {
    const cpuRow = await getCimRow('Win32_Processor');
    if (cpuRow.Name) brand = cpuRow.Name.trim();
    if (cpuRow.NumberOfCores) physicalCores = safeParseInt(cpuRow.NumberOfCores, cores);
    if (cpuRow.MaxClockSpeed) frequency = safeParseInt(cpuRow.MaxClockSpeed, frequency);
  } catch {
    // ignore
  }

  const current = cpus.map(cpu => ({
    total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
    idle: cpu.times.idle,
  }));

  let coreUsage: number[] = [];
  let usage = 0;
  const prevCpuTimes = prevCpuTimesRef.current;
  if (prevCpuTimes && prevCpuTimes.length === current.length) {
    coreUsage = current.map((c, i) => {
      const prev = prevCpuTimes[i];
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

  const activeLoad = Math.round((usage / 100) * cores * 100) / 100;
  const loadAvg = [activeLoad, activeLoad, activeLoad];

  let temperature: number | undefined;

  try {
    const raw = await runPowerShell(
      `(Get-Counter '\Thermal Zone Information(*)\*' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 200 -and $_.CookedValue -lt 400 } | Select-Object -First 1 -ExpandProperty CookedValue`,
      ''
    ).catch(() => '');
    const tempK = parseFloat(raw);
    if (tempK > 200 && tempK < 400) {
      temperature = Math.round((tempK - 273.15) * 10) / 10;
    }
  } catch {
    // ignore
  }

  if (temperature === undefined) {
    try {
      const rawWmi = await run('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', '', 1500);
      const match = rawWmi.match(/(\d{3,4})/);
      if (match) {
        const kelvinTenths = parseInt(match[1], 10);
        const c = Math.round(((kelvinTenths - 2732) / 10) * 10) / 10;
        if (c >= 15 && c <= 115) temperature = c;
      }
    } catch {
      // ignore
    }
  }

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

export async function collectWindowsMemory(): Promise<MemoryData> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;

  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;

  try {
    const rawPage = await runPowerShell(
      `Get-CimInstance Win32_PageFileUsage | ForEach-Object { "$($_.AllocatedBaseSize)|$($_.CurrentUsage)" }`,
      ''
    );
    const lines = rawPage.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      const [allocStr, usedStr] = line.split('|');
      const allocMb = safeParseInt(allocStr);
      const usedMb = safeParseInt(usedStr);
      swapTotal += allocMb * 1024 * 1024;
      swapUsed += usedMb * 1024 * 1024;
    }
    swapFree = Math.max(0, swapTotal - swapUsed);
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
    const raw = await runPowerShell(
      `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "$($_.DeviceID)|$($_.FileSystem)|$($_.Size)|$($_.FreeSpace)" }`,
      ''
    );
    const disks: DiskData[] = [];

    for (const line of raw.split('\n')) {
      const parts = line.trim().split('|');
      if (parts.length >= 4) {
        const drive = parts[0];
        const totalBytes = safeParseInt(parts[2]);
        const freeBytes = safeParseInt(parts[3]);
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
    },
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
    const raw = await runPowerShell(
      `$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if ($bat) { "$($bat.EstimatedChargeRemaining)|$($bat.BatteryStatus)|$($bat.EstimatedRunTime)|$($bat.DischargeRate)" } else { '' }`,
      ''
    );
    if (!raw) return null;

    const parts = raw.split('|');
    const level = safeParseInt(parts[0], 0);
    const statusCode = safeParseInt(parts[1], 1);
    const runTimeMinutes = safeParseInt(parts[2], 0);
    const dischargeRate = safeParseInt(parts[3], 0);

    const powerSource = statusCode === 2 || statusCode === 3 || statusCode === 6 ? 'AC' : 'Battery';
    const state = statusCode === 3 ? 'charged' : statusCode === 6 || statusCode === 2 ? 'charging' : 'discharging';
    let timeRemaining = 'calculating';
    if (state === 'charged') timeRemaining = '∞';
    else if (runTimeMinutes && runTimeMinutes > 0 && runTimeMinutes < 70000) {
      const h = Math.floor(runTimeMinutes / 60);
      const m = runTimeMinutes % 60;
      timeRemaining = `${h}:${m.toString().padStart(2, '0')}`;
    }

    const powerWatts = dischargeRate > 0 ? Math.round((dischargeRate / 1000) * 100) / 100 : undefined;

    return {
      level,
      state,
      timeRemaining,
      health: 'Good',
      powerSource,
      powerWatts,
    };
  } catch {
    return null;
  }
}

export async function collectWindowsThermal(): Promise<ThermalData> {
  const temperatures: Record<string, number | null> = {};

  let tempC: number | undefined;

  try {
    const raw = await runPowerShell(
      `(Get-Counter '\Thermal Zone Information(*)\*' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 200 -and $_.CookedValue -lt 400 } | Select-Object -First 1 -ExpandProperty CookedValue`,
      ''
    ).catch(() => '');
    const tempK = parseFloat(raw);
    if (tempK > 200 && tempK < 400) {
      tempC = Math.round((tempK - 273.15) * 10) / 10;
      temperatures['cpu'] = tempC;
    }
  } catch {
    // ignore
  }

  if (tempC === undefined) {
    try {
      const rawWmi = await run('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', '', 1500);
      const match = rawWmi.match(/(\d{3,4})/);
      if (match) {
        const kelvinTenths = parseInt(match[1], 10);
        const c = Math.round(((kelvinTenths - 2732) / 10) * 10) / 10;
        if (c >= 15 && c <= 115) {
          tempC = c;
          temperatures['cpu'] = c;
        }
      }
    } catch {
      // ignore
    }
  }

  let gpuTemp: number | undefined;
  try {
    const gpuRaw = await runPowerShell(
      `(Get-Counter '\GPU(*)\*' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CounterName -match 'Temperature' -and $_.CookedValue -gt 0 } | Select-Object -First 1 -ExpandProperty CookedValue`,
      ''
    ).catch(() => '');
    gpuTemp = parseFloat(gpuRaw);
    if (gpuTemp > 0 && gpuTemp < 150) {
      temperatures['gpu'] = Math.round(gpuTemp * 10) / 10;
    }
  } catch {
    // ignore
  }

  const cpuTemp = tempC ?? gpuTemp;
  let state = 'Nominal';
  let pressureLevel = 0;
  if (cpuTemp !== undefined) {
    if (cpuTemp >= 100) {
      state = 'Critical';
      pressureLevel = 3;
    } else if (cpuTemp >= 90) {
      state = 'Serious';
      pressureLevel = 2;
    } else if (cpuTemp >= 80) {
      state = 'Fair';
      pressureLevel = 1;
    }
  }

  return {
    state,
    detail: cpuTemp !== undefined ? `${state} (${cpuTemp}°C)` : state,
    pressureLevel,
    temperatures: Object.keys(temperatures).length ? temperatures : undefined,
  };
}

export async function collectWindowsPower(): Promise<PowerData | null> {
  const power: PowerData = {};

  try {
    const batRaw = await runPowerShell(
      `$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue; if ($bat) { "$($bat.DischargeRate)|$($bat.BatteryStatus)" } else { '|0' }`,
      ''
    );
    const [dischargeStr, statusStr] = batRaw.split('|');
    const dischargeRate = safeParseInt(dischargeStr);
    const statusCode = safeParseInt(statusStr, 1);

    if (dischargeRate > 0 && (statusCode === 1 || statusCode === 2)) {
      power.combinedWatts = Math.round((dischargeRate / 1000) * 100) / 100;
    }
  } catch {
    // ignore
  }

  try {
    const cpu = os.cpus();
    const usage = cpu.length > 0 ? Math.round(cpu.reduce((a, c) => a + (c.times.user + c.times.nice + c.times.sys + c.times.irq - c.times.idle) / (c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq), 0) / cpu.length * 100) : 0;
    const tdpWatts = 65;
    if (usage > 0) {
      power.cpuWatts = Math.round((usage / 100) * tdpWatts * 100) / 100;
    }
  } catch {
    // ignore
  }

  try {
    const nvRaw = await run('nvidia-smi --query-gpu=power.draw,utilization.gpu --format=csv,noheader,nounits 2>nul', '').catch(() => '');
    const nvLines = nvRaw.split('\n').filter(l => l.trim());
    for (const line of nvLines) {
      const parts = line.trim().split(',').map(s => s.trim());
      const pwr = parseFloat(parts[0]);
      if (pwr > 0) {
        power.gpuWatts = Math.round(pwr * 100) / 100;
        if (!power.combinedWatts) power.combinedWatts = power.gpuWatts;
        else power.combinedWatts = Math.round((power.combinedWatts + power.gpuWatts) * 100) / 100;
        break;
      }
    }
  } catch {
    // ignore
  }

  if (power.combinedWatts || power.cpuWatts || power.gpuWatts) {
    if (!power.combinedWatts) {
      power.combinedWatts = Math.round(((power.cpuWatts || 0) + (power.gpuWatts || 0)) * 100) / 100;
    }
    return power;
  }

  return null;
}

async function getNvidiaGpu(): Promise<GpuData | null> {
  try {
    const nvRaw = await run('nvidia-smi --query-gpu=gpu_name,memory.total,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits 2>nul', '');
    const nvLines = nvRaw.split('\n').filter(l => l.trim());
    if (nvLines.length > 0) {
      const parts = nvLines[0].trim().split(',').map(s => s.trim());
      if (parts.length >= 3) {
        const model = parts[0];
        const memory = (parseFloat(parts[1]) || 0) * 1024 * 1024;
        const utilization = Math.min(100, Math.max(0, Math.round(parseFloat(parts[2]) || 0)));
        const temperature = parts[3] ? parseFloat(parts[3]) : undefined;
        const powerDraw = parts[4] ? parseFloat(parts[4]) : undefined;
        return {
          model,
          memory,
          utilization,
          temperature: Number.isFinite(temperature as number) ? temperature : undefined,
          processes: 0,
          powerDraw: Number.isFinite(powerDraw as number) ? powerDraw : undefined,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function getWmiGpu(): Promise<GpuData | null> {
  try {
    const raw = await runPowerShell(
      `Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion, VideoProcessor | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length >= 2) {
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const values = lines[1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });

      const name = row.Name || row.VideoProcessor || 'Windows Display Adapter';
      const ram = safeParseInt(row.AdapterRAM);
      return {
        model: name,
        memory: ram,
        utilization: 0,
        processes: 0,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function getPerfCounterGpu(): Promise<GpuData | null> {
  try {
    const raw = await runPowerShell(
      `$engines = Get-Counter '\GPU Engine(*)\*' -ErrorAction SilentlyContinue; if ($engines) { $engines.CounterSamples | Where-Object { $_.CounterName -match 'Utilization Percentage|GPU Time' -and $_.CookedValue -gt 0 } | ForEach-Object { "$($_.InstanceName)|$($_.CounterName)|$($_.CookedValue)" } }`,
      ''
    ).catch(() => '');
    if (!raw) return null;

    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const gpuGroups = new Map<string, { name: string; values: number[] }>();
    for (const line of lines) {
      const [instanceName, counterName, valueStr] = line.split('|');
      const baseName = instanceName.replace(/\s*\(\d+\)\s*$/, '').trim();
      if (!gpuGroups.has(baseName)) {
        gpuGroups.set(baseName, { name: baseName, values: [] });
      }
      gpuGroups.get(baseName)!.values.push(parseFloat(valueStr) || 0);
    }

    let bestGpu: { name: string; util: number } | null = null;
    for (const group of gpuGroups.values()) {
      const total = group.values.reduce((a, b) => a + b, 0);
      const util = Math.min(100, Math.round(total));
      if (!bestGpu || util > bestGpu.util) {
        bestGpu = { name: group.name, util };
      }
    }

    if (bestGpu) {
      return {
        model: bestGpu.name,
        memory: 0,
        utilization: bestGpu.util,
        processes: 0,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function collectWindowsGpu(): Promise<GpuData | null> {
  const nv = await getNvidiaGpu();
  if (nv) return nv;

  const perf = await getPerfCounterGpu();
  if (perf) return perf;

  const wmi = await getWmiGpu();
  if (wmi) return wmi;

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
    const raw = await runPowerShell(
      `Get-NetIPConfiguration -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1 -ExpandProperty NetAdapter.Name`,
      ''
    );
    if (raw) iface = raw;
  } catch {
    // ignore
  }

  try {
    const netstatE = await run('netstat -e 2>nul', '', 1500);
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
    const raw = await runPowerShell(
      `Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`,
      '0'
    );
    stats.established = safeParseInt(raw, 0);

    const listenRaw = await runPowerShell(
      `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`,
      '0'
    );
    stats.listening = safeParseInt(listenRaw, 0);

    const twRaw = await runPowerShell(
      `Get-NetTCPConnection -State TimeWait -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`,
      '0'
    );
    stats.timeWait = safeParseInt(twRaw, 0);

    const cwRaw = await runPowerShell(
      `Get-NetTCPConnection -State CloseWait -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`,
      '0'
    );
    stats.closeWait = safeParseInt(cwRaw, 0);
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
    const netstatE = await run('netstat -e 2>nul', '', 1500);
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

const winProcCache = new Map<number, { user: number; kernel: number; ts: number }>();

export async function collectWindowsProcesses(limit?: number): Promise<ProcessData[]> {
  try {
    const raw = await runPowerShell(
      `Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ThreadCount, WorkingSetSize, UserModeTime, KernelModeTime | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const lines = raw.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('"Name"'));
    const now = Date.now();
    const procs: ProcessData[] = [];
    const totalMem = os.totalmem();

    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (parts.length < 6) continue;
      const name = parts[0];
      const pid = safeParseInt(parts[1], 0);
      const threads = safeParseInt(parts[2], 0);
      const memBytes = safeParseInt(parts[3], 0);
      const userTime = safeParseInt(parts[4], 0);
      const kernelTime = safeParseInt(parts[5], 0);

      if (!pid || pid <= 0) continue;

      const totalTime = userTime + kernelTime;
      let cpu = 0;

      const prev = winProcCache.get(pid);
      if (prev) {
        const dt = now - prev.ts;
        if (dt > 0) {
          const timeDelta = totalTime - (prev.user + prev.kernel);
          if (timeDelta > 0) {
            const cpuSeconds = timeDelta / 10_000_000;
            cpu = Math.min(100, Math.round((cpuSeconds / dt) * 10000) / 100);
          }
        }
      }
      winProcCache.set(pid, { user: userTime, kernel: kernelTime, ts: now });

      const memPct = totalMem > 0 ? Math.round((memBytes / totalMem) * 1000) / 10 : 0;
      const isGpuOrMl = /gpu|vulkan|cuda|ollama|llama|torch|python|nvidia|amd|radeon|intel.*graphics/i.test(name);

      procs.push({
        pid,
        ppid: 0,
        user: 'SYSTEM',
        cpu,
        mem: memPct,
        state: 'R',
        threads,
        runtime: 0,
        command: name,
        isGpuOrMlAttributed: isGpuOrMl,
      });
    }

    procs.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem);
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
  try {
    const raw = await runPowerShell(
      `Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.VideoModeDescription)|$($_.VideoProcessor)" }`,
      ''
    );
    const displays: DisplayInfo[] = [];
    for (const line of raw.split('\n')) {
      const parts = line.trim().split('|');
      if (parts[0]) {
        displays.push({
          name: parts[0],
          resolution: parts[1] || 'Unknown',
          isMain: displays.length === 0,
        });
      }
    }
    return displays.length > 0 ? displays : [{ name: 'Default Display', resolution: '1920x1080', isMain: true }];
  } catch {
    return [{ name: 'Default Display', resolution: '1920x1080', isMain: true }];
  }
}

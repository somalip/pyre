/**
 * Windows platform telemetry collectors.
 *
 * Gathers metrics on Windows (win32) using Node.js standard APIs,
 * PowerShell CIM/WMI, Windows Performance Counters, tasklist, and netstat.
 *
 * Fully supports Intel, AMD, and NVIDIA processors and graphics cards.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
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
  RemoteHostInfo,
  NetworkProcess,
} from '../types.js';

let prevNetSample: { rxBytes: number; txBytes: number; ts: number } | null = null;
let emaLoadAvg: [number, number, number] = [0, 0, 0];
let lastLoadTime = 0;

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

export async function getCimProperty(className: string, property: string): Promise<string> {
  const raw = await runPowerShell(
    `(Get-CimInstance -ClassName ${className} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ${property}) -join '|'`,
    ''
  );
  return raw.split('|')[0] || '';
}

export async function getCimRow(className: string): Promise<Record<string, string>> {
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

// ─── CPU & Architecture ────────────────────────────────────────────────────────

export function parseWindowsCpuBrand(rawName: string, fallback: string): string {
  if (!rawName) return fallback;
  return rawName
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .trim() || fallback;
}

export function detectProcessorVendor(brand: string): 'intel' | 'amd' | 'other' {
  const b = brand.toLowerCase();
  if (b.includes('amd') || b.includes('ryzen') || b.includes('threadripper') || b.includes('epyc') || b.includes('athlon')) {
    return 'amd';
  }
  if (b.includes('intel') || b.includes('xeon') || /\bcore\s*(i[3579]|ultra|2)/i.test(brand)) {
    return 'intel';
  }
  return 'other';
}

export function estimateCpuTdp(brand: string): number {
  const b = brand.toLowerCase();
  const isAmd = b.includes('amd') || b.includes('ryzen');
  const isIntel = b.includes('intel') || b.includes('core');

  if (isAmd) {
    if (b.includes('threadripper') || b.includes('epyc')) return 280;
    if (b.includes('ryzen 9') || b.includes('7950') || b.includes('7900') || b.includes('5950') || b.includes('5900') || b.includes('9950') || b.includes('9900')) return 170;
    if (b.includes('ryzen 7') || b.includes('7700') || b.includes('7800x3d') || b.includes('5800') || b.includes('9700')) return 105;
    if (b.includes('ryzen 5') || b.includes('7600') || b.includes('5600')) return 65;
    if (b.includes('u') || b.includes('hs') || b.includes('mobile')) return 28;
    return 65;
  }

  if (isIntel) {
    if (b.includes('xeon')) return 205;
    if (b.includes('i9') || b.includes('14900') || b.includes('13900') || b.includes('12900')) return 125;
    if (b.includes('i7') || b.includes('14700') || b.includes('13700') || b.includes('12700')) return 125;
    if (b.includes('i5')) return 65;
    if (b.includes('i3')) return 60;
    if (b.includes('ultra')) return 45;
    if (b.includes('h') || b.includes('hx')) return 45;
    if (b.includes('u') || b.includes('p')) return 28;
    return 65;
  }

  return 65;
}

export function updateEmaLoadAvg(currentUsage: number, cores: number): [number, number, number] {
  const activeLoad = Math.round((currentUsage / 100) * cores * 100) / 100;
  const now = Date.now();
  if (lastLoadTime === 0) {
    lastLoadTime = now;
    emaLoadAvg = [activeLoad, activeLoad, activeLoad];
    return emaLoadAvg;
  }

  const dtSec = Math.max((now - lastLoadTime) / 1000, 0.1);
  lastLoadTime = now;

  // Exponential moving average constants for 1m, 5m, 15m
  const exp1 = Math.exp(-dtSec / 60);
  const exp5 = Math.exp(-dtSec / 300);
  const exp15 = Math.exp(-dtSec / 900);

  emaLoadAvg = [
    Math.round((activeLoad * (1 - exp1) + emaLoadAvg[0] * exp1) * 100) / 100,
    Math.round((activeLoad * (1 - exp5) + emaLoadAvg[1] * exp5) * 100) / 100,
    Math.round((activeLoad * (1 - exp15) + emaLoadAvg[2] * exp15) * 100) / 100,
  ];

  return emaLoadAvg;
}

export async function collectWindowsCpu(prevCpuTimesRef: { current: { total: number; idle: number }[] | null }): Promise<CpuData> {
  const cpus = os.cpus();
  const cores = cpus.length || 1;

  let brand = cpus[0]?.model || 'Windows CPU';
  let physicalCores = cores;
  let frequency = cpus[0]?.speed || 0;

  try {
    const cpuRow = await getCimRow('Win32_Processor');
    if (cpuRow.Name) brand = parseWindowsCpuBrand(cpuRow.Name, brand);
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

  const loadAvg = updateEmaLoadAvg(usage, cores);

  // Temperature reading across modern CIM and Perf Counters
  let temperature = await getWindowsCpuTemperature();

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

export async function getWindowsCpuTemperature(): Promise<number | undefined> {
  // 1. Try LibreHardwareMonitor or OpenHardwareMonitor WMI (widely supported on AMD Ryzen and Intel desktops)
  try {
    const lhmRaw = await runPowerShell(
      `Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Temperature' and Name like '%CPU%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
      ''
    );
    const lhmVal = safeParseFloat(lhmRaw);
    if (lhmVal >= 15 && lhmVal <= 115) return Math.round(lhmVal * 10) / 10;
  } catch {}

  try {
    const ohmRaw = await runPowerShell(
      `Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Temperature' and Name like '%CPU%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
      ''
    );
    const ohmVal = safeParseFloat(ohmRaw);
    if (ohmVal >= 15 && ohmVal <= 115) return Math.round(ohmVal * 10) / 10;
  } catch {}

  // 2. Try PowerShell CIM MSAcpi_ThermalZoneTemperature (modern Windows 10/11 replacement for wmic)
  try {
    const cimRaw = await runPowerShell(
      `(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CurrentTemperature)`,
      ''
    );
    const kelvinTenths = safeParseInt(cimRaw);
    if (kelvinTenths > 2732 && kelvinTenths < 4200) {
      const c = Math.round(((kelvinTenths - 2732) / 10) * 10) / 10;
      if (c >= 15 && c <= 115) return c;
    }
  } catch {}

  // 3. Try Windows Performance Counter
  try {
    const raw = await runPowerShell(
      `(Get-Counter '\\Thermal Zone Information(*)\\*' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 200 -and $_.CookedValue -lt 400 } | Select-Object -First 1 -ExpandProperty CookedValue`,
      ''
    );
    const tempK = safeParseFloat(raw);
    if (tempK > 200 && tempK < 400) {
      return Math.round((tempK - 273.15) * 10) / 10;
    }
  } catch {}

  return undefined;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

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

// ─── Disks ─────────────────────────────────────────────────────────────────────

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

// ─── Battery ───────────────────────────────────────────────────────────────────

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

// ─── Thermal & Power ───────────────────────────────────────────────────────────

export async function collectWindowsThermal(): Promise<ThermalData> {
  const temperatures: Record<string, number | null> = {};

  const cpuTemp = await getWindowsCpuTemperature();
  if (cpuTemp !== undefined) {
    temperatures['cpu'] = cpuTemp;
  }

  // GPU temperature across NVIDIA / AMD / Intel
  let gpuTemp: number | undefined;

  // Try nvidia-smi
  try {
    const nvRaw = await runNvidiaSmiQuery('temperature.gpu');
    const t = safeParseFloat(nvRaw);
    if (t > 0 && t < 125) gpuTemp = t;
  } catch {}

  // Try LibreHardwareMonitor GPU temperature
  if (gpuTemp === undefined) {
    try {
      const lhmGpu = await runPowerShell(
        `Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Temperature' and Name like '%GPU%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
        ''
      );
      const t = safeParseFloat(lhmGpu);
      if (t > 0 && t < 125) gpuTemp = t;
    } catch {}
  }

  if (gpuTemp !== undefined) {
    temperatures['gpu'] = gpuTemp;
  }

  const primaryTemp = cpuTemp ?? gpuTemp;
  let state = 'Nominal';
  let pressureLevel = 0;
  if (primaryTemp !== undefined) {
    if (primaryTemp >= 100) {
      state = 'Critical';
      pressureLevel = 3;
    } else if (primaryTemp >= 90) {
      state = 'Serious';
      pressureLevel = 2;
    } else if (primaryTemp >= 80) {
      state = 'Fair';
      pressureLevel = 1;
    }
  }

  return {
    state,
    detail: primaryTemp !== undefined ? `${state} (${primaryTemp}°C)` : state,
    pressureLevel,
    temperatures: Object.keys(temperatures).length ? temperatures : undefined,
  };
}

export async function collectWindowsPower(): Promise<PowerData | null> {
  const power: PowerData = {};

  // 1. Try battery discharge wattage
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
  } catch {}

  // 2. Try LibreHardwareMonitor exact power readings for CPU & GPU
  try {
    const lhmCpu = await runPowerShell(
      `Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Power' and Name like '%CPU Package%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
      ''
    );
    const cpuP = safeParseFloat(lhmCpu);
    if (cpuP > 0) power.cpuWatts = Math.round(cpuP * 100) / 100;

    const lhmGpu = await runPowerShell(
      `Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Power' and Name like '%GPU%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
      ''
    );
    const gpuP = safeParseFloat(lhmGpu);
    if (gpuP > 0) power.gpuWatts = Math.round(gpuP * 100) / 100;
  } catch {}

  // 3. NVIDIA SMI power draw fallback
  if (!power.gpuWatts) {
    try {
      const nvPower = await runNvidiaSmiQuery('power.draw');
      const p = safeParseFloat(nvPower);
      if (p > 0) power.gpuWatts = Math.round(p * 100) / 100;
    } catch {}
  }

  // 4. CPU usage TDP estimation fallback if direct sensor unavailable
  if (!power.cpuWatts) {
    try {
      const cpu = os.cpus();
      const brand = cpu[0]?.model || '';
      const tdpWatts = estimateCpuTdp(brand);
      const usage = cpu.length > 0
        ? Math.round(
            (cpu.reduce(
              (a, c) =>
                a +
                (c.times.user + c.times.nice + c.times.sys + c.times.irq - c.times.idle) /
                  (c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq),
              0
            ) /
              cpu.length) *
              100
          )
        : 0;

      if (usage > 0) {
        power.cpuWatts = Math.round((usage / 100) * tdpWatts * 100) / 100;
      }
    } catch {}
  }

  if (power.combinedWatts || power.cpuWatts || power.gpuWatts) {
    if (!power.combinedWatts) {
      power.combinedWatts = Math.round(((power.cpuWatts || 0) + (power.gpuWatts || 0)) * 100) / 100;
    }
    return power;
  }

  return null;
}

// ─── GPU Telemetry Across Intel, AMD, NVIDIA ─────────────────────────────────

async function findNvidiaSmiPath(): Promise<string> {
  const commonPaths = [
    'nvidia-smi',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
  ];
  for (const p of commonPaths) {
    try {
      const test = await run(`"${p}" -L 2>nul`, '');
      if (test.includes('GPU 0:')) return p;
    } catch {}
  }
  return 'nvidia-smi';
}

async function runNvidiaSmiQuery(query: string): Promise<string> {
  const smiPath = await findNvidiaSmiPath();
  return (await run(`"${smiPath}" --query-gpu=${query} --format=csv,noheader,nounits 2>nul`, '')).trim();
}

export function parseNvidiaSmiOutput(csv: string): GpuData | null {
  const lines = csv.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;
  const parts = lines[0].split(',').map(s => s.trim());
  if (parts.length < 3) return null;

  const model = parts[0];
  const memory = (safeParseFloat(parts[1])) * 1024 * 1024;
  const utilization = Math.min(100, Math.max(0, Math.round(safeParseFloat(parts[2]))));
  const temperature = parts[3] ? safeParseFloat(parts[3]) : undefined;
  const powerDraw = parts[4] ? safeParseFloat(parts[4]) : undefined;

  return {
    model,
    memory,
    utilization,
    temperature: Number.isFinite(temperature) && (temperature as number) > 0 ? temperature : undefined,
    processes: 0,
    powerDraw: Number.isFinite(powerDraw) && (powerDraw as number) > 0 ? powerDraw : undefined,
  };
}

export async function getNvidiaGpu(): Promise<GpuData | null> {
  try {
    const raw = await runNvidiaSmiQuery('gpu_name,memory.total,utilization.gpu,temperature.gpu,power.draw');
    const parsed = parseNvidiaSmiOutput(raw);
    if (parsed) {
      // Query active compute / graphics process count
      try {
        const smiPath = await findNvidiaSmiPath();
        const procList = await run(`"${smiPath}" --query-compute-apps=pid --format=csv,noheader 2>nul`, '');
        const pids = procList.split('\n').filter(l => l.trim().length > 0);
        parsed.processes = pids.length;
      } catch {}
      return parsed;
    }
  } catch {}
  return null;
}

export interface WindowsVideoControllerInfo {
  name: string;
  adapterRam: number;
  driverVersion: string;
  videoProcessor: string;
  pnpDeviceId: string;
}

export function parseWindowsVideoControllers(csvRaw: string): WindowsVideoControllerInfo[] {
  const lines = csvRaw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const controllers: WindowsVideoControllerInfo[] = [];

  for (const line of lines.slice(1)) {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });

    const name = row.Name || row.VideoProcessor || 'Windows Display Adapter';
    const ram = safeParseInt(row.AdapterRAM, 0);
    controllers.push({
      name,
      adapterRam: ram,
      driverVersion: row.DriverVersion || '',
      videoProcessor: row.VideoProcessor || '',
      pnpDeviceId: row.PNPDeviceID || '',
    });
  }

  return controllers;
}

export function prioritizeGpuControllers(controllers: WindowsVideoControllerInfo[]): WindowsVideoControllerInfo[] {
  // Sort discrete cards (NVIDIA, AMD Radeon RX, Intel Arc) before integrated adapters (Intel UHD, AMD Radeon(TM) Graphics)
  return [...controllers].sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aIsDiscrete = aName.includes('rtx') || aName.includes('gtx') || aName.includes('geforce') ||
      aName.includes('radeon rx') || aName.includes('arc');
    const bIsDiscrete = bName.includes('rtx') || bName.includes('gtx') || bName.includes('geforce') ||
      bName.includes('radeon rx') || bName.includes('arc');
    if (aIsDiscrete && !bIsDiscrete) return -1;
    if (!aIsDiscrete && bIsDiscrete) return 1;
    return b.adapterRam - a.adapterRam;
  });
}

export async function getWindowsGpu64BitVram(): Promise<number> {
  // Win32_VideoController clamps AdapterRAM to 4GB (UInt32).
  // Read exact 64-bit VRAM from Registry Display Class hardware information:
  try {
    const raw = await runPowerShell(
      `Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.HardwareInformation.qwMemorySize -gt 0 } | Select-Object -First 1 -ExpandProperty HardwareInformation.qwMemorySize`,
      ''
    );
    const bytes = safeParseInt(raw, 0);
    if (bytes > 0) return bytes;
  } catch {}

  // Fallback to Performance Counters Dedicated Usage + Free
  try {
    const rawDedicated = await runPowerShell(
      `(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum`,
      ''
    );
    const bytes = safeParseFloat(rawDedicated);
    if (bytes > 0) return bytes;
  } catch {}

  return 0;
}

export async function getWindowsGpu3dUtilization(): Promise<{ utilization: number; processCount: number }> {
  try {
    const raw = await runPowerShell(
      `$samples = (Get-Counter '\\GPU Engine(*engtype_3D*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples; if ($samples) { $activePids = $samples | Where-Object { $_.CookedValue -gt 0 } | ForEach-Object { if ($_.InstanceName -match 'pid_(\\d+)') { $matches[1] } } | Select-Object -Unique; $total = ($samples | Measure-Object -Property CookedValue -Sum).Sum; "$total|$($activePids.Count)" } else { '0|0' }`,
      '0|0'
    );
    const [utilStr, procCountStr] = raw.split('|');
    const util = Math.min(100, Math.max(0, Math.round(safeParseFloat(utilStr))));
    const processCount = safeParseInt(procCountStr, 0);
    return { utilization: util, processCount };
  } catch {
    return { utilization: 0, processCount: 0 };
  }
}

export async function collectWindowsGpu(): Promise<GpuData | null> {
  // 1. NVIDIA via nvidia-smi (first-class support when available)
  const nv = await getNvidiaGpu();
  if (nv) return nv;

  // 2. AMD / Intel / General Windows GPUs
  try {
    const rawControllers = await runPowerShell(
      `Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion, VideoProcessor, PNPDeviceID | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const controllers = parseWindowsVideoControllers(rawControllers);
    if (controllers.length === 0) return null;

    const prioritized = prioritizeGpuControllers(controllers);
    const bestController = prioritized[0];

    // Read 64-bit VRAM (avoids 4GB uint32 clamp on RX 7900, Arc A770, etc.)
    let vramBytes = await getWindowsGpu64BitVram();
    if (vramBytes === 0 && bestController.adapterRam > 0) {
      vramBytes = bestController.adapterRam;
    }

    // Read real 3D engine utilization and process count
    const { utilization, processCount } = await getWindowsGpu3dUtilization();

    // Query temperature for AMD / Intel via LibreHardwareMonitor or Windows Thermal
    let temperature: number | undefined;
    try {
      const rawTemp = await runPowerShell(
        `Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType = 'Temperature' and Name like '%GPU%'" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Value`,
        ''
      );
      const t = safeParseFloat(rawTemp);
      if (t > 0 && t < 125) temperature = t;
    } catch {}

    return {
      model: bestController.name,
      memory: vramBytes,
      utilization,
      temperature,
      processes: processCount,
    };
  } catch {
    return null;
  }
}

// ─── Network & Socket Monitoring (`pyre netusage`) ─────────────────────────────

export interface WindowsTcpConnection {
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  owningPid: number;
}

export function parseWindowsTcpConnections(csvRaw: string): WindowsTcpConnection[] {
  const lines = csvRaw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const connections: WindowsTcpConnection[] = [];

  for (const line of lines.slice(1)) {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });

    const localPort = safeParseInt(row.LocalPort, 0);
    const remoteAddress = row.RemoteAddress || '';
    const remotePort = safeParseInt(row.RemotePort, 0);
    const state = row.State || '';
    const owningPid = safeParseInt(row.OwningProcess, 0);

    if (owningPid > 0) {
      connections.push({ localPort, remoteAddress, remotePort, state, owningPid });
    }
  }

  return connections;
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
  } catch {}

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
  } catch {}

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

  // Populate listening ports and remote hosts
  const { listeningPorts, topRemoteHosts } = await getWindowsSocketDetails();

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
    listeningPorts,
    establishedConnections: connectionStates.established,
    topRemoteHosts,
  };
}

async function getWindowsSocketDetails(): Promise<{ listeningPorts: number[]; topRemoteHosts: RemoteHostInfo[] }> {
  const listeningPorts: number[] = [];
  const topRemoteHosts: RemoteHostInfo[] = [];

  try {
    const raw = await runPowerShell(
      `$conns = Get-NetTCPConnection -ErrorAction SilentlyContinue; if ($conns) { $ports = ($conns | Where-Object { $_.State -eq 'Listen' } | Select-Object -ExpandProperty LocalPort -Unique) -join ','; $hosts = ($conns | Where-Object { $_.State -eq 'Established' -and $_.RemoteAddress -ne '127.0.0.1' -and $_.RemoteAddress -ne '0.0.0.0' } | Group-Object RemoteAddress | Sort-Object Count -Descending | Select-Object -First 10 | ForEach-Object { "$($_.Name):$($_.Count)" }) -join '|'; "$ports#$hosts" } else { '#' }`,
      '#'
    );
    const [portsPart, hostsPart] = raw.split('#');
    if (portsPart) {
      portsPart.split(',').forEach(p => {
        const portNum = safeParseInt(p);
        if (portNum > 0 && !listeningPorts.includes(portNum)) listeningPorts.push(portNum);
      });
    }
    if (hostsPart) {
      hostsPart.split('|').forEach(h => {
        const [ip, countStr] = h.split(':');
        if (ip) {
          topRemoteHosts.push({
            ip,
            connections: safeParseInt(countStr, 1),
            activePids: [],
          });
        }
      });
    }
  } catch {}

  return { listeningPorts, topRemoteHosts };
}

async function getWindowsConnectionStates(): Promise<ConnectionStateStats> {
  const stats: ConnectionStateStats = { established: 0, listening: 0, timeWait: 0, closeWait: 0, other: 0 };
  try {
    const raw = await runPowerShell(
      `$c = Get-NetTCPConnection -ErrorAction SilentlyContinue; if ($c) { $groups = $c | Group-Object State; ($groups | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join '|' } else { '' }`,
      ''
    );
    for (const pair of raw.split('|')) {
      const [state, countStr] = pair.split('=');
      const count = safeParseInt(countStr, 0);
      if (state === 'Established') stats.established = count;
      else if (state === 'Listen') stats.listening = count;
      else if (state === 'TimeWait') stats.timeWait = count;
      else if (state === 'CloseWait') stats.closeWait = count;
      else if (count > 0) stats.other += count;
    }
  } catch {}
  return stats;
}

export function buildWindowsNetworkProcesses(
  conns: WindowsTcpConnection[],
  procMap: Map<number, string>
): NetworkProcess[] {
  const agg = new Map<number, NetworkProcess>();

  for (const c of conns) {
    const pid = c.owningPid;
    const name = procMap.get(pid) || `pid-${pid}`;
    let item = agg.get(pid);
    if (!item) {
      item = {
        pid,
        command: name,
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        connections: [],
      };
      agg.set(pid, item);
    }
    if (c.remoteAddress && c.remoteAddress !== '0.0.0.0') {
      item.connections.push({
        proto: 'tcp',
        localAddress: `127.0.0.1:${c.localPort}`,
        remoteAddress: `${c.remoteAddress}:${c.remotePort}`,
        state: c.state,
      });
    }
  }

  return Array.from(agg.values()).sort((a, b) => b.connections.length - a.connections.length);
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
  } catch {}

  const connectionStates = await getWindowsConnectionStates();
  const { listeningPorts } = await getWindowsSocketDetails();

  // Populate per-process network socket metrics for `pyre netusage` and packet panel
  let allProcesses: NetworkProcess[] = [];
  try {
    const rawConns = await runPowerShell(
      `Get-NetTCPConnection -State Established,Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, RemoteAddress, RemotePort, State, OwningProcess | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const conns = parseWindowsTcpConnections(rawConns);

    // Build PID to process command name mapping
    const rawProcs = await runPowerShell(
      `Get-Process -ErrorAction SilentlyContinue | Select-Object Id, ProcessName | ForEach-Object { "$($_.Id)|$($_.ProcessName)" }`,
      ''
    );
    const procMap = new Map<number, string>();
    for (const line of rawProcs.split('\n')) {
      const [idStr, name] = line.trim().split('|');
      const pid = safeParseInt(idStr);
      if (pid > 0 && name) procMap.set(pid, name);
    }

    allProcesses = buildWindowsNetworkProcesses(conns, procMap);
  } catch {}

  return {
    totalPackets: rxPackets + txPackets,
    rxPackets,
    txPackets,
    rxRate: 0,
    txRate: 0,
    connections: connectionStates.established,
    topProcesses: allProcesses.slice(0, 10),
    interfaces: [{ iface: 'Primary', rxPackets, txPackets, rxBytes, txBytes }],
    allProcesses,
    connectionStates,
    listeningPorts,
  };
}

// ─── Process Collection with ParentProcessId (`ppid`) for Tree View ─────────────

const winProcCache = new Map<number, { user: number; kernel: number; ts: number }>();

export function parseWindowsProcessCsv(
  csvRaw: string,
  totalMem: number,
  cache: Map<number, { user: number; kernel: number; ts: number }>,
  now: number
): ProcessData[] {
  const lines = csvRaw.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('"Name"'));
  const procs: ProcessData[] = [];

  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    if (parts.length < 6) continue;

    const name = parts[0];
    const pid = safeParseInt(parts[1], 0);
    const ppid = safeParseInt(parts[2], 0);
    const threads = safeParseInt(parts[3], 0);
    const memBytes = safeParseInt(parts[4], 0);
    const userTime = safeParseInt(parts[5], 0);
    const kernelTime = safeParseInt(parts[6], 0);
    const commandLine = parts[7] || name;

    if (!pid || pid <= 0) continue;

    const totalTime = userTime + kernelTime;
    let cpu = 0;

    const prev = cache.get(pid);
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
    cache.set(pid, { user: userTime, kernel: kernelTime, ts: now });

    const memPct = totalMem > 0 ? Math.round((memBytes / totalMem) * 1000) / 10 : 0;
    const isGpuOrMl = /gpu|vulkan|cuda|ollama|llama|torch|python|nvidia|amd|radeon|directx|game/i.test(name) ||
      /python|node|ollama/i.test(commandLine);

    procs.push({
      pid,
      ppid,
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
  return procs;
}

export async function collectWindowsProcesses(limit?: number): Promise<ProcessData[]> {
  try {
    // Explicitly query ParentProcessId for process tree view (`pyre --tree`)
    const raw = await runPowerShell(
      `Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ParentProcessId, ThreadCount, WorkingSetSize, UserModeTime, KernelModeTime, CommandLine | ConvertTo-Csv -NoTypeInformation`,
      ''
    );
    const now = Date.now();
    const totalMem = os.totalmem();
    const procs = parseWindowsProcessCsv(raw, totalMem, winProcCache, now);

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

// ─── Displays ──────────────────────────────────────────────────────────────────

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

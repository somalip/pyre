import chalk from 'chalk';
import Table from 'cli-table3';

export interface StatsData {
  header: { title: string; hostname: string; os: string; uptime: string };
  cpu: CpuData;
  memory: MemoryData;
  disk: DiskData[];
  battery: BatteryData | null;
  thermal: ThermalData;
  network: NetworkData;
  processes: ProcessData[];
  timestamp: string;
}

export interface CpuData {
  brand: string;
  cores: number;
  physicalCores: number;
  frequency: number;
  usage: number;
  loadAvg: number[];
  temperature?: number;
}

export interface MemoryData {
  total: number;
  used: number;
  free: number;
  swapTotal: number;
  swapUsed: number;
  swapFree: number;
  pageSize: number;
  usagePercent: number;
}

export interface ThermalData {
  state: string;
  detail?: string;
  temperatures?: Record<string, number | null>;
  error?: string;
}

export interface BatteryData {
  level: number;
  state: string;
  timeRemaining: string;
  health: string;
  powerSource: string;
  cycles?: number;
}

export interface DiskData {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  capacity: string;
  mountpoint: string;
}

export interface NetworkData {
  interface: string;
  ip: string;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
}

export interface ProcessData {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

async function run(cmd: string, fallback: string = '-1 -1'): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch {
    return fallback;
  }
}

function parseSuffix(s: string): number {
  return s.toUpperCase() === 'K' ? 1024 : s.toUpperCase() === 'M' ? 1024 * 1024 : s.toUpperCase() === 'G' ? 1024 * 1024 * 1024 : 1;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function collectAll(opts: { detailed?: boolean } = {}): Promise<StatsData> {
  const [cpu, memory, disk, battery, thermal, network, processes, system] = await Promise.all([
    collectCpu(),
    collectMemory(),
    collectDisk(),
    collectBattery(),
    collectThermal(opts.detailed),
    collectNetwork(),
    collectProcesses(),
    collectSystem(),
  ]);

  return {
    header: {
      title: chalk.hex('#ff5500').bold('PYRE'),
      hostname: system.hostname,
      os: system.os,
      uptime: system.uptime,
    },
    cpu,
    memory,
    disk,
    battery,
    thermal,
    network,
    processes,
    timestamp: new Date().toISOString(),
  };
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
  const brand = (await run('sysctl -n machdep.cpu.brand_string', 'Unknown CPU')).trim();
  const cores = parseInt((await run('sysctl -n hw.ncpu')).trim()) || 1;
  const physicalCores = parseInt((await run('sysctl -n hw.physicalcpu')).trim()) || cores;
  const frequencyHz = parseInt((await run('sysctl -n hw.cpufrequency')).trim());
  const frequency = frequencyHz > 0 ? Math.round(frequencyHz / 1_000_000) : 0;

  let usage = 0;
  try {
    const top = (await run('top -l 1 -n 0')).trim();
    const cpuLine = top.match(/CPU usage: (.+?);/);
    if (cpuLine) {
      const idle = parseFloat(cpuLine[1].match(/([\d.]+)% idle/)?.[1] || '0');
      usage = Math.round(100 - idle);
    }
  } catch {
    // ignore
  }

  const loadAvgStr = (await run('sysctl -n vm.loadavg', '0.00 0.00 0.00')).trim();
  const loadAvg = loadAvgStr.match(/\{ (.+?) \}/)?.[1].split(' ').map(Number) || [0, 0, 0];

  let temperature: number | undefined;
  try {
    const therm = (await run('pmset -g therm')).trim();
    const tempMatch = therm.match(/CPU.*?temp:\s+([\d.]+)/i);
    if (tempMatch) temperature = parseFloat(tempMatch[1]);
  } catch {
    // ignore
  }

  return { brand, cores, physicalCores, frequency, usage, loadAvg, temperature };
}

export async function collectMemory(): Promise<MemoryData> {
  const totalBytes = parseInt((await run('sysctl -n hw.memsize')).trim()) || 0;
  const pageSize = parseInt((await run('sysctl -n hw.pagesize', '4096')).trim()) || 4096;

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
    const swapMatch = swapRaw.match(/total\s+=\s+([\d.]+)([KMG])\s+\(\s+([\d.]+)([KMG])\s+used/);
    if (swapMatch) {
      swapTotal = parseFloat(swapMatch[1]) * parseSuffix(swapMatch[2]);
      swapUsed = parseFloat(swapMatch[3]) * parseSuffix(swapMatch[4]);
      swapFree = swapTotal - swapUsed;
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
    const timeMatch = raw.match(/:\s*([\d:]+)\s+remaining/i);
    const powerPlugged = raw.includes('AC Power') || raw.includes('attached to charger');

    const level = levelMatch ? parseInt(levelMatch[1]) : 0;
    const state = powerPlugged ? 'charged' : (stateMatch ? stateMatch[1].toLowerCase() : 'discharging');
    const timeRemaining = timeMatch ? timeMatch[1] : (powerPlugged ? '∞' : 'calculating');

    let cycles: number | undefined;
    let health = 'unknown';
    try {
      const battInfo = (await run('system_profiler SPPowerDataType -json 2>/dev/null || system_profiler SPPowerDataType 2>/dev/null || echo "skip"')).trim();
      const cycleMatch = battInfo.match(/Cycle Count:\s+(\d+)/);
      if (cycleMatch) {
        cycles = parseInt(cycleMatch[1]);
        health = `cycles: ${cycles}`;
      }
    } catch {
      // ignore
    }

    return {
      level,
      state,
      timeRemaining,
      health,
      powerSource: powerPlugged ? 'AC' : 'Battery',
      cycles,
    };
  } catch {
    return null;
  }
}

export async function collectThermal(detailed?: boolean): Promise<ThermalData> {
  try {
    const therm = (await run('pmset -g therm')).trim();
    let state = 'Unknown';
    let detail = therm;

    const stateMatch = therm.match(/Thermal state:\s*(.+)/);
    if (stateMatch) {
      state = stateMatch[1].trim();
      detail = state;
    }

    const temperatures: Record<string, number | null> = {};

    if (detailed) {
      try {
        const pm = (await run('sudo powermetrics --samplers smc -n 1 2>/dev/null || powermetrics --samplers smc -n 1 2>/dev/null', '')).trim();
        if (pm) {
          for (const line of pm.split('\n')) {
            if (line.includes('CPU die temperature')) {
              const m = line.match(/CPU die temperature:\s*([\d.]+)/);
              if (m) temperatures['cpu_die'] = parseFloat(m[1]);
            }
            if (line.includes('GPU die temperature')) {
              const m = line.match(/GPU die temperature:\s*([\d.]+)/);
              if (m) temperatures['gpu_die'] = parseFloat(m[1]);
            }
            if (line.includes('SMC die temperature')) {
              const m = line.match(/SMC die temperature:\s*([\d.]+)/);
              if (m) temperatures['smc_die'] = parseFloat(m[1]);
            }
            if (line.includes('CPU Power')) {
              const m = line.match(/CPU Power:\s*([\d.]+)/);
              if (m) temperatures['cpu_power'] = parseFloat(m[1]);
            }
          }
        }
      } catch {
        state += ' (powermetrics unavailable)';
      }
    }

    return { state, detail, temperatures: Object.keys(temperatures).length ? temperatures : undefined };
  } catch {
    return { state: 'Unknown', error: 'Thermal info unavailable on this system' };
  }
}

export async function collectNetwork(): Promise<NetworkData> {
  try {
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

    const netStat = (await run('netstat -ib')).trim();
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

export async function collectProcesses(): Promise<ProcessData[]> {
  try {
    const raw = (await run("ps -Ao pid,user,pcpu,pmem,comm -r | head -n 11")).trim();
    const lines = raw.split('\n').slice(1);
    return lines
      .map(line => {
        const parts = line.match(/\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)/);
        if (!parts) return null;
        return { pid: parseInt(parts[1]), user: parts[2], cpu: parseFloat(parts[3]), mem: parseFloat(parts[4]), command: parts[5] };
      })
      .filter((p): p is ProcessData => p !== null && p.pid > 0);
  } catch {
    return [];
  }
}

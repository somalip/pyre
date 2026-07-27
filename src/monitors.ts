import chalk from 'chalk';

export interface StatsData {
  header: { title: string; hostname: string; os: string; uptime: string };
  cpu: CpuData;
  memory: MemoryData;
  disk: DiskData[];
  battery: BatteryData | null;
  thermal: ThermalData;
  network: NetworkData;
  processes: ProcessData[];
  power: PowerData | null;
  timestamp: string;
}

export interface PowerData {
  cpuWatts?: number;
  gpuWatts?: number;
  combinedWatts?: number;
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
  /** Normalized 0-3 scale (nominal/fair/serious/critical) derived from `state`, for graphing/coloring */
  pressureLevel: number;
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
  condition?: string;
  maxCapacityPercent?: number;
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

async function run(cmd: string, fallback: string = ''): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch {
    return fallback;
  }
}

// --- shared SMC sensor reader (temperature + power) ---
// The old code tried to read CPU temperature out of `pmset -g therm`, but that
// command doesn't report a "CPU ... temp:" field on Apple Silicon (or most
// recent Intel) Macs — it only reports scheduler/speed limits — so
// `temperature` was silently always undefined. Real sensor data on modern
// macOS requires `powermetrics`, which needs root. We call it once per tick
// (with a short-lived cache) and share the result between the CPU temp field
// and the detailed thermal panel instead of invoking it twice.
interface SmcMetrics {
  temps: Record<string, number>;
  power: { cpu?: number; gpu?: number; combined?: number };
}

let smcCache: { data: SmcMetrics; ts: number } | null = null;

async function getSmcMetrics(): Promise<SmcMetrics> {
  const now = Date.now();
  if (smcCache && now - smcCache.ts < 1500) return smcCache.data;

  const result: SmcMetrics = { temps: {}, power: {} };
  try {
    // `sudo -n` (non-interactive) so we never hang waiting on a password
    // prompt that can't be answered from a piped child process; if the user
    // hasn't set up passwordless sudo for powermetrics, this just fails fast
    // and we fall back to the thermal-state string instead of a temperature.
    const pm = (
      await run(
        'sudo -n powermetrics --samplers smc,cpu_power -n 1 --format text 2>/dev/null',
        ''
      )
    ).trim();

    if (pm) {
      const cpuTemp = pm.match(/CPU die temperature:\s*([\d.]+)/i);
      if (cpuTemp) result.temps['cpu_die'] = parseFloat(cpuTemp[1]);

      const gpuTemp = pm.match(/GPU die temperature:\s*([\d.]+)/i);
      if (gpuTemp) result.temps['gpu_die'] = parseFloat(gpuTemp[1]);

      const smcTemp = pm.match(/SMC die temperature:\s*([\d.]+)/i);
      if (smcTemp) result.temps['smc_die'] = parseFloat(smcTemp[1]);

      const cpuPower = pm.match(/CPU Power:\s*([\d.]+)\s*mW/i);
      if (cpuPower) result.power.cpu = parseFloat(cpuPower[1]) / 1000;

      const gpuPower = pm.match(/GPU Power:\s*([\d.]+)\s*mW/i);
      if (gpuPower) result.power.gpu = parseFloat(gpuPower[1]) / 1000;

      const combinedPower = pm.match(/Combined Power \(CPU \+ GPU.*?\):\s*([\d.]+)\s*mW/i);
      if (combinedPower) result.power.combined = parseFloat(combinedPower[1]) / 1000;
    }
  } catch {
    // powermetrics unavailable/unauthorized — leave temps/power empty, the
    // rest of the app degrades gracefully (thermal state string still shows).
  }

  smcCache = { data: result, ts: now };
  return result;
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

export async function collectAll(opts: { detailed?: boolean; processLimit?: number } = {}): Promise<StatsData> {
  const [cpu, memory, disk, battery, thermal, network, processes, system, power] = await Promise.all([
    collectCpu(),
    collectMemory(),
    collectDisk(),
    collectBattery(),
    collectThermal(opts.detailed),
    collectNetwork(),
    collectProcesses(opts.processLimit ?? 10),
    collectSystem(),
    collectPower(),
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
    power,
    timestamp: new Date().toISOString(),
  };
}

export async function collectPower(): Promise<PowerData | null> {
  try {
    const { power } = await getSmcMetrics();
    if (power.cpu === undefined && power.gpu === undefined && power.combined === undefined) return null;
    return { cpuWatts: power.cpu, gpuWatts: power.gpu, combinedWatts: power.combined };
  } catch {
    return null;
  }
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
    const timeMatch = raw.match(/:\s*([\d:]+)\s+remaining/i);
    const powerPlugged = raw.includes('AC Power') || raw.includes('attached to charger');

    const level = levelMatch ? parseInt(levelMatch[1]) : 0;
    const state = powerPlugged ? 'charged' : (stateMatch ? stateMatch[1].toLowerCase() : 'discharging');
    const timeRemaining = timeMatch ? timeMatch[1] : (powerPlugged ? '∞' : 'calculating');

    let cycles: number | undefined;
    let condition: string | undefined;
    let maxCapacityPercent: number | undefined;

    try {
      // Plain text output (NOT -json) — its field names ("Cycle Count:", "Condition:")
      // are what the regexes below expect. Using -json here was the original bug:
      // it silently returned JSON that these text regexes could never match, so
      // health always fell back to 'unknown'.
      const battInfo = (await run('system_profiler SPPowerDataType 2>/dev/null')).trim();

      const cycleMatch = battInfo.match(/Cycle Count:\s+(\d+)/);
      if (cycleMatch) cycles = parseInt(cycleMatch[1]);

      const conditionMatch = battInfo.match(/Condition:\s+(.+)/);
      if (conditionMatch) condition = conditionMatch[1].trim();

      const maxCapMatch = battInfo.match(/Maximum Capacity:\s+(\d+)%/);
      if (maxCapMatch) {
        maxCapacityPercent = parseInt(maxCapMatch[1]);
      } else {
        // Older/alternate output reports Full Charge Capacity vs Design Capacity
        // instead of a direct percentage — derive it if both are present.
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

    return {
      level,
      state,
      timeRemaining,
      health,
      powerSource: powerPlugged ? 'AC' : 'Battery',
      cycles,
      condition,
      maxCapacityPercent,
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

export async function collectProcesses(limit = 10): Promise<ProcessData[]> {
  try {
    const raw = (await run(`ps -Ao pid,user,pcpu,pmem,comm -r | head -n ${limit + 1}`)).trim();
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
/**
 * pyre ports — Interactive Listening Port, Socket & Local Dev Server Inspector.
 *
 * Scans active TCP/UDP listening ports, maps them to owning PIDs, process
 * commands, CPU/RAM footprint, and service stack (Node/Vite/Next, Python,
 * Postgres, Redis, Docker, Ollama, etc.), flags LAN-exposed ports (0.0.0.0 / *),
 * and supports one-shot termination of processes occupying a specific port.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export interface ListeningPortEntry {
  port: number;
  protocol: 'TCP' | 'UDP';
  bindAddress: string;
  exposure: 'LOCAL' | 'LAN';
  pid: number;
  processName: string;
  user: string;
  cpuPct: number;
  memPct: number;
  command: string;
  serviceStack: string;
}

/**
 * Determine whether a bind address is strictly loopback-isolated ('LOCAL')
 * or exposed to the network ('LAN').
 */
export function detectExposure(bindAddress: string): 'LOCAL' | 'LAN' {
  const clean = bindAddress.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === 'localhost' ||
    clean.startsWith('127.')
  ) {
    return 'LOCAL';
  }
  return 'LAN';
}

/**
 * Auto-classify the developer/system service stack from the port number,
 * process name, and full command string.
 */
export function classifyServiceStack(port: number, processName: string, command: string): string {
  const proc = processName.toLowerCase();
  const cmd = command.toLowerCase();

  if (proc.includes('ollama') || cmd.includes('ollama') || port === 11434) return 'Ollama (LLM)';
  if (proc.includes('llama') || cmd.includes('llama-server') || cmd.includes('mlx_lm')) return 'Local LLM';
  if (cmd.includes('vite') || port === 5173 || port === 4173) return 'Vite Dev';
  if (cmd.includes('next') || cmd.includes('next-server')) return 'Next.js';
  if (proc.includes('postgres') || port === 5432) return 'PostgreSQL';
  if (proc.includes('redis') || port === 6379) return 'Redis';
  if (proc.includes('mysqld') || proc.includes('mariadbd') || port === 3306) return 'MySQL/MariaDB';
  if (proc.includes('mongod') || port === 27017) return 'MongoDB';
  if (proc.includes('docker') || proc.includes('com.docker') || proc.includes('orbstack') || proc.includes('podman')) return 'Container';
  if (proc.includes('node') || proc.includes('bun') || proc.includes('deno') || proc.includes('tsx')) return 'JS/TS Runtime';
  if (proc.includes('python') || proc.includes('uvicorn') || proc.includes('gunicorn') || proc.includes('flask')) return 'Python/API';
  if (proc.includes('go') || cmd.includes('go-build')) return 'Go Service';
  if (proc.includes('cargo') || proc.includes('rust')) return 'Rust Service';
  if (proc.includes('java') || proc.includes('gradle')) return 'JVM Service';
  if (proc.includes('nginx') || proc.includes('caddy') || proc.includes('httpd') || proc.includes('apache')) return 'Web Proxy';
  if (proc.includes('sshd') || port === 22) return 'SSH Daemon';
  if (proc.includes('controlce') || proc.includes('rapportd') || proc.includes('sharingd')) return 'macOS AirPlay/Sync';
  if (port === 3000 || port === 8000 || port === 8080 || port === 4000 || port === 5000 || port === 9090) return 'Dev HTTP';
  if (port === 80 || port === 443) return 'HTTP/TLS';
  if (port === 53 || proc.includes('mDNS') || proc.includes('dnsmasq')) return 'DNS';
  return 'System/App';
}

/**
 * Parse `lsof -iTCP -sTCP:LISTEN -P -n` output into structured port entries.
 */
export function parseListeningLsof(
  lsofOutput: string,
  psMetaMap?: Map<number, { cpuPct: number; memPct: number; command: string }>
): ListeningPortEntry[] {
  const entries: ListeningPortEntry[] = [];
  const seen = new Set<string>();
  const lines = lsofOutput.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('COMMAND')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const processName = parts[0].replace(/\\x20/g, ' ');
    const pid = parseInt(parts[1], 10);
    const user = parts[2];
    if (isNaN(pid)) continue;

    const protoToken = parts.find(p => p === 'TCP' || p === 'UDP') || 'TCP';
    const protocol = (protoToken === 'UDP' ? 'UDP' : 'TCP') as 'TCP' | 'UDP';

    const nameIdx = parts.indexOf(protoToken) + 1;
    if (nameIdx <= 0 || nameIdx >= parts.length) continue;

    const addrPort = parts[nameIdx];
    const lastColon = addrPort.lastIndexOf(':');
    if (lastColon === -1) continue;

    const bindAddress = addrPort.slice(0, lastColon);
    const port = parseInt(addrPort.slice(lastColon + 1), 10);
    if (isNaN(port) || port <= 0) continue;

    const dedupKey = `${protocol}:${port}:${pid}:${bindAddress}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const meta = psMetaMap?.get(pid);
    const cpuPct = meta?.cpuPct ?? 0;
    const memPct = meta?.memPct ?? 0;
    const command = meta?.command || processName;
    const exposure = detectExposure(bindAddress);
    const serviceStack = classifyServiceStack(port, processName, command);

    entries.push({
      port,
      protocol,
      bindAddress,
      exposure,
      pid,
      processName,
      user,
      cpuPct,
      memPct,
      command,
      serviceStack,
    });
  }

  return entries.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/**
 * Parse Windows `netstat -ano` listening lines into structured port entries.
 */
export function parseWindowsListeningNetstat(
  netstatOutput: string,
  psMetaMap?: Map<number, { processName: string; user: string; cpuPct: number; memPct: number; command: string }>
): ListeningPortEntry[] {
  const entries: ListeningPortEntry[] = [];
  const seen = new Set<string>();
  const lines = netstatOutput.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('TCP') && !line.startsWith('UDP')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    const protocol = parts[0].toUpperCase() as 'TCP' | 'UDP';
    const localAddr = parts[1];
    const stateOrPid = parts[3];
    const isListening = protocol === 'TCP' ? stateOrPid === 'LISTENING' : true;
    if (!isListening) continue;

    const pidStr = protocol === 'TCP' ? parts[4] : parts[3];
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid) || pid <= 0) continue;

    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon === -1) continue;
    const bindAddress = localAddr.slice(0, lastColon);
    const port = parseInt(localAddr.slice(lastColon + 1), 10);
    if (isNaN(port) || port <= 0) continue;

    const dedupKey = `${protocol}:${port}:${pid}:${bindAddress}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const meta = psMetaMap?.get(pid);
    const processName = meta?.processName || `pid-${pid}`;
    const command = meta?.command || processName;
    const exposure = detectExposure(bindAddress);
    const serviceStack = classifyServiceStack(port, processName, command);

    entries.push({
      port,
      protocol,
      bindAddress,
      exposure,
      pid,
      processName,
      user: meta?.user || 'system',
      cpuPct: meta?.cpuPct ?? 0,
      memPct: meta?.memPct ?? 0,
      command,
      serviceStack,
    });
  }

  return entries.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/**
 * Gather process CPU%, MEM%, and full command map from `ps` to enrich port entries.
 */
function buildPsMetaMap(): Map<number, { cpuPct: number; memPct: number; command: string }> {
  const map = new Map<number, { cpuPct: number; memPct: number; command: string }>();
  if (process.platform === 'win32') return map;
  try {
    const out = execSync('ps -axo pid,%cpu,%mem,comm 2>/dev/null || true', { encoding: 'utf-8', timeout: 2500 });
    for (const raw of out.split('\n').slice(1)) {
      const m = raw.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
      if (m) {
        map.set(parseInt(m[1], 10), {
          cpuPct: parseFloat(m[2]) || 0,
          memPct: parseFloat(m[3]) || 0,
          command: m[4].trim(),
        });
      }
    }
  } catch {
    // ignore ps errors
  }
  return map;
}

/**
 * Collect all active listening ports on the system.
 */
export function collectListeningPorts(opts?: { portFilter?: number[] }): ListeningPortEntry[] {
  let entries: ListeningPortEntry[] = [];

  if (process.platform === 'win32') {
    try {
      const netstatOut = execSync('netstat -ano', { encoding: 'utf-8', timeout: 3000 });
      entries = parseWindowsListeningNetstat(netstatOut);
    } catch {
      entries = [];
    }
  } else {
    const psMap = buildPsMetaMap();
    try {
      const lsofOut = execSync('lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || true', {
        encoding: 'utf-8',
        timeout: 3500,
        maxBuffer: 4 * 1024 * 1024,
      });
      entries = parseListeningLsof(lsofOut, psMap);
    } catch {
      entries = [];
    }
  }

  if (opts?.portFilter && opts.portFilter.length > 0) {
    const filterSet = new Set(opts.portFilter);
    entries = entries.filter(e => filterSet.has(e.port));
  }

  return entries;
}

/**
 * Terminate processes listening on a target port, with safety guardrails for PID 0/1/self.
 */
export function killPortProcesses(
  port: number,
  opts?: { signal?: NodeJS.Signals; dryRun?: boolean; entries?: ListeningPortEntry[] }
): { killedPids: number[]; skippedProtected: number[]; errors: string[] } {
  const list = opts?.entries ?? collectListeningPorts({ portFilter: [port] });
  const matching = list.filter(e => e.port === port);
  const uniquePids = Array.from(new Set(matching.map(e => e.pid)));

  const killedPids: number[] = [];
  const skippedProtected: number[] = [];
  const errors: string[] = [];
  const signal = opts?.signal || 'SIGTERM';

  for (const pid of uniquePids) {
    if (pid <= 1 || pid === 4 || pid === process.pid || pid === process.ppid) {
      skippedProtected.push(pid);
      continue;
    }
    if (opts?.dryRun) {
      killedPids.push(pid);
      continue;
    }
    try {
      process.kill(pid, signal);
      killedPids.push(pid);
    } catch (err: any) {
      errors.push(`PID ${pid}: ${err.message}`);
    }
  }

  return { killedPids, skippedProtected, errors };
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

/**
 * Format listening ports into styled table lines for both the Live TUI `ports` panel
 * and CLI output.
 */
export function formatPortsPanelLines(
  entries: ListeningPortEntry[],
  contentWidth: number
): string[] {
  if (!entries.length) {
    return [chalk.dim('No listening TCP ports detected.')];
  }

  const portW = 7;
  const expW = 8;
  const pidW = 8;
  const procW = 16;
  const stackW = 16;
  const cpuW = 7;
  const memW = 7;
  const bindW = Math.max(10, contentWidth - (portW + expW + pidW + procW + stackW + cpuW + memW + 14));

  const header = chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
    ' PORT'.padEnd(portW) + '  ' +
    'SCOPE'.padEnd(expW) + '  ' +
    'PID'.padEnd(pidW) + '  ' +
    'PROCESS'.padEnd(procW) + '  ' +
    'STACK'.padEnd(stackW) + '  ' +
    'CPU%'.padStart(cpuW) + '  ' +
    'MEM%'.padStart(memW) + '  ' +
    'BIND ADDRESS'.padEnd(bindW)
  );

  const lines: string[] = [header, chalk.dim('─'.repeat(Math.max(20, contentWidth)))];

  for (const e of entries) {
    const portStr = chalk.bold.hex('#38bdf8')(`:${e.port}`.padEnd(portW));
    const scopeStr = e.exposure === 'LAN'
      ? chalk.bgHex('#7f1d1d').hex('#fecaca').bold(' LAN    ')
      : chalk.bgHex('#064e3b').hex('#a7f3d0')(' LOCAL  ');
    const pidStr = chalk.hex('#94a3b8')(String(e.pid).padEnd(pidW));
    const procStr = chalk.bold.hex('#f8fafc')(truncatePlain(e.processName, procW).padEnd(procW));
    const stackStr = chalk.hex('#f59e0b')(truncatePlain(e.serviceStack, stackW).padEnd(stackW));
    const cpuStr = (e.cpuPct > 25 ? chalk.hex('#f43f5e') : chalk.hex('#10b981'))(`${e.cpuPct.toFixed(1)}%`.padStart(cpuW));
    const memStr = chalk.hex('#cbd5e1')(`${e.memPct.toFixed(1)}%`.padStart(memW));
    const bindStr = chalk.dim(truncatePlain(e.bindAddress, bindW).padEnd(bindW));

    lines.push(
      `${portStr}  ${scopeStr}  ${pidStr}  ${procStr}  ${stackStr}  ${cpuStr}  ${memStr}  ${bindStr}`
    );
  }

  return lines;
}

export async function runPortsCommand(opts?: {
  portArg?: string;
  killPort?: number;
  json?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  if (opts?.killPort !== undefined && !isNaN(opts.killPort) && opts.killPort > 0) {
    const port = opts.killPort;
    const entries = collectListeningPorts({ portFilter: [port] });
    if (entries.length === 0) {
      console.log(chalk.yellow(`\n  ⚠ No process found listening on port :${port}\n`));
      return;
    }
    const res = killPortProcesses(port, { dryRun: opts.dryRun, entries });
    if (opts.json) {
      console.log(JSON.stringify({ port, ...res, entries }, null, 2));
      return;
    }
    console.log(chalk.bold(`\n  🔥 pyre ports — Port Termination (: ${port})\n`));
    for (const e of entries) {
      console.log(`  • Found PID ${chalk.bold(String(e.pid))} (${chalk.cyan(e.processName)} — ${e.serviceStack}) bound to ${e.bindAddress}:${e.port}`);
    }
    if (res.killedPids.length > 0) {
      const verb = opts.dryRun ? 'Would terminate' : 'Terminated';
      console.log(chalk.green(`\n  ✔ ${verb} PID(s): ${res.killedPids.join(', ')}\n`));
    }
    if (res.skippedProtected.length > 0) {
      console.log(chalk.yellow(`  ⚠ Skipped protected system PID(s): ${res.skippedProtected.join(', ')}\n`));
    }
    if (res.errors.length > 0) {
      for (const err of res.errors) {
        console.log(chalk.red(`  ✖ ${err}`));
      }
      console.log();
    }
    return;
  }

  const portFilter = opts?.portArg
    ? opts.portArg
        .split(',')
        .map(s => parseInt(s.trim().replace(/^:/, ''), 10))
        .filter(n => !isNaN(n) && n > 0)
    : undefined;

  const entries = collectListeningPorts({ portFilter });

  if (opts?.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      totalListeningPorts: entries.length,
      lanExposedCount: entries.filter(e => e.exposure === 'LAN').length,
      localOnlyCount: entries.filter(e => e.exposure === 'LOCAL').length,
      ports: entries,
    }, null, 2));
    return;
  }

  const width = Math.min(120, Math.max(80, (process.stdout.columns || 100) - 4));
  const lanCount = entries.filter(e => e.exposure === 'LAN').length;
  const localCount = entries.filter(e => e.exposure === 'LOCAL').length;

  console.log(chalk.bold('\n  🔥 pyre ports — Active Listening Ports & Local Dev Servers\n'));
  console.log(
    `  Listening Ports: ${chalk.bold.cyan(String(entries.length))}   ` +
    `Localhost Only: ${chalk.green(String(localCount))}   ` +
    `LAN Exposed (0.0.0.0/*): ${lanCount > 0 ? chalk.yellow.bold(String(lanCount)) : chalk.dim('0')}\n`
  );

  for (const line of formatPortsPanelLines(entries, width)) {
    console.log(`  ${line}`);
  }

  console.log(chalk.dim('\n  Tip: Filter by port with `pyre ports 3000` or free a port with `pyre ports --kill 3000`\n'));
}

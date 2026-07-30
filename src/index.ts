#!/usr/bin/env node
/**
 * pyre - Mac system monitoring CLI
 * Monitors temps, cpu, memory, disk, battery, and system stats.
 * Live mode is a full interactive dashboard: graphs, pause/resume,
 * on-demand snapshot export, and continuous CSV logging.
 * P2P mode enables live data streaming between two systems over TCP.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { collectAll } from './monitors/index.js';
import { formatTable, formatJson, formatCsv, formatTsv, formatHtml, formatMarkdown, formatBytes } from './formatters/index.js';
import { startLive, stopLive } from './live/index.js';
import { showSplash } from './splash.js';
import { P2PServer, P2PClient } from './p2p/index.js';
import { readConfig } from './state/config.js';
import { CONFIG_FILE } from './state/config.js';

const config = readConfig();

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const program = new Command();

program
    .name('pyre')
    .version(pkg.version)
    .description('Mac system monitoring CLI: interactive live dashboard, stats, graphs, export, packet monitor, battery predictor')
    .option('-j, --json', 'Output as JSON')
    .option('--html', 'Output as HTML')
    .option('--md', 'Output as Markdown')
    .option('-c, --csv', 'Output as CSV')
    .option('-t, --tsv', 'Output as TSV')
    .option('--detailed', 'Include detailed system info and sensor readings')
    .option('--theme <name>', 'Default theme for live mode (default, dracula, cyberpunk, monochrome, nord, gruvbox)', config.theme)
    .option('--interval <seconds>', 'Refresh interval for live mode', String(config.interval))
    .option('--once', 'Show a single static snapshot instead of live feed')
    .option('--out <file>', 'Also write the snapshot output to a file (--once/--json/--csv/--tsv modes)')
    .option('--export-dir <dir>', 'Directory used for live-mode snapshot exports and logs', config.exportDir)
    .option('--log', 'Start continuous CSV logging immediately when live mode starts')
    .option('--tree', 'Show process tree view instead of flat list')
    .option('--sort <key>', 'Sort processes by: cpu, mem, pid, user, command, state, threads, runtime', config.sortMode)
    .option('--packets', 'Include packet monitor panel in output')
    .option('--limit <n>', 'Max number of processes to include in --once/--json/--csv/--tsv snapshots (0 = all)', '10')
    .option('--alert-cpu <pct>', 'CPU usage alert threshold (default: 90)', String(config.cpuAlertPct))
    .option('--alert-temp <c>', 'CPU temperature alert threshold in Celsius (default: 95)', String(config.tempAlertC))
    .option('--temp-unit <unit>', 'Temperature display unit: c or f (default: c)', 'c')
    .option('--p2p-host <host>', 'P2P host address (server: bind address, client: server address)')
    .option('--p2p-port <port>', 'P2P port number', '9876')
    .option('--p2p-password <password>', 'Password for P2P authentication')
    .option('--p2p-tls', 'Enable TLS encryption for P2P connections')
    .option('--p2p-cert <file>', 'TLS certificate file (PEM) for P2P server')
    .option('--p2p-key <file>', 'TLS private key file (PEM) for P2P server')
    .option('--p2p-ca <file>', 'TLS CA certificate file (PEM) for P2P client')
    .option('--p2p-insecure', 'Skip TLS certificate verification (client only)')
    .option('--p2p-rate-limit <n>', 'Max auth attempts per IP per minute (default: 5)', '5')
    .option('--p2p-allow <ips>', 'Comma-separated list of allowed IPs (empty = all)')
    .option('--p2p-deny <ips>', 'Comma-separated list of denied IPs')
    .option('--p2p-audit-log <dir>', 'Directory for P2P audit logs')
    .option('--p2p-hmac-key <key>', 'HMAC key for message signing (default: derived from password)')
    .option('--port <port>', 'Port number for web server mode', '3000');

program.parse(process.argv);

const opts = program.opts();

function isExportMode() {
  return opts.json || opts.csv || opts.tsv || opts.html || opts.md;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function sanitizeHost(host: string): string {
  return host.trim().replace(/%$/, '');
}

function detectLocalIP(): string | null {
  const ifaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

async function runServerCommand(): Promise<void> {
  const ip = detectLocalIP();

  if (!ip) {
    console.log(chalk.red('Could not detect a non-loopback IP address. Connect to a network first.'));
    process.exit(1);
  }

  const port = 9876;
  const password = 'mysecret';

  console.log(chalk.bold(`\n  pyre server`));
  console.log(chalk.dim(`  Detected IP: ${ip}`));
  console.log(chalk.dim(`  Port: ${port}`));
  console.log(chalk.dim(`  Password: ${password}`));
  console.log();

  console.log(chalk.bold('Run this on THIS machine (server):'));
  console.log(chalk.hex('#ff6a39')(`pyre p2p server --p2p-host 0.0.0.0 --p2p-port ${port} --p2p-password ${password}`));
  console.log();

  console.log(chalk.bold('Run this on the OTHER machine (client):'));
  console.log(chalk.hex('#ff6a39')(`pyre p2p connect --p2p-host ${ip} --p2p-port ${port} --p2p-password ${password}`));
  console.log();
}

async function main() {
  const cmd = program.args[0];

  if (cmd === 'info') {
    await runInfoCommand();
    return;
  }

  if (cmd === 'ssh') {
    const host = program.args[1];
    if (!host) {
      console.log(chalk.red('Usage: pyre ssh <host>'));
      process.exit(1);
    }
    await runSshCommand(host);
    return;
  }

  if (cmd === 'web') {
    await runWebCommand();
    return;
  }

  if (cmd === 'bench') {
    const benchCmd = program.args.slice(1).join(' ');
    if (!benchCmd) {
      console.log(chalk.red('Usage: pyre bench <command>'));
      process.exit(1);
    }
    await runBenchCommand(benchCmd);
    return;
  }

  if (cmd === 'config') {
    const sub = program.args[1];
    if (sub === 'show') {
      const cfg = readConfig();
      console.log(JSON.stringify(cfg, null, 2));
    } else if (sub === 'reset') {
      fs.rmSync(CONFIG_FILE, { force: true });
      console.log(chalk.green('Config reset to defaults'));
    } else {
      console.log('Usage: pyre config <show|reset>');
    }
    return;
  }

  if (cmd === 'server') {
    await runServerCommand();
    return;
  }

  const alertCpu = opts.alertCpu ? parseInt(opts.alertCpu, 10) : undefined;
  const alertTemp = opts.alertTemp ? parseInt(opts.alertTemp, 10) : undefined;
  const tempUnit = opts.tempUnit === 'f' ? 'f' : 'c';

  if (cmd === 'live' || (!isExportMode() && !opts.once && cmd !== 'p2p')) {
    if (!process.stdout.isTTY && cmd !== 'live') {
      await runWebCommand();
      return;
    }
    if (cmd === 'live') {
      program.args.shift();
    }
    const splashPromise = showSplash({
      enabled: config.splashEnabled,
      colorScheme: config.splashColorScheme as any,
      animation: config.splashAnimation as any,
    });
    const interval = parseFloat(opts.interval) || 2;
    await startLive({
      interval,
      detailed: opts.detailed ?? config.detailed,
      theme: opts.theme || config.theme,
      exportDir: opts.exportDir || config.exportDir,
      autoLog: opts.log || config.autoLog,
      alertCpu,
      alertTemp,
      tempUnit,
    }, splashPromise);
    return;
  }

  if (cmd === 'p2p') {
    const subcommand = program.args[1];
    if (subcommand === 'server') {
      await runP2PServer();
      return;
    } else if (subcommand === 'connect') {
      await runP2PConnect();
      return;
    } else {
      console.log(chalk.red('Usage: pyre p2p <server|connect> [options]'));
      process.exit(1);
    }
  }

  // `0` means "no cap" — collectProcesses treats an undefined limit as
  // unlimited by grabbing every row `ps` returns instead of head-limiting it.
  const requestedLimit = parseInt(opts.limit, 10);
  const processLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;

  const data = await collectAll({ detailed: opts.detailed, processLimit });

  let output: string;
  if (opts.json) output = formatJson(data);
  else if (opts.html) output = formatHtml(data);
  else if (opts.md) output = formatMarkdown(data);
  else if (opts.csv) output = formatCsv(data);
  else if (opts.tsv) output = formatTsv(data);
  else output = formatTable(data, { width: process.stdout.columns || 80, sortBy: opts.sort, treeView: opts.tree ?? config.treeView, visible: { packets: opts.packets ? true : undefined } });

  console.log(output);

  if (opts.out) {
    fs.writeFileSync(opts.out, stripAnsi(output));
    console.log(chalk.dim(`\nSaved to ${opts.out}`));
  }
}

main().catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

async function runP2PServer(): Promise<void> {
  const host = opts.p2pHost || '0.0.0.0';
  const port = parseInt(opts.p2pPort, 10) || 9876;
  const password = opts.p2pPassword || '';
  const interval = parseFloat(opts.interval) || 2;
  const detailed = !!opts.detailed;
  const tlsCert = opts.p2pCert;
  const tlsKey = opts.p2pKey;
  const tlsCA = opts.p2pCA;
  const rateLimit = parseInt(opts.p2pRateLimit, 10) || 5;
  const allowList = opts.p2pAllow ? opts.p2pAllow.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
  const denyList = opts.p2pDeny ? opts.p2pDeny.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

  if (!password) {
    console.log(chalk.red('Error: a password is required for P2P server mode. Use --p2p-password <password>'));
    process.exit(1);
  }

  if (tlsCert && !tlsKey) {
    console.log(chalk.red('Error: --p2p-key is required when --p2p-cert is specified'));
    process.exit(1);
  }
  if (tlsKey && !tlsCert) {
    console.log(chalk.red('Error: --p2p-cert is required when --p2p-key is specified'));
    process.exit(1);
  }

  const server = new P2PServer({
    host,
    port,
    password,
    intervalMs: interval * 1000,
    detailed,
    tlsCert,
    tlsKey,
    tlsCA,
    rateLimitMaxAttempts: rateLimit,
    rateLimitWindowMs: 60000,
    allowedIPs: allowList,
    deniedIPs: denyList,
    auditLog: opts.p2pAuditLog,
    hmacKey: opts.p2pHmacKey,
  });

  const tlsEnabled = !!(tlsCert && tlsKey);

  console.log(chalk.bold(`\n  pyre P2P Server`));
  console.log(chalk.dim(`  Host: ${host}`));
  console.log(chalk.dim(`  Port: ${port}`));
  console.log(chalk.dim(`  Protocol: ${tlsEnabled ? 'TLS' : 'TCP'}`));
  console.log(chalk.dim(`  Password: ${password}`));
  console.log(chalk.dim(`  Interval: ${interval}s`));
  console.log(chalk.dim(`  Detailed: ${detailed ? 'on' : 'off'}`));
  console.log(chalk.dim(`  Rate limit: ${rateLimit} attempts/min`));
  if (allowList.length > 0) console.log(chalk.dim(`  Allowed IPs: ${allowList.join(', ')}`));
  if (denyList.length > 0) console.log(chalk.dim(`  Denied IPs: ${denyList.join(', ')}`));
  console.log(chalk.dim(`  Waiting for peers...\n`));

  await server.start();

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
      server.stop();
      rl.close();
      process.exit(0);
    } else if (trimmed === 'status') {
      const info = server.info;
      console.log(chalk.dim(`  Peers connected: ${info.peersConnected}`));
    }
  });

  process.once('SIGINT', () => {
    server.stop();
    rl.close();
    process.exit(0);
  });
}

let _prevFrameLines: string[] = [];

function writeFrame(lines: string[]) {
  if (_prevFrameLines.length === 0 || lines.length !== _prevFrameLines.length) {
    process.stdout.write('\x1b[?25l\x1b[H' + lines.map(l => `\x1b[2K${l}`).join('\r\n') + '\x1b[0J');
    _prevFrameLines = lines;
    return;
  }

  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== _prevFrameLines[i]) {
      out += `\x1b[${i + 1};1H\x1b[2K${lines[i]}`;
    }
  }
  if (out) process.stdout.write(out);
  _prevFrameLines = lines;
}

async function runP2PConnect(): Promise<void> {
  const host = sanitizeHost(opts.p2pHost || '127.0.0.1');
  const port = parseInt(opts.p2pPort, 10) || 9876;
  const password = opts.p2pPassword || '';
  const useTLS = !!opts.p2pTls;
  const tlsCA = opts.p2pCA;
  const tlsInsecure = !!opts.p2pInsecure;

  if (!password) {
    console.log(chalk.red('Error: a password is required for P2P connect mode. Use --p2p-password <password>'));
    process.exit(1);
  }

  const client = new P2PClient({
    host,
    port,
    password,
    tls: useTLS,
    tlsCA,
    tlsInsecure,
    auditLog: opts.p2pAuditLog,
    hmacKey: opts.p2pHmacKey,
  });

  client.setOnStatus((msg) => {
    process.stdout.write(`\r${chalk.dim(msg)}${' '.repeat(40)}\r`);
  });

  client.setOnData((data) => {
    const lines: string[] = [];
    lines.push(chalk.bold(`  pyre P2P Client — ${data.header.hostname}`));
    lines.push(chalk.dim(`  ${data.timestamp}`));
    lines.push('');
    lines.push(...formatTable(data, {
      width: process.stdout.columns || 80,
      sortBy: 'cpu',
      treeView: false,
      visible: { packets: true },
    }).split('\n'));

    while (lines.length < process.stdout.rows) {
      lines.push('');
    }
    if (lines.length > process.stdout.rows) {
      lines.length = process.stdout.rows;
    }

    writeFrame(lines);
  });

  const protocolLabel = useTLS ? 'TLS' : 'TCP';
  console.log(chalk.bold(`\n  pyre P2P Client`));
  console.log(chalk.dim(`  Protocol: ${protocolLabel}`));
  console.log(chalk.dim(`  Connecting to ${host}:${port}...`));
  console.log(chalk.dim(`  Press Ctrl+C to disconnect\n`));

  process.stdout.write('\x1b[?25l');

  try {
    await client.connect();
  } catch (err: any) {
    const code = (err as any).code;
    const msg = err.message || String(err);
    console.log(chalk.red(`Connection failed: ${msg}`));
    if (code === 'ECONNREFUSED') {
      console.log(chalk.yellow('  Hints:'));
      console.log(chalk.dim('  1. Start the server: pyre p2p server --p2p-host 0.0.0.0 --p2p-port ' + port + ' --p2p-password <password>'));
      console.log(chalk.dim('  2. Check the server IP with: hostname -I'));
      console.log(chalk.dim('  3. Open the port on the server firewall: sudo ufw allow ' + port + '/tcp'));
    } else if (code === 'ETIMEDOUT') {
      console.log(chalk.yellow('  Hints:'));
      console.log(chalk.dim('  1. Verify the server IP is correct'));
      console.log(chalk.dim('  2. Check that both machines are on the same network/subnet'));
      console.log(chalk.dim('  3. Open the port on the server firewall'));
    } else if (code === 'EHOSTDOWN' || code === 'EHOSTUNREACH') {
      console.log(chalk.yellow('  Hints:'));
      console.log(chalk.dim('  1. The server at ' + host + ' is not responding'));
      console.log(chalk.dim('  2. Start the server first: pyre p2p server --p2p-host 0.0.0.0 --p2p-port ' + port + ' --p2p-password <password>'));
      console.log(chalk.dim('  3. Check connectivity: ping ' + host));
      console.log(chalk.dim('  4. Ensure both machines are on the same LAN (ping each other first)'));
    }
    process.stdout.write('\x1b[?25h');
    process.exit(1);
  }

  process.once('SIGINT', () => {
    _prevFrameLines = [];
    client.disconnect();
    process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
    process.exit(0);
  });
}

async function runInfoCommand(): Promise<void> {
  const data = await collectAll({ detailed: true });
  const lines: string[] = [];
  lines.push(chalk.bold('  pyre info'));
  lines.push('');
  lines.push(`  Hostname:  ${data.header.hostname}`);
  lines.push(`  OS:        ${data.header.os}`);
  lines.push(`  Uptime:    ${data.header.uptime}`);
  lines.push(`  CPU:       ${data.cpu.brand}`);
  lines.push(`  Cores:     ${data.cpu.physicalCores}/${data.cpu.cores} (phys/log)`);
  lines.push(`  Frequency: ${data.cpu.frequency} MHz`);
  lines.push(`  Memory:    ${formatBytes(data.memory.total)}`);
  if (data.gpu) lines.push(`  GPU:       ${data.gpu.model} (${formatBytes(data.gpu.memory)})`);
  if (data.battery) {
    lines.push(`  Battery:   ${data.battery.level}% (${data.battery.state})`);
    lines.push(`  Health:    ${data.battery.health}`);
  }
  lines.push(`  Thermal:   ${data.thermal.state}`);
  console.log(lines.join('\n'));
}

async function runSshCommand(host: string): Promise<void> {
  const password = opts.p2pPassword || 'mysecret';
  const cmd = `ssh -o LogLevel=QUIET ${host} "pyre --json --once"`;
  console.log(chalk.bold(`\n  pyre ssh — ${host}`));
  console.log(chalk.dim(`  Running: ${cmd}\n`));

  const { execFile } = await import('node:child_process');
  const child = execFile('ssh', ['-o', 'LogLevel=QUIET', host, 'pyre', '--json', '--once'], (err, stdout, stderr) => {
    if (err) {
      console.log(chalk.red(`  SSH failed: ${err.message}`));
      console.log(chalk.dim('  Ensure SSH keys are set up or the host is reachable.'));
      process.exit(1);
    }
    if (stderr) console.log(chalk.dim(stderr));
    try {
      const remote = JSON.parse(stdout);
      console.log(formatTable(remote, { width: process.stdout.columns || 80, sortBy: 'cpu', treeView: false, visible: { packets: true } }));
    } catch {
      console.log(stdout);
    }
    process.exit(0);
  });
  child.stdin?.end();

  process.once('SIGINT', () => {
    child.kill('SIGTERM');
    process.exit(0);
  });
}

async function runWebCommand(): Promise<void> {
  const http = await import('node:http');
  const port = parseInt(opts.port || process.env.PORT || '3000', 10) || 3000;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const indexPath = path.join(process.cwd(), 'index.html');
      let htmlContent = '';
      if (fs.existsSync(indexPath)) {
        htmlContent = fs.readFileSync(indexPath, 'utf-8');
      } else {
        const data = await collectAll({ detailed: true });
        htmlContent = formatHtml(data);
      }
      res.end(htmlContent);
    } else if (url === '/api' || url === '/api/stats' || url === '/data') {
      const data = await collectAll({ detailed: true });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      });
      res.end(JSON.stringify(data, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(chalk.bold(`\n  pyre web server running on port ${port}`));
    console.log(chalk.dim(`  Dashboard: http://0.0.0.0:${port}/`));
    console.log(chalk.dim(`  API:       http://0.0.0.0:${port}/api`));
    console.log(chalk.dim('  Press Ctrl+C to stop\n'));
  });

  process.once('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

async function runBenchCommand(benchCmd: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const logDir = opts.exportDir || './pyre-exports';
  const file = path.join(logDir, `pyre-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);

  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.write('timestamp,cpu_usage,mem_usage_percent,temp_c,net_rx_bytes,net_tx_bytes,net_rx_packets,net_tx_packets,connections,thermal_state\n');

  console.log(chalk.bold(`\n  pyre bench`));
  console.log(chalk.dim(`  Command: ${benchCmd}`));
  console.log(chalk.dim(`  Log: ${file}\n`));

  const child = spawn('sh', ['-c', benchCmd]);
  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => process.stdout.write(d));

  const interval = parseFloat(opts.interval) || 2;
  const handle = setInterval(async () => {
    try {
      const data = await collectAll({ detailed: opts.detailed });
      const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? '';
      const rxPackets = data.network.rxPackets ?? 0;
      const txPackets = data.network.txPackets ?? 0;
      const connections = data.network.connections ?? 0;
      stream.write(`${data.timestamp},${data.cpu.usage},${data.memory.usagePercent},${temp},${data.network.rxBytes},${data.network.txBytes},${rxPackets},${txPackets},${connections},${data.thermal.state}\n`);
    } catch {
      // skip bad tick
    }
  }, interval * 1000);

  child.on('close', () => {
    clearInterval(handle);
    stream.end();
    console.log(chalk.green(`\n  Bench complete. Log saved to ${file}`));
    process.exit(0);
  });

  process.once('SIGINT', () => {
    clearInterval(handle);
    child.kill('SIGTERM');
    stream.end();
    process.exit(0);
  });
}
#!/usr/bin/env node
/**
 * pyre - Mac system monitoring CLI
 * Monitors temps, cpu, memory, disk, battery, and system stats.
 * Live mode is a full interactive dashboard: graphs, pause/resume,
 * on-demand snapshot export, and continuous CSV logging.
 * P2P mode enables live data streaming between two systems over TCP.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { collectAll } from './monitors/index.js';
import { formatTable, formatJson, formatCsv, formatTsv } from './formatters/index.js';
import { startLive, stopLive } from './live/index.js';
import { showSplash } from './splash.js';
import { P2PServer, P2PClient } from './p2p/index.js';

const program = new Command();

program
    .name('pyre')
    .version('2.0.0')
    .description('Mac system monitoring CLI: interactive live dashboard, stats, graphs, export, packet monitor, battery predictor')
    .option('-j, --json', 'Output as JSON')
    .option('-c, --csv', 'Output as CSV')
    .option('-t, --tsv', 'Output as TSV')
    .option('--detailed', 'Include detailed system info and sensor readings')
    .option('--interval <seconds>', 'Refresh interval for live mode', '2')
    .option('--once', 'Show a single static snapshot instead of live feed')
    .option('--out <file>', 'Also write the snapshot output to a file (--once/--json/--csv/--tsv modes)')
    .option('--export-dir <dir>', 'Directory used for live-mode snapshot exports and logs', './pyre-exports')
    .option('--log', 'Start continuous CSV logging immediately when live mode starts')
    .option('--tree', 'Show process tree view instead of flat list')
    .option('--sort <key>', 'Sort processes by: cpu, mem, pid, user, command, state, threads, runtime', 'cpu')
    .option('--packets', 'Include packet monitor panel in output')
    .option('--limit <n>', 'Max number of processes to include in --once/--json/--csv/--tsv snapshots (0 = all)', '10')
    .option('--p2p-host <host>', 'P2P host address (server: bind address, client: server address)', '0.0.0.0')
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
    .option('--p2p-hmac-key <key>', 'HMAC key for message signing (default: derived from password)');

program.parse(process.argv);

const opts = program.opts();

function isExportMode() {
  return opts.json || opts.csv || opts.tsv;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

async function main() {
  const cmd = program.args[0];

  if (cmd === 'live' || (!isExportMode() && !opts.once && cmd !== 'p2p')) {
    if (cmd === 'live') {
      program.args.shift();
    }
    await showSplash();
    const interval = parseFloat(opts.interval) || 2;
    await startLive({
      interval,
      detailed: opts.detailed,
      exportDir: opts.exportDir,
      autoLog: opts.log,
    });
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
  else if (opts.csv) output = formatCsv(data);
  else if (opts.tsv) output = formatTsv(data);
  else output = formatTable(data, { width: process.stdout.columns || 80, sortBy: opts.sort, treeView: opts.tree, visible: { packets: opts.packets ? true : undefined } });

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

async function runP2PConnect(): Promise<void> {
  const host = opts.p2pHost || '127.0.0.1';
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
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(chalk.bold(`  pyre P2P Client — ${data.header.hostname}`));
    console.log(chalk.dim(`  ${data.timestamp}`));
    console.log();
    console.log(formatTable(data, {
      width: process.stdout.columns || 80,
      sortBy: 'cpu',
      treeView: false,
      visible: { packets: true },
    }));
  });

  const protocolLabel = useTLS ? 'TLS' : 'TCP';
  console.log(chalk.bold(`\n  pyre P2P Client`));
  console.log(chalk.dim(`  Protocol: ${protocolLabel}`));
  console.log(chalk.dim(`  Connecting to ${host}:${port}...`));
  console.log(chalk.dim(`  Press Ctrl+C to disconnect\n`));

  try {
    await client.connect();
  } catch (err: any) {
    console.log(chalk.red(`Connection failed: ${err.message}`));
    process.exit(1);
  }

  process.once('SIGINT', () => {
    client.disconnect();
    process.exit(0);
  });
}
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import chalk from 'chalk';
import { collectAll, StatsData } from './monitors.js';
import { formatTable, formatJson, formatCsv, formatTsv, formatGraphs } from './formatters.js';
import { History } from './history.js';

type ExportFormat = 'json' | 'csv' | 'tsv';

export interface LiveOptions {
  interval: number;
  detailed?: boolean;
  exportDir?: string;
  autoLog?: boolean;
}

// --- live session state ---
let intervalHandle: NodeJS.Timeout | null = null;
let running = false;
let paused = false;
let detailed = false;
let interval = 2;
let showGraphs = true;
let exportFormat: ExportFormat = 'json';
let exportDir = './pyre-exports';

let logging = false;
let logStream: fs.WriteStream | null = null;

let statusMessage = '';
let statusTimer: NodeJS.Timeout | null = null;

let lastData: StatsData | null = null;
const history = new History(40);

let keypressHandler: ((str: string, key: readline.Key) => void) | null = null;

function setStatus(msg: string, ms = 3000) {
  statusMessage = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMessage = '';
    render();
  }, ms);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function exportSnapshot() {
  if (!lastData) {
    setStatus('No data yet — try again in a moment');
    return;
  }
  try {
    ensureDir(exportDir);
    const file = path.join(exportDir, `pyre-${timestampForFile()}.${exportFormat}`);
    const content =
      exportFormat === 'json' ? formatJson(lastData) : exportFormat === 'csv' ? formatCsv(lastData) : formatTsv(lastData);
    fs.writeFileSync(file, content);
    setStatus(`Exported snapshot -> ${file}`);
  } catch (err: any) {
    setStatus(`Export failed: ${err.message}`);
  }
}

function startLogging() {
  try {
    ensureDir(exportDir);
    const file = path.join(exportDir, `pyre-log-${timestampForFile()}.csv`);
    logStream = fs.createWriteStream(file, { flags: 'a' });
    logStream.write('timestamp,cpu_usage,mem_usage_percent,temp_c,net_rx_bytes,net_tx_bytes,thermal_state\n');
    logging = true;
    setStatus(`Logging every tick -> ${file}`);
  } catch (err: any) {
    setStatus(`Logging failed to start: ${err.message}`);
  }
}

function stopLogging() {
  logging = false;
  logStream?.end();
  logStream = null;
  setStatus('Logging stopped');
}

function toggleLogging() {
  if (logging) stopLogging();
  else startLogging();
}

function writeLogRow(data: StatsData) {
  if (!logging || !logStream) return;
  const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? '';
  logStream.write(
    `${data.timestamp},${data.cpu.usage},${data.memory.usagePercent},${temp},${data.network.rxBytes},${data.network.txBytes},${data.thermal.state}\n`
  );
}

function helpBar(): string {
  const keys: [string, string][] = [
    ['q', 'quit'],
    ['p', paused ? 'resume' : 'pause'],
    ['g', showGraphs ? 'hide graphs' : 'show graphs'],
    ['d', detailed ? 'basic mode' : 'detailed mode'],
    ['e', 'export snapshot'],
    ['l', logging ? 'stop logging' : 'start logging'],
    ['f', `cycle format (${exportFormat})`],
    ['+/-', `interval (${interval}s)`],
  ];
  return keys.map(([k, label]) => `${chalk.bgWhite.black(` ${k} `)} ${chalk.dim(label)}`).join('  ');
}

function render() {
  if (!lastData) return;
  const lines: string[] = [];
  lines.push(formatTable(lastData));

  if (showGraphs) {
    lines.push('');
    lines.push(formatGraphs(history));
  }

  lines.push('');
  lines.push(helpBar());

  const badges: string[] = [];
  if (paused) badges.push(chalk.yellow('⏸  PAUSED'));
  if (logging) badges.push(chalk.magenta('● REC'));
  if (badges.length) lines.push(badges.join('   '));

  if (statusMessage) lines.push(chalk.cyan(statusMessage));

  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(lines.join('\n'));
}

async function tick() {
  if (paused) return;
  try {
    const data = await collectAll({ detailed });
    lastData = data;

    const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? null;
    history.push({
      cpuUsage: data.cpu.usage,
      memUsage: data.memory.usagePercent,
      temp,
      rxBytes: data.network.rxBytes,
      txBytes: data.network.txBytes,
    });

    writeLogRow(data);
    render();
  } catch {
    // skip a bad tick, keep the dashboard alive
  }
}

function restartTicker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(tick, interval * 1000);
}

export async function startLive(opts: LiveOptions) {
  if (running) return;
  running = true;
  paused = false;
  detailed = !!opts.detailed;
  interval = opts.interval;
  if (opts.exportDir) exportDir = opts.exportDir;
  history.reset();

  process.stdout.write('\x1b[?1049h'); // alternate screen buffer
  process.stdout.write('\x1b[?25l'); // hide cursor
  process.stdout.write('\x1b[2J\x1b[H');
  process.title = 'pyre';

  await tick();
  restartTicker();

  if (opts.autoLog) startLogging();

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  keypressHandler = (_str: string, key: readline.Key) => {
    if (!key) return;

    if (key.ctrl && key.name === 'c') {
      stopLive();
      return;
    }

    switch (key.sequence) {
      case '+':
        interval += 1;
        restartTicker();
        setStatus(`Interval set to ${interval}s`);
        return;
      case '-':
        interval = Math.max(1, interval - 1);
        restartTicker();
        setStatus(`Interval set to ${interval}s`);
        return;
    }

    switch (key.name) {
      case 'q':
        stopLive();
        break;
      case 'p':
        paused = !paused;
        setStatus(paused ? 'Paused' : 'Resumed');
        render();
        break;
      case 'g':
        showGraphs = !showGraphs;
        render();
        break;
      case 'd':
        detailed = !detailed;
        setStatus(`Detailed sensor mode: ${detailed ? 'on' : 'off'}`);
        break;
      case 'e':
        exportSnapshot();
        render();
        break;
      case 'l':
        toggleLogging();
        render();
        break;
      case 'f':
        exportFormat = exportFormat === 'json' ? 'csv' : exportFormat === 'csv' ? 'tsv' : 'json';
        setStatus(`Export format: ${exportFormat}`);
        render();
        break;
    }
  };

  process.stdin.on('keypress', keypressHandler);
  process.once('SIGINT', () => stopLive());
}

export function stopLive() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  if (keypressHandler) {
    process.stdin.removeListener('keypress', keypressHandler);
    keypressHandler = null;
  }

  running = false;
  logging = false;

  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();

  process.stdout.write('\x1b[?25h'); // show cursor
  process.stdout.write('\x1b[?1049l'); // leave alternate screen buffer
  process.stdout.write('\x1b[2J\x1b[H');

  process.exit(0);
}
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import chalk from 'chalk';
import { collectAll, StatsData } from './monitors.js';
import {
  formatTable,
  formatJson,
  formatCsv,
  formatTsv,
  formatGraphs,
  gridColumns,
  ThemeName,
  VisibleItems,
  THEMES,
} from './formatters.js';
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

let currentTheme: ThemeName = 'default';
let visiblePanels: VisibleItems = {
  cpu: true,
  mem: true,
  power: true,
  battery: true,
  thermal: true,
  network: true,
  disk: true,
  process: true,
};

let logging = false;
let logStream: fs.WriteStream | null = null;

let statusMessage = '';
let statusTimer: NodeJS.Timeout | null = null;

let lastData: StatsData | null = null;
const history = new History(40);

let keypressHandler: ((str: string, key: readline.Key) => void) | null = null;

// --- responsive layout ---
let termWidth = process.stdout.columns || 80;
let termHeight = process.stdout.rows || 24;

// --- process list: sort / filter / kill ---
type SortMode = 'cpu' | 'mem' | 'pid';
let sortMode: SortMode = 'cpu';
let processFilter = '';

// text-entry and customization modes
type InputMode = null | 'filter' | 'kill' | 'customizer';
let inputMode: InputMode = null;
let inputBuffer = '';
let customizerIndex = 0;

const CUSTOMIZER_OPTIONS = [
  'Theme',
  'Toggle CPU',
  'Toggle Memory',
  'Toggle Power',
  'Toggle Battery',
  'Toggle Thermal',
  'Toggle Network',
  'Toggle Disk',
  'Toggle Processes',
];

// --- alert thresholds ---
const CPU_ALERT_PCT = 90;
const TEMP_ALERT_C = 95;
let alerted = false;

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

/** How many process rows we can realistically fit given current terminal height. */
function processRowBudget(): number {
  const columns = gridColumns(termWidth);
  const cardRows = Math.ceil(6 / columns);
  const reserved = 2 + cardRows * 8 + 11 + (showGraphs ? 9 : 0) + 4;
  return Math.max(3, Math.min(40, termHeight - reserved));
}

function renderCustomizerOverlay(): string {
  const themesList = Object.keys(THEMES) as ThemeName[];
  const lines = [
    chalk.bgCyan.black.bold(' UI CUSTOMIZER (Use ↑/↓ or J/K to navigate, Enter/Space to toggle, Esc to exit) '),
  ];

  CUSTOMIZER_OPTIONS.forEach((opt, idx) => {
    const isSelected = idx === customizerIndex;
    const prefix = isSelected ? chalk.yellow('▶ ') : '  ';

    if (opt === 'Theme') {
      lines.push(`${prefix}${opt}: ${chalk.bold.green(currentTheme)} [${themesList.join(', ')}]`);
    } else {
      const key = opt.replace('Toggle ', '').toLowerCase() as keyof VisibleItems;
      const isVisible = visiblePanels[key] !== false;
      const status = isVisible ? chalk.green('[VISIBLE]') : chalk.red('[HIDDEN]');
      lines.push(`${prefix}${opt}: ${status}`);
    }
  });

  return lines.map(l => `  ${l}`).join('\n');
}

function render() {
  if (!lastData) return;
  const lines: string[] = [];
  lines.push(
    formatTable(lastData, {
      width: termWidth,
      sortBy: sortMode,
      filter: processFilter || undefined,
      processLimit: processRowBudget(),
      theme: currentTheme,
      visible: visiblePanels,
    })
  );

  if (showGraphs) {
    lines.push('');
    lines.push(formatGraphs(history, termWidth, currentTheme));
  }

  lines.push('');
  lines.push(footerLine());

  if (inputMode === 'customizer') {
    lines.push(renderCustomizerOverlay());
  } else if (inputMode === 'filter') {
    lines.push(chalk.cyan(`  Filter processes: ${inputBuffer}_`));
  } else if (inputMode === 'kill') {
    lines.push(chalk.cyan(`  Kill PID: ${inputBuffer}_  (enter to confirm, esc to cancel)`));
  } else if (statusMessage) {
    lines.push(`  ${statusMessage}`);
  }

  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(lines.join('\n'));
}

function footerLine(): string {
  const keys: [string, string][] = [
    ['q', 'quit'],
    ['c', 'customize UI'],
    ['p', paused ? 'resume' : 'pause'],
    ['g', showGraphs ? 'hide graphs' : 'show graphs'],
    ['d', detailed ? 'basic' : 'detailed'],
    ['s', `sort:${sortMode}`],
    ['/', 'filter'],
    ['k', 'kill'],
    ['e', 'export'],
    ['l', logging ? 'stop log' : 'log'],
    ['f', exportFormat],
    ['+/-', `${interval}s`],
  ];
  const keyStr = keys.map(([k, label]) => `${chalk.cyan.bold(k)} ${chalk.dim(label)}`).join(chalk.dim('  ·  '));

  const badges: string[] = [];
  if (paused) badges.push(chalk.yellow.bold('⏸ PAUSED'));
  if (logging) badges.push(chalk.red.bold('● REC'));
  const badgeStr = badges.join('  ');

  return badgeStr ? `${keyStr}    ${badgeStr}` : keyStr;
}

function checkAlerts(data: StatsData) {
  const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? null;
  const hot = data.cpu.usage >= CPU_ALERT_PCT || (temp !== null && temp >= TEMP_ALERT_C);
  if (hot && !alerted) {
    alerted = true;
    process.stdout.write('\x07');
    const reason = data.cpu.usage >= CPU_ALERT_PCT ? `CPU at ${data.cpu.usage}%` : `Temp at ${temp}°C`;
    setStatus(chalk.red(`⚠ Alert: ${reason}`), 5000);
  } else if (!hot) {
    alerted = false;
  }
}

async function tick() {
  if (paused) return;
  try {
    const data = await collectAll({ detailed, processLimit: processRowBudget() });
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
    checkAlerts(data);
    render();
  } catch {
    // skip bad tick
  }
}

function killProcess(pidStr: string) {
  const pid = parseInt(pidStr, 10);
  if (!pid || pid <= 0) {
    setStatus(`Invalid PID: ${pidStr}`);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    setStatus(`Sent SIGTERM to PID ${pid}`);
  } catch (err: any) {
    setStatus(`Failed to kill ${pid}: ${err.message}`);
  }
}

function handleInputModeKey(str: string, key: readline.Key) {
  if (key.name === 'escape') {
    inputMode = null;
    inputBuffer = '';
    render();
    return;
  }

  if (inputMode === 'customizer') {
    const themesList = Object.keys(THEMES) as ThemeName[];

    if (key.name === 'up' || str === 'k') {
      customizerIndex = (customizerIndex - 1 + CUSTOMIZER_OPTIONS.length) % CUSTOMIZER_OPTIONS.length;
    } else if (key.name === 'down' || str === 'j') {
      customizerIndex = (customizerIndex + 1) % CUSTOMIZER_OPTIONS.length;
    } else if (key.name === 'return' || str === ' ') {
      const selected = CUSTOMIZER_OPTIONS[customizerIndex];
      if (selected === 'Theme') {
        const nextIdx = (themesList.indexOf(currentTheme) + 1) % themesList.length;
        currentTheme = themesList[nextIdx];
      } else {
        const itemKey = selected.replace('Toggle ', '').toLowerCase() as keyof VisibleItems;
        visiblePanels[itemKey] = !visiblePanels[itemKey];
      }
    }
    render();
    return;
  }

  if (key.name === 'return') {
    if (inputMode === 'filter') {
      processFilter = inputBuffer.trim();
      setStatus(processFilter ? `Filtering: "${processFilter}"` : 'Filter cleared');
    } else if (inputMode === 'kill') {
      killProcess(inputBuffer.trim());
    }
    inputMode = null;
    inputBuffer = '';
    render();
    return;
  }

  if (key.name === 'backspace') {
    inputBuffer = inputBuffer.slice(0, -1);
    render();
    return;
  }

  if (str && str.length === 1 && !key.ctrl && !key.meta) {
    inputBuffer += str;
    render();
  }
}

function onResize() {
  termWidth = process.stdout.columns || 80;
  termHeight = process.stdout.rows || 24;
  history.setMaxLen(Math.max(20, Math.min(200, termWidth - 30)));
  render();
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
  termWidth = process.stdout.columns || 80;
  termHeight = process.stdout.rows || 24;
  history.reset();
  history.setMaxLen(Math.max(20, Math.min(200, termWidth - 30)));

  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[?25l');
  process.stdout.write('\x1b[2J\x1b[H');
  process.title = 'pyre';

  await tick();
  restartTicker();

  if (opts.autoLog) startLogging();

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdout.on('resize', onResize);

  keypressHandler = (str: string, key: readline.Key) => {
    if (!key) return;

    if (key.ctrl && key.name === 'c') {
      stopLive();
      return;
    }

    if (inputMode) {
      handleInputModeKey(str, key);
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
      case '/':
        inputMode = 'filter';
        inputBuffer = processFilter;
        render();
        return;
    }

    switch (key.name) {
      case 'q':
        stopLive();
        break;
      case 'c':
        inputMode = 'customizer';
        customizerIndex = 0;
        render();
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
      case 's':
        sortMode = sortMode === 'cpu' ? 'mem' : sortMode === 'mem' ? 'pid' : 'cpu';
        setStatus(`Sorting by ${sortMode}`);
        render();
        break;
      case 'k':
        inputMode = 'kill';
        inputBuffer = '';
        render();
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
  process.stdout.removeListener('resize', onResize);

  running = false;
  logging = false;

  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();

  process.stdout.write('\x1b[?25h');
  process.stdout.write('\x1b[?1049l');
  process.stdout.write('\x1b[2J\x1b[H');

  process.exit(0);
}
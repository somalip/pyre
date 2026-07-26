import chalk from 'chalk';
import { StatsData } from './monitors.js';
import { sparkline } from './sparkline.js';
import type { History } from './history.js';

// --- theme definitions ----------------------------------------------------

export type ThemeName = 'default' | 'dracula' | 'cyberpunk' | 'monochrome';

export interface ThemeColors {
  border: (s: string) => string;
  cpu: (s: string) => string;
  mem: (s: string) => string;
  power: (s: string) => string;
  battery: (s: string) => string;
  thermal: (s: string) => string;
  network: (s: string) => string;
  disk: (s: string) => string;
  graphs: (s: string) => string;
  process: (s: string) => string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  default: {
    border: chalk.hex('#4b5563'),
    cpu: chalk.hex('#22d3ee'),
    mem: chalk.hex('#a78bfa'),
    power: chalk.hex('#fbbf24'),
    battery: chalk.hex('#34d399'),
    thermal: chalk.hex('#fb923c'),
    network: chalk.hex('#60a5fa'),
    disk: chalk.hex('#f472b6'),
    graphs: chalk.hex('#22d3ee'),
    process: chalk.hex('#e5e7eb'),
  },
  dracula: {
    border: chalk.hex('#6272a4'),
    cpu: chalk.hex('#8be9fd'),
    mem: chalk.hex('#bd93f9'),
    power: chalk.hex('#f1fa8c'),
    battery: chalk.hex('#50fa7b'),
    thermal: chalk.hex('#ffb86c'),
    network: chalk.hex('#ff79c6'),
    disk: chalk.hex('#ff5555'),
    graphs: chalk.hex('#8be9fd'),
    process: chalk.hex('#f8f8f2'),
  },
  cyberpunk: {
    border: chalk.hex('#ff0055'),
    cpu: chalk.hex('#00ffcc'),
    mem: chalk.hex('#ff00ff'),
    power: chalk.hex('#ffff00'),
    battery: chalk.hex('#00ff00'),
    thermal: chalk.hex('#ff6600'),
    network: chalk.hex('#00ffff'),
    disk: chalk.hex('#ff007f'),
    graphs: chalk.hex('#00ffcc'),
    process: chalk.hex('#ffffff'),
  },
  monochrome: {
    border: chalk.gray,
    cpu: chalk.white.bold,
    mem: chalk.white.bold,
    power: chalk.white.bold,
    battery: chalk.white.bold,
    thermal: chalk.white.bold,
    network: chalk.white.bold,
    disk: chalk.white.bold,
    graphs: chalk.white.bold,
    process: chalk.white.bold,
  },
};

export interface VisibleItems {
  cpu?: boolean;
  mem?: boolean;
  power?: boolean;
  battery?: boolean;
  thermal?: boolean;
  network?: boolean;
  disk?: boolean;
  process?: boolean;
}

export interface TableOptions {
  /** Terminal width in columns; controls layout, bar sizing, and column count. Defaults to 80. */
  width?: number;
  /** Process sort key. Defaults to 'cpu'. */
  sortBy?: 'cpu' | 'mem' | 'pid';
  /** Case-insensitive substring filter applied to the process command. */
  filter?: string;
  /** Max process rows to show (the live dashboard sizes this to available terminal height). */
  processLimit?: number;
  /** Selected visual theme. */
  theme?: ThemeName;
  /** Visibility toggle settings for individual cards. */
  visible?: VisibleItems;
}

/** Clamp/normalize a terminal width to a sane range, defaulting to 80 cols. */
export function clampWidth(width?: number): number {
  if (!width || Number.isNaN(width)) return 80;
  return Math.max(60, Math.min(width, 240));
}

/** How many stat cards fit per row at a given terminal width. Shared with live.ts for layout budgeting. */
export function gridColumns(width: number): number {
  if (width >= 150) return 3;
  if (width >= 96) return 2;
  return 1;
}

// --- low-level box drawing ---------------------------------------------------

function visLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padVisible(s: string, width: number): string {
  const len = visLen(s);
  if (len >= width) return s;
  return s + ' '.repeat(width - len);
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

/** Draw a rounded panel of exactly `width` columns wide and `height` content rows tall. */
function panel(
  title: string,
  lines: string[],
  width: number,
  accent: (s: string) => string,
  borderAccent: (s: string) => string,
  height?: number
): string[] {
  const h = height ?? lines.length;
  const contentWidth = Math.max(1, width - 4);
  const label = ` ${title} `;
  const dashLen = Math.max(0, width - 3 - label.length);
  const top = borderAccent('╭─' + label + '─'.repeat(dashLen) + '╮');
  const bottom = borderAccent('╰' + '─'.repeat(width - 2) + '╯');
  const body: string[] = [];
  for (let i = 0; i < h; i++) {
    const line = lines[i] ?? '';
    body.push(`${borderAccent('│')} ${padVisible(line, contentWidth)} ${borderAccent('│')}`);
  }
  return [top, ...body, bottom];
}

/** Join equal-or-uneven-height panel blocks side by side with a gap. */
function hstack(blocks: string[][], gap = 2): string[] {
  if (!blocks.length) return [];
  const height = Math.max(...blocks.map(b => b.length));
  const widths = blocks.map(b => visLen(b[0] ?? ''));
  const padded = blocks.map((b, i) => {
    const filler = ' '.repeat(widths[i]);
    const arr = [...b];
    while (arr.length < height) arr.push(filler);
    return arr;
  });
  const out: string[] = [];
  for (let row = 0; row < height; row++) {
    out.push(padded.map(a => a[row]).join(' '.repeat(gap)));
  }
  return out;
}

function statRow(label: string, value: string, width = 9): string {
  const w = Math.max(width, label.length + 1);
  return `${chalk.dim(label.padEnd(w))}${value}`;
}

function bar(percent: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  const empty = width - filled;
  const barStr = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
  const color = percent > 90 ? chalk.red : percent > 70 ? chalk.yellow : chalk.green;
  return color(barStr);
}

function gaugeRow(label: string, percent: number, contentWidth: number): string {
  const labelW = 9;
  const pctText = `${Math.round(percent)}%`;
  const barW = Math.max(6, contentWidth - labelW - pctText.length - 1);
  return `${chalk.dim(label.padEnd(labelW))}${bar(percent, barW)} ${pctText}`;
}

export function thermalColor(pressureLevel: number) {
  if (pressureLevel >= 3) return chalk.red;
  if (pressureLevel === 2) return chalk.yellow;
  if (pressureLevel === 1) return chalk.yellowBright;
  return chalk.green;
}

export function capacityColor(percent: number) {
  if (percent < 80) return chalk.red;
  if (percent < 90) return chalk.yellow;
  return chalk.green;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// --- cards -------------------------------------------------------------------

function cpuCard(data: StatsData, contentWidth: number): string[] {
  const lines = [
    statRow('Brand', truncatePlain(data.cpu.brand, Math.max(4, contentWidth - 8))),
    statRow('Cores', `${data.cpu.physicalCores}/${data.cpu.cores} phys/log`),
    statRow('Freq', `${data.cpu.frequency} MHz`),
    gaugeRow('Usage', data.cpu.usage, contentWidth),
    statRow('Load', data.cpu.loadAvg.map(l => l.toFixed(2)).join(' · ')),
  ];
  if (data.cpu.temperature) lines.push(statRow('Temp', `${data.cpu.temperature}°C`));
  return lines;
}

function memCard(data: StatsData, contentWidth: number): string[] {
  return [
    statRow('Total', formatBytes(data.memory.total)),
    statRow('Used', formatBytes(data.memory.used)),
    statRow('Free', formatBytes(data.memory.free)),
    gaugeRow('Usage', data.memory.usagePercent, contentWidth),
    statRow('Swap', `${formatBytes(data.memory.swapUsed)} / ${formatBytes(data.memory.swapTotal)}`),
  ];
}

function powerCard(data: StatsData): string[] | null {
  if (!data.power) return null;
  const lines: string[] = [];
  if (data.power.cpuWatts !== undefined) lines.push(statRow('CPU', `${data.power.cpuWatts.toFixed(2)} W`));
  if (data.power.gpuWatts !== undefined) lines.push(statRow('GPU', `${data.power.gpuWatts.toFixed(2)} W`));
  if (data.power.combinedWatts !== undefined) lines.push(statRow('Total', `${data.power.combinedWatts.toFixed(2)} W`));
  return lines.length ? lines : null;
}

function batteryCard(data: StatsData, contentWidth: number): string[] | null {
  if (!data.battery) return null;
  const valW = Math.max(6, contentWidth - 10);
  const lines = [
    statRow('Level', `${data.battery.level}%  (${data.battery.state})`),
    statRow('Time', data.battery.timeRemaining),
    statRow('Health', truncatePlain(data.battery.health, valW)),
  ];
  if (data.battery.maxCapacityPercent !== undefined) {
    lines.push(statRow('Capacity', capacityColor(data.battery.maxCapacityPercent)(`${data.battery.maxCapacityPercent}%`)));
  }
  lines.push(statRow('Source', data.battery.powerSource));
  return lines;
}

function thermalCard(data: StatsData, contentWidth: number): string[] {
  const valW = Math.max(6, contentWidth - 10);
  const lines = [statRow('State', thermalColor(data.thermal.pressureLevel)(truncatePlain(data.thermal.state, valW)))];
  if (data.thermal.temperatures) {
    for (const [k, v] of Object.entries(data.thermal.temperatures)) {
      lines.push(statRow(k.replace('_', ' '), v !== null ? `${v}°C` : 'N/A'));
    }
  }
  if (data.thermal.error) lines.push(statRow('Error', truncatePlain(data.thermal.error, valW)));
  return lines;
}

function networkCard(data: StatsData, contentWidth: number): string[] {
  const valW = Math.max(6, contentWidth - 8);
  return [
    statRow('Iface', truncatePlain(`${data.network.interface} (${data.network.ip})`, valW)),
    statRow('RX', `${formatBytes(data.network.rxBytes)} · ${data.network.rxPackets} pkts`),
    statRow('TX', `${formatBytes(data.network.txBytes)} · ${data.network.txPackets} pkts`),
  ];
}

// --- header ------------------------------------------------------------------

function header(data: StatsData, width: number, badges: string[] = [], borderAccent = THEMES.default.border): string[] {
  const left = `${chalk.hex('#ff5500').bold(' PYRE ')} ${chalk.bold(data.header.hostname)}  ${chalk.dim(data.header.os)}  ${chalk.dim('up ' + data.header.uptime)}`;
  const right = badges.join('   ');
  const gap = Math.max(1, width - visLen(left) - visLen(right));
  const line = left + ' '.repeat(gap) + right;
  return [line, borderAccent('─'.repeat(width))];
}

// --- process / disk tables ---------------------------------------------------

function sortProcesses(
  processes: { pid: number; user: string; cpu: number; mem: number; command: string }[],
  sortBy: 'cpu' | 'mem' | 'pid'
) {
  const copy = [...processes];
  if (sortBy === 'pid') return copy.sort((a, b) => a.pid - b.pid);
  if (sortBy === 'mem') return copy.sort((a, b) => b.mem - a.mem);
  return copy.sort((a, b) => b.cpu - a.cpu);
}

function pctColor(v: number): (s: string) => string {
  return v > 80 ? chalk.red : v > 50 ? chalk.yellow : chalk.dim;
}

function processTableLines(
  processes: { pid: number; user: string; cpu: number; mem: number; command: string }[],
  contentWidth: number,
  borderAccent = THEMES.default.border
): string[] {
  const pidW = 7, userW = 10, cpuW = 7, memW = 7;
  const cmdW = Math.max(10, contentWidth - pidW - userW - cpuW - memW - 4);
  const head =
    chalk.bold.dim('PID'.padEnd(pidW)) +
    chalk.bold.dim('USER'.padEnd(userW)) +
    chalk.bold.dim('CPU%'.padEnd(cpuW)) +
    chalk.bold.dim('MEM%'.padEnd(memW)) +
    chalk.bold.dim('COMMAND');
  const rows = processes.map(p => {
    const cpuStr = pctColor(p.cpu)(`${p.cpu.toFixed(1)}`.padEnd(cpuW));
    const memStr = pctColor(p.mem)(`${p.mem.toFixed(1)}`.padEnd(memW));
    return (
      String(p.pid).padEnd(pidW) +
      truncatePlain(p.user, userW - 1).padEnd(userW) +
      cpuStr +
      memStr +
      truncatePlain(p.command, cmdW)
    );
  });
  return [head, borderAccent('─'.repeat(contentWidth)), ...rows];
}

function diskTableLines(
  disks: { filesystem: string; size: string; used: string; available: string; capacity: string; mountpoint: string }[],
  contentWidth: number,
  borderAccent = THEMES.default.border
): string[] {
  const fsW = 16, sizeW = 8, usedW = 8, availW = 8, capW = 7;
  const mountW = Math.max(8, contentWidth - fsW - sizeW - usedW - availW - capW - 5);
  const head =
    chalk.bold.dim('FILESYSTEM'.padEnd(fsW)) +
    chalk.bold.dim('SIZE'.padEnd(sizeW)) +
    chalk.bold.dim('USED'.padEnd(usedW)) +
    chalk.bold.dim('AVAIL'.padEnd(availW)) +
    chalk.bold.dim('CAP'.padEnd(capW)) +
    chalk.bold.dim('MOUNT');
  const rows = disks.slice(0, 8).map(d => {
    const capNum = parseInt(d.capacity, 10) || 0;
    const capStr = pctColor(capNum)(d.capacity.padEnd(capW));
    return (
      truncatePlain(d.filesystem, fsW - 1).padEnd(fsW) +
      d.size.padEnd(sizeW) +
      d.used.padEnd(usedW) +
      d.available.padEnd(availW) +
      capStr +
      truncatePlain(d.mountpoint, mountW)
    );
  });
  return [head, borderAccent('─'.repeat(contentWidth)), ...rows];
}

// --- main dashboard ------------------------------------------------------------

export function formatTable(data: StatsData, opts: TableOptions = {}): string {
  const width = clampWidth(opts.width);
  const columns = gridColumns(width);
  const gap = 2;
  const cardWidth = Math.floor((width - gap * (columns - 1)) / columns);
  const contentWidth = cardWidth - 4;

  const themeName = opts.theme || 'default';
  const theme = THEMES[themeName] || THEMES.default;
  const vis = opts.visible ?? {};

  const out: string[] = [];
  out.push(...header(data, width, [], theme.border));
  out.push('');

  type Card = { title: string; accent: (s: string) => string; lines: string[] };
  const cards: Card[] = [];

  if (vis.cpu !== false) {
    cards.push({ title: 'CPU', accent: theme.cpu, lines: cpuCard(data, contentWidth) });
  }
  if (vis.mem !== false) {
    cards.push({ title: 'Memory', accent: theme.mem, lines: memCard(data, contentWidth) });
  }
  if (vis.power !== false) {
    const power = powerCard(data);
    if (power) cards.push({ title: 'Power', accent: theme.power, lines: power });
  }
  if (vis.battery !== false) {
    const battery = batteryCard(data, contentWidth);
    if (battery) cards.push({ title: 'Battery', accent: theme.battery, lines: battery });
  }
  if (vis.thermal !== false) {
    cards.push({ title: 'Thermal', accent: theme.thermal, lines: thermalCard(data, contentWidth) });
  }
  if (vis.network !== false) {
    cards.push({ title: 'Network', accent: theme.network, lines: networkCard(data, contentWidth) });
  }

  for (let i = 0; i < cards.length; i += columns) {
    const row = cards.slice(i, i + columns);
    const rowHeight = Math.max(...row.map(c => c.lines.length));
    const blocks = row.map(c => panel(c.title, c.lines, cardWidth, c.accent, theme.border, rowHeight));
    out.push(...hstack(blocks, gap));
    out.push('');
  }

  if (vis.disk !== false && data.disk.length) {
    const dw = width - 4;
    out.push(...panel('Disk', diskTableLines(data.disk, dw, theme.border), width, theme.disk, theme.border));
    out.push('');
  }

  if (vis.process !== false) {
    const filteredProcesses = opts.filter
      ? data.processes.filter(p => p.command.toLowerCase().includes(opts.filter!.toLowerCase()))
      : data.processes;
    const sortedProcesses = sortProcesses(filteredProcesses, opts.sortBy ?? 'cpu');
    const limited = opts.processLimit ? sortedProcesses.slice(0, opts.processLimit) : sortedProcesses;

    const procTitle = opts.filter
      ? `Processes · filter "${opts.filter}" · sort ${opts.sortBy ?? 'cpu'}`
      : `Processes · sort ${opts.sortBy ?? 'cpu'}`;

    if (limited.length) {
      out.push(...panel(procTitle, processTableLines(limited, width - 4, theme.border), width, theme.process, theme.border));
    } else if (opts.filter) {
      out.push(...panel(procTitle, [chalk.dim(`No processes match "${opts.filter}"`)], width, theme.process, theme.border));
    }
  }

  return out.join('\n');
}

export function formatJson(data: StatsData): string {
  return JSON.stringify(data, null, 2);
}

export function formatCsv(data: StatsData): string {
  const rows: string[][] = [
    ['property', 'key', 'value'],
    ['cpu', 'brand', data.cpu.brand],
    ['cpu', 'usage', String(data.cpu.usage)],
    ['cpu', 'loadAvg_1m', String(data.cpu.loadAvg[0])],
    ['cpu', 'loadAvg_5m', String(data.cpu.loadAvg[1])],
    ['cpu', 'loadAvg_15m', String(data.cpu.loadAvg[2])],
    ['memory', 'total', String(data.memory.total)],
    ['memory', 'used', String(data.memory.used)],
    ['memory', 'usagePercent', String(data.memory.usagePercent)],
    ['memory', 'swapUsed', String(data.memory.swapUsed)],
    ['memory', 'swapTotal', String(data.memory.swapTotal)],
    ['thermal', 'state', data.thermal.state],
    ['thermal', 'cpuTemp', data.thermal.temperatures?.cpu_die ? String(data.thermal.temperatures.cpu_die) : ''],
    ['network', 'rxBytes', String(data.network.rxBytes)],
    ['network', 'txBytes', String(data.network.txBytes)],
    ['battery', 'level', data.battery ? String(data.battery.level) : ''],
    ['battery', 'powerSource', data.battery ? data.battery.powerSource : ''],
    ['battery', 'condition', data.battery?.condition ?? ''],
    ['battery', 'maxCapacityPercent', data.battery?.maxCapacityPercent !== undefined ? String(data.battery.maxCapacityPercent) : ''],
    ['battery', 'cycles', data.battery?.cycles !== undefined ? String(data.battery.cycles) : ''],
    ['power', 'cpuWatts', data.power?.cpuWatts !== undefined ? String(data.power.cpuWatts) : ''],
    ['power', 'gpuWatts', data.power?.gpuWatts !== undefined ? String(data.power.gpuWatts) : ''],
    ['power', 'combinedWatts', data.power?.combinedWatts !== undefined ? String(data.power.combinedWatts) : ''],
    ['system', 'hostname', data.header.hostname],
    ['system', 'uptime', data.header.uptime],
    ['system', 'timestamp', data.timestamp],
  ];
  return rows.map(r => r.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function formatTsv(data: StatsData): string {
  return formatCsv(data).split('\n').map(r => r.split(',').join('\t')).join('\n');
}

export function formatGraphs(history: History, width = 80, themeName: ThemeName = 'default'): string {
  const theme = THEMES[themeName] || THEMES.default;
  const contentWidth = width - 4;
  const sampleCount = history.cpuUsage.length;
  const sparkWidth = Math.max(10, contentWidth - 28);

  const lines: string[] = [];
  lines.push(graphRow('CPU %', history.cpuUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth));
  lines.push(graphRow('Mem %', history.memUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth));
  if (history.temp.length) {
    lines.push(graphRow('Temp', history.temp, {}, v => `${v.toFixed(1)}°C`, sparkWidth));
  }
  lines.push(graphRow('Net RX/s', history.netRxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth));
  lines.push(graphRow('Net TX/s', history.netTxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth));

  const title = `Graphs · last ${sampleCount} sample${sampleCount === 1 ? '' : 's'}`;
  return panel(title, lines, width, theme.graphs, theme.border).join('\n');
}

function graphRow(
  label: string,
  values: number[],
  bounds: { min?: number; max?: number },
  fmt: (v: number) => string,
  sparkWidth = 40
): string {
  if (!values.length) {
    return `${chalk.dim(label.padEnd(10))} ${chalk.dim('collecting data...')}`;
  }
  const visible = values.slice(-sparkWidth);
  const spark = sparkline(visible, bounds);
  const current = values[values.length - 1];

  let color = chalk.cyan;
  if (bounds.min !== undefined && bounds.max !== undefined) {
    const pct = ((current - bounds.min) / (bounds.max - bounds.min || 1)) * 100;
    color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  }

  return `${chalk.dim(label.padEnd(10))}${color(spark)}  ${chalk.bold(fmt(current))}`;
}
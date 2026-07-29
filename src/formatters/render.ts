/**
 * Dashboard rendering helpers.
 *
 * This module contains every function that turns a {@link StatsData}
 * snapshot into styled terminal output: panel drawing, card layout,
 * process/disk tables, and the main `formatTable` orchestrator.
 *
 * Low-level utilities (ANSI stripping, padding, truncation) live
 * here alongside the higher-level card and table renderers so that
 * all layout-related code is co-located.
 */
import chalk from 'chalk';
import { sparkline } from '../sparkline.js';
import type { History } from '../history.js';
import type { StatsData, VisibleItems, TableOptions, AnomalyAlert } from './types.js';
import { THEMES, type ThemeName } from './themes.js';

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
export function panel(
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
  const top = borderAccent('┌' + label + '─'.repeat(width - label.length - 2) + '┐');
  const bottom = borderAccent('└' + '─'.repeat(width - 2) + '┘');
  const body: string[] = [];
  for (let i = 0; i < h; i++) {
    const line = lines[i] ?? '';
    body.push(`${borderAccent('│')} ${padVisible(line, contentWidth)} ${borderAccent('│')}`);
  }
  return [top, ...body, bottom];
}

/** Join equal-or-uneven-height panel blocks side by side with a gap. */
function hstack(blocks: string[][], gap = 2, targetWidth?: number): string[] {
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
    let line = padded.map(a => a[row]).join(' '.repeat(gap));
    if (targetWidth !== undefined) {
      const pad = Math.max(0, targetWidth - visLen(line));
      line += ' '.repeat(pad);
    }
    out.push(line);
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
  const filledStr = '█'.repeat(Math.max(0, filled));
  const emptyStr = '░'.repeat(Math.max(0, empty));
  const color = percent > 90 ? chalk.red : percent > 70 ? chalk.yellow : chalk.green;
  return color(filledStr + emptyStr);
}

function gaugeRow(label: string, percent: number, contentWidth: number): string {
  const labelW = 9;
  const pctText = `${Math.round(percent)}%`;
  const barW = Math.max(6, contentWidth - labelW - pctText.length - 1);
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * barW);
  const empty = barW - filled;
  const barStr = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
  const color = percent > 90 ? chalk.red : percent > 70 ? chalk.yellow : chalk.green;
  return `${chalk.dim(label.padEnd(labelW))}${color(barStr)} ${pctText}`;
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function celsiusToFahrenheit(c: number): number {
  return c * (9 / 5) + 32;
}

/** Render a Celsius reading with its Fahrenheit equivalent alongside it, e.g. "62.0°C / 143.6°F". */
export function formatTemp(c: number): string {
  return `${c.toFixed(1)}°C / ${celsiusToFahrenheit(c).toFixed(1)}°F`;
}

// --- cards -------------------------------------------------------------------

function cpuCard(data: StatsData, contentWidth: number): string[] {
  const lines = [
    statRow('Brand', truncatePlain(data.cpu.brand, Math.max(4, contentWidth - 8))),
    statRow('Cores', `${data.cpu.physicalCores}/${data.cpu.cores} phys/log`),
    statRow('Freq', `${data.cpu.frequency} MHz`),
    gaugeRow('Usage', data.cpu.usage, contentWidth),
    statRow('Load', data.cpu.loadAvg.map(l => l.toFixed(2)).join(' ')),
  ];
  if (data.cpu.coreUsage && data.cpu.coreUsage.length) {
    const slotW = 2;
    const maxCores = Math.max(1, Math.floor((contentWidth - 10) / (slotW + 1)));
    const cores = data.cpu.coreUsage.slice(0, maxCores);
    const bars = cores.map(u => {
      const fill = Math.round((Math.min(100, u) / 100) * slotW);
      const str = '█'.repeat(Math.max(0, fill)) + '░'.repeat(slotW - fill);
      const color = u > 90 ? chalk.red : u > 70 ? chalk.yellow : chalk.green;
      return color(str);
    });
    lines.push(statRow('Cores', bars.join(' ')));
  }
  if (data.cpu.temperature) lines.push(statRow('Temp', formatTemp(data.cpu.temperature)));
  return lines;
}

function memCard(data: StatsData, contentWidth: number): string[] {
  return [
    statRow('Total', formatBytes(data.memory.total)),
    statRow('Used', formatBytes(data.memory.used)),
    statRow('Cached', formatBytes(data.memory.total - data.memory.free - data.memory.used)),
    statRow('Free', formatBytes(data.memory.free)),
    gaugeRow('Usage', data.memory.usagePercent, contentWidth),
    statRow('Swap', `${formatBytes(data.memory.swapUsed)} / ${formatBytes(data.memory.swapTotal)}`),
  ];
}

function gpuCard(data: StatsData, contentWidth: number): string[] | null {
   if (!data.gpu) return null;
   const lines: string[] = [];
   lines.push(statRow('Model', truncatePlain(data.gpu.model, Math.max(4, contentWidth - 8))));
   lines.push(statRow('Memory', formatBytes(data.gpu.memory)));
   lines.push(statRow('Util', `${data.gpu.utilization}%`));
   if (data.gpu.temperature) lines.push(statRow('Temp', formatTemp(data.gpu.temperature)));
   lines.push(statRow('Procs', String(data.gpu.processes)));
   return lines;
 }

  function powerCard(data: StatsData): string[] | null {
   const lines: string[] = [];
   if (data.power) {
     if (data.power.cpuWatts !== undefined) lines.push(statRow('CPU', `${data.power.cpuWatts.toFixed(2)} W`));
     if (data.power.gpuWatts !== undefined) lines.push(statRow('GPU', `${data.power.gpuWatts.toFixed(2)} W`));
     if (data.power.combinedWatts !== undefined) lines.push(statRow('Total', `${data.power.combinedWatts.toFixed(2)} W`));
   }
   if (data.battery?.powerWatts !== undefined && data.battery.powerWatts > 0) {
     lines.push(statRow('Battery', `${data.battery.powerWatts.toFixed(2)} W`));
   }
   return lines.length ? lines : null;
 }

function batteryCard(data: StatsData, contentWidth: number): string[] | null {
  if (!data.battery) return null;
  const valW = Math.max(6, contentWidth - 10);
  const lines = [
    statRow('Level', `${data.battery.level}%  (${data.battery.state})`),
    statRow('Time', data.battery.timeRemaining),
    statRow('Cycles', String(data.battery.cycles ?? 'N/A')),
    statRow('Condition', data.battery.condition ?? 'N/A'),
  ];
  if (data.battery.maxCapacityPercent !== undefined) {
    lines.push(statRow('Capacity', capacityColor(data.battery.maxCapacityPercent)(`${data.battery.maxCapacityPercent}%`)));
  }
  lines.push(statRow('Source', data.battery.powerSource));
  if (data.battery.estimatedTimeToEmpty && data.battery.state !== 'charged') {
    lines.push(statRow('Est. Empty', data.battery.estimatedTimeToEmpty));
  }
  if (data.battery.dischargeRatePerHour !== undefined && data.battery.state !== 'charged') {
    lines.push(statRow('Disch. Rate', `${data.battery.dischargeRatePerHour}%/h`));
  }
  return lines;
}

function thermalCard(data: StatsData, contentWidth: number): string[] {
  const valW = Math.max(6, contentWidth - 10);
  const lines = [statRow('State', thermalColor(data.thermal.pressureLevel)(truncatePlain(data.thermal.state, valW)))];
  if (data.thermal.temperatures) {
    for (const [k, v] of Object.entries(data.thermal.temperatures)) {
      lines.push(statRow(k.replace('_', ' '), v !== null && v !== undefined ? formatTemp(v) : 'N/A'));
    }
  }
  if (data.thermal.error) lines.push(statRow('Error', truncatePlain(data.thermal.error, valW)));
  return lines;
}

function networkCard(data: StatsData, contentWidth: number): string[] {
  const valW = Math.max(6, contentWidth - 8);
  return [
    statRow('Iface', truncatePlain(`${data.network.interface} (${data.network.ip})`, valW)),
    statRow('RX', `${formatBytes(data.network.rxBytes)} / ${data.network.rxPackets} pkt`),
    statRow('TX', `${formatBytes(data.network.txBytes)} / ${data.network.txPackets} pkt`),
  ];
}

function packetCard(data: StatsData, contentWidth: number): string[] | null {
  if (!data.packets) return null;
  const lines: string[] = [];
  lines.push(statRow('Total', `${data.packets.totalPackets} pkt`));
  lines.push(statRow('RX', `${data.packets.rxPackets} pkt`));
  lines.push(statRow('TX', `${data.packets.txPackets} pkt`));
  lines.push(statRow('Conns', `${data.packets.connections} TCP`));
  if (data.packets.topProcesses && data.packets.topProcesses.length) {
    lines.push(statRow('Top Proc', truncatePlain(data.packets.topProcesses[0].command, contentWidth - 10)));
  }
  if (data.packets.allProcesses && data.packets.allProcesses.length > 1) {
    lines.push(statRow('Net Procs', `${data.packets.allProcesses.length} processes`));
  }
  if (data.packets.interfaces && data.packets.interfaces.length) {
    lines.push(statRow('Ifaces', `${data.packets.interfaces.length} active`));
  }
  return lines;
}

function tasksCard(data: StatsData, contentWidth: number): string[] | null {
  if (!data.tasks || !data.tasks.length) return null;
  const lines: string[] = [];
  for (const task of data.tasks.slice(0, 6)) {
    const cmd = truncatePlain(task.command, Math.max(4, contentWidth - 28));
    lines.push(statRow(`${task.pid}`, `${task.user.padEnd(8)} ${task.cpu.toFixed(1).padStart(5)}% ${task.mem.toFixed(1).padStart(5)}% ${task.state} ${cmd}`));
  }
  return lines;
}

// --- header / tabs -----------------------------------------------------------

function header(data: StatsData, width: number, badges: string[] = [], borderAccent = THEMES.default.border): string[] {
  const now = new Date().toLocaleTimeString();
  const left = `${chalk.hex('#ff5500').bold(' PYRE ')} ${chalk.bold(data.header.hostname)}  ${chalk.dim(data.header.os)}  ${chalk.dim('up ' + data.header.uptime)}`;
  const right = `${chalk.dim(now)}  ${badges.join('  ')}`;
  const gap = Math.max(1, width - visLen(left) - visLen(right));
  const line = left + ' '.repeat(gap) + right;
  return [line, borderAccent('─'.repeat(width))];
}

/**
 * Canonical tab list shared between the renderer (drawing the tab bar)
 * and the live dashboard's mouse handler (hit-testing clicks against it).
 * Keeping a single source of truth here avoids the two drifting apart.
 */
export const TAB_DEFS: { id: string; label: string; key: string }[] = [
  { id: 'cpu', label: 'CPU', key: '1' },
  { id: 'mem', label: 'Memory', key: '2' },
  { id: 'gpu', label: 'GPU', key: '3' },
  { id: 'power', label: 'Power', key: '4' },
  { id: 'battery', label: 'Battery', key: '5' },
  { id: 'thermal', label: 'Thermal', key: '6' },
  { id: 'network', label: 'Network', key: '7' },
  { id: 'packets', label: 'Packets', key: '8' },
  { id: 'tasks', label: 'Tasks', key: '9' },
  { id: 'disk', label: 'Disk', key: '0' },
  { id: 'process', label: 'Process', key: 'P' },
  { id: 'p2p', label: 'P2P', key: 'R' },
];

/** The number of leading columns of indent before the tab bar's first character (see `tabBar`). */
const TAB_BAR_INDENT = 2;
/** Visible width of the ' │ ' separator drawn between tabs. */
const TAB_SEPARATOR_WIDTH = 3;

/**
 * Compute the column range (inclusive start, exclusive end) each tab
 * occupies when rendered by `tabBar`, so a click at a given column can be
 * mapped back to a panel id. Row is always the same line the tab bar is
 * printed on (see `formatTable`: header takes 2 lines, then a blank line,
 * then the tab bar — i.e. row 4 in a 1-indexed terminal, row index 3 if
 * 0-indexed from the top of the dashboard).
 */
export function getTabHitboxes(): { id: string; start: number; end: number }[] {
  const boxes: { id: string; start: number; end: number }[] = [];
  let col = TAB_BAR_INDENT;
  TAB_DEFS.forEach((t, i) => {
    const text = `[${t.key}]${t.label}`;
    const start = col;
    const end = col + text.length;
    boxes.push({ id: t.id, start, end });
    col = end;
    if (i < TAB_DEFS.length - 1) col += TAB_SEPARATOR_WIDTH;
  });
  return boxes;
}

/** Row (1-indexed, matching terminal mouse-report coordinates) the tab bar renders on. */
export const TAB_BAR_ROW = 4;

function tabBar(activePanel: string, width: number, theme: ThemeColors): string {
  const rendered = TAB_DEFS.map(t => {
    const isActive = activePanel === t.id;
    const label = isActive ? chalk.bold(t.label) : chalk.dim(t.label);
    const keyHint = chalk.dim(`[${t.key}]`);
    return `${keyHint}${label}`;
  });

  const joined = rendered.join(chalk.dim(' │ '));
  const padded = visLen(joined) < width ? joined + ' '.repeat(width - visLen(joined)) : joined;
  return chalk.dim('  ') + padded;
}

// --- process / disk tables ---------------------------------------------------

function sortProcesses(
   processes: { pid: number; ppid: number; user: string; cpu: number; mem: number; command: string; state: string; threads: number; runtime: number }[],
   sortBy: 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime'
 ) {
   const copy = [...processes];
   switch (sortBy) {
     case 'pid': return copy.sort((a, b) => a.pid - b.pid);
     case 'mem': return copy.sort((a, b) => b.mem - a.mem);
     case 'user': return copy.sort((a, b) => a.user.localeCompare(b.user));
     case 'command': return copy.sort((a, b) => a.command.localeCompare(b.command));
     case 'state': return copy.sort((a, b) => a.state.localeCompare(b.state));
     case 'threads': return copy.sort((a, b) => b.threads - a.threads);
     case 'runtime': return copy.sort((a, b) => b.runtime - a.runtime);
     default: return copy.sort((a, b) => b.cpu - a.cpu);
   }
 }

function pctColor(v: number): (s: string) => string {
  return v > 80 ? chalk.red : v > 50 ? chalk.yellow : chalk.dim;
}

function processTableLines(
   processes: { pid: number; ppid: number; user: string; cpu: number; mem: number; command: string; state: string; threads: number; runtime: number }[],
   contentWidth: number,
   borderAccent = THEMES.default.border
 ): string[] {
    const pidW = 8, ppidW = 8, userW = 12, cpuW = 8, memW = 8, stateW = 8, thrW = 6, rtW = 10;

   const cmdW = Math.max(10, contentWidth - pidW - ppidW - userW - cpuW - memW - stateW - thrW - rtW - 8);
    const head =
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' PID    ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' PPID   ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' USER       ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' CPU%   ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' MEM%   ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' STATE   ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' THREADS') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' RUNTIME  ') +
      chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' COMMAND'.padEnd(cmdW + 1));

   const rows = processes.map(p => {
     const cpuStr = pctColor(p.cpu)(`${p.cpu.toFixed(1)}`.padEnd(cpuW));
     const memStr = pctColor(p.mem)(`${p.mem.toFixed(1)}`.padEnd(memW));
     const stateStr = chalk.dim(p.state.padEnd(stateW));
     const thrStr = String(p.threads).padEnd(thrW);
     const rtStr = formatRuntime(p.runtime).padEnd(rtW);
     return (
       String(p.pid).padEnd(pidW) +
       String(p.ppid).padEnd(ppidW) +
       truncatePlain(p.user, userW - 1).padEnd(userW) +
       cpuStr +
       memStr +
       stateStr +
       thrStr +
       rtStr +
       truncatePlain(p.command, cmdW)
     );
   });
   return [head, borderAccent('─'.repeat(contentWidth)), ...rows];
 }

 function formatRuntime(seconds: number): string {
   if (seconds < 60) return `${seconds}s`;
   const mins = Math.floor(seconds / 60);
   if (mins < 60) return `${mins}m ${seconds % 60}s`;
   const hrs = Math.floor(mins / 60);
   return `${hrs}h ${mins % 60}m`;
 }

function buildProcessTree(
   processes: { pid: number; ppid: number; user: string; cpu: number; mem: number; command: string; state: string; threads: number; runtime: number }[]
  ): string[] {
   const map = new Map<number, typeof processes[0]>();
   const roots: typeof processes[0][] = [];
   for (const p of processes) map.set(p.pid, p);
   for (const p of processes) {
     if (p.ppid === 0 || !map.has(p.ppid)) roots.push(p);
   }

   const childrenMap = new Map<number, typeof processes[0][]>();
   for (const p of processes) {
     const list = childrenMap.get(p.ppid) || [];
     list.push(p);
     childrenMap.set(p.ppid, list);
   }
   for (const list of childrenMap.values()) {
     list.sort((a, b) => b.cpu - a.cpu);
   }

    const lines: string[] = [];
    const visited = new Set<number>();
    function renderNode(proc: typeof processes[0], prefix: string, isLast: boolean) {
      if (visited.has(proc.pid)) return;
      visited.add(proc.pid);
      const connector = isLast ? '└── ' : '├── ';
     const pidStr = String(proc.pid).padEnd(8);
       const cpuStr = pctColor(proc.cpu)(`${proc.cpu.toFixed(1)}%`.padEnd(8));
       const memStr = pctColor(proc.mem)(`${proc.mem.toFixed(1)}%`.padEnd(8));
       const stateStr = chalk.dim(proc.state.padEnd(8));
       const thrStr = String(proc.threads).padEnd(6);

      const cmd = truncatePlain(proc.command, Math.max(10, 100 - pidStr.length - cpuStr.length - memStr.length - stateStr.length - thrStr.length - 10));
      lines.push(`${prefix}${connector}${pidStr}${cpuStr}${memStr}${stateStr}${thrStr} ${cmd}`);
      const children = childrenMap.get(proc.pid);
      if (children) {
        let idx = 0;
        let total = 0;
        for (const c of children) {
          if (!visited.has(c.pid)) total++;
        }
        for (const child of children) {
          if (visited.has(child.pid)) continue;
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          renderNode(child, nextPrefix, ++idx === total);
        }
      }
    }
   roots.sort((a, b) => b.cpu - a.cpu);
   roots.forEach((root, i) => renderNode(root, '', i === roots.length - 1));
   return lines;
 }

function diskTableLines(
  disks: { filesystem: string; size: string; used: string; available: string; capacity: string; mountpoint: string }[],
  contentWidth: number,
  borderAccent = THEMES.default.border
): string[] {
    const fsW = 20, sizeW = 10, usedW = 10, availW = 10, capW = 8;

  const mountW = Math.max(8, contentWidth - fsW - sizeW - usedW - availW - capW - 5);
  const head =
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' FILESYSTEM          ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' SIZE      ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' USED      ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' AVAIL     ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' CAP     ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' MOUNT'.padEnd(mountW + 1));
    const rows = disks.map(d => {

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

function detailPanelTitle(panel: string): string {
  const map: Record<string, string> = {
    cpu: 'CPU',
    mem: 'Memory',
    gpu: 'GPU',
    power: 'Power',
    battery: 'Battery',
    thermal: 'Thermal',
    network: 'Network',
    packets: 'Packets',
    tasks: 'Tasks',
    disk: 'Disk',
    process: 'Processes',
  };
  return map[panel] || panel;
}

function activeDetailLines(data: StatsData, activePanel: string, width: number, opts: TableOptions = {}): string[] | null {
  const contentWidth = width - 4;
  const themeName = opts.theme || 'default';
  const theme = THEMES[themeName] || THEMES.default;
  switch (activePanel) {
    case 'cpu':
      return cpuCard(data, contentWidth);
    case 'mem':
      return memCard(data, contentWidth);
    case 'gpu': {
      const gpu = gpuCard(data, contentWidth);
      return gpu ?? ['No GPU data available'];
    }
    case 'power': {
      const power = powerCard(data);
      if (!power && !data.battery) return ['No power data available'];
      const lines: string[] = [];
      if (power) lines.push(...power);
      if (data.battery?.powerWatts !== undefined && data.battery.powerWatts > 0) {
        lines.push(statRow('Battery', `${data.battery.powerWatts.toFixed(2)} W`));
      }
      return lines.length ? lines : ['No power data available'];
    }
    case 'battery':
      return data.battery ? batteryCard(data, contentWidth) : ['No battery data available'];
    case 'thermal':
      return thermalCard(data, contentWidth);
    case 'network':
      return networkCard(data, contentWidth);
    case 'packets': {
      if (!data.packets) return ['No packet data available'];
      const lines: string[] = [];
      lines.push(statRow('Total', `${data.packets.totalPackets} pkt`));
      lines.push(statRow('RX', `${data.packets.rxPackets} pkt`));
      lines.push(statRow('TX', `${data.packets.txPackets} pkt`));
      lines.push(statRow('Conns', `${data.packets.connections} TCP`));
      if (data.packets.interfaces && data.packets.interfaces.length) {
        lines.push(statRow('Ifaces', `${data.packets.interfaces.length} active`));
        for (const iface of data.packets.interfaces.slice(0, 8)) {
          lines.push(statRow(`  ${iface.iface}`, `RX ${formatBytes(iface.rxBytes)} / TX ${formatBytes(iface.txBytes)}`));
        }
      }
      if (data.packets.allProcesses && data.packets.allProcesses.length) {
        lines.push(statRow('Net Procs', `${data.packets.allProcesses.length} total`));
        for (const proc of data.packets.allProcesses.slice(0, 10)) {
          lines.push(statRow(`  ${proc.pid}`, `${truncatePlain(proc.command, 20)}  TX ${formatBytes(proc.txBytes)}`));
        }
      }
      return lines;
    }
    case 'tasks':
      return data.tasks?.length ? tasksCard(data, contentWidth) : ['No task data available'];
    case 'disk':
      return data.disk.length ? diskTableLines(data.disk, width - 4, theme.border) : ['No disk data available'];
    case 'process': {
      const filtered = opts.filter
        ? data.processes.filter(p => p.command.toLowerCase().includes(opts.filter!.toLowerCase()))
        : data.processes;
      const sorted = sortProcesses(filtered, opts.sortBy ?? 'cpu');
      const limited = opts.processLimit ? sorted.slice(0, opts.processLimit) : sorted;
      if (opts.treeView) {
        return buildProcessTree(limited);
      }
      return processTableLines(limited, width - 4, theme.border);
    }
    default:
      return null;
  }
}

function anomalyPanel(anomalies: AnomalyAlert[], width: number, theme: ThemeColors): string[] {
  const lines: string[] = [];
  for (const a of anomalies) {
    const color = a.severity === 'critical' ? chalk.red.bold : chalk.yellow;
    const direction = a.zScore > 0 ? '↑ spike' : '↓ drop';
    lines.push(color(` ⚠ ${a.metric}: ${a.value.toFixed(1)} (${direction}, σ=${a.zScore.toFixed(1)})`));
  }
  return lines;
}

export function formatTable(data: StatsData, opts: TableOptions = {}): string {
   const width = clampWidth(opts.width);
   const activePanel = opts.activePanel || 'grid';
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

   const anomalies = opts.anomalies ?? [];
   if (anomalies.length && activePanel === 'grid') {
     out.push(...anomalyPanel(anomalies, width, theme));
     out.push('');
   }

   out.push(tabBar(activePanel, width, theme));
   out.push('');

  if (activePanel !== 'grid') {
    const lines = activeDetailLines(data, activePanel, width, opts);
    if (lines) {
      out.push(...panel(detailPanelTitle(activePanel), lines, width, theme[activePanel as keyof ThemeColors] ?? theme.cpu, theme.border));
    }
    return out.join('\n');
  }

  type Card = { title: string; accent: (s: string) => string; lines: string[] };
  const cards: Card[] = [];

   if (vis.cpu !== false) {
     cards.push({ title: 'CPU', accent: theme.cpu, lines: cpuCard(data, contentWidth) });
   }
   if (vis.mem !== false) {
     cards.push({ title: 'Memory', accent: theme.mem, lines: memCard(data, contentWidth) });
   }
   if (vis.gpu !== false) {
     const gpu = gpuCard(data, contentWidth);
     if (gpu) cards.push({ title: 'GPU', accent: theme.gpu, lines: gpu });
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
  if (vis.packets !== false) {
    const packets = packetCard(data, contentWidth);
    if (packets) cards.push({ title: 'Packets', accent: theme.network, lines: packets });
  }
  if (vis.tasks !== false) {
    const tasks = tasksCard(data, contentWidth);
    if (tasks) cards.push({ title: 'Tasks', accent: theme.process, lines: tasks });
  }

   for (let i = 0; i < cards.length; i += columns) {
     const row = cards.slice(i, i + columns);
     const rowHeight = Math.max(...row.map(c => c.lines.length));
     const blocks = row.map(c => panel(c.title, c.lines, cardWidth, c.accent, theme.border, rowHeight));
     out.push(...hstack(blocks, gap, width));
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

     if (opts.treeView) {
       const treeLines = buildProcessTree(limited);
       if (treeLines.length) {
         out.push(...panel(procTitle + ' · tree', treeLines, width, theme.process, theme.border));
       } else if (opts.filter) {
         out.push(...panel(procTitle, [chalk.dim(`No processes match "${opts.filter}"`)], width, theme.process, theme.border));
       }
     } else if (limited.length) {
       out.push(...panel(procTitle, processTableLines(limited, width - 4, theme.border), width, theme.process, theme.border));
     } else if (opts.filter) {
       out.push(...panel(procTitle, [chalk.dim(`No processes match "${opts.filter}"`)], width, theme.process, theme.border));
     }
   }

  return out.join('\n');
}

/** Clamp/normalize a terminal width to a sane range, defaulting to 80 cols. */
export function clampWidth(width?: number): number {
  if (!width || Number.isNaN(width)) return 80;
  return Math.max(60, Math.min(width, 240));
}

/**
 * How many stat cards fit per row at a given terminal width.
 * Shared with the live dashboard for layout budgeting.
 */
export function gridColumns(width: number): number {
  if (width >= 150) return 3;
  if (width >= 96) return 2;
  return 1;
}
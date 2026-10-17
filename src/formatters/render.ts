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
import { sparkline, multiRowSparkline, brailleGraph, multiRowBrailleGraph } from '../sparkline.js';
import type { History } from '../history.js';
import type { StatsData, VisibleItems, TableOptions, AnomalyAlert } from './types.js';
import type { BlenderRenderData } from '../monitors/types.js';
import { THEMES, type ThemeName, type ThemeColors } from './themes.js';
import { explainAnomaliesLocally } from '../ai/models.js';
import { collectListeningPorts, formatPortsPanelLines } from '../portsCmd.js';
import { render3DSprite, renderMiniCyberVisor, SPRITE_3D_MODES, type Sprite3DMode } from './sprites3d.js';



// --- low-level box drawing ---------------------------------------------------

function codePointWidth(cp: number): number {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (
    cp === 0x26a1 || // ⚡
    cp === 0x23f8 || // ⏸
    cp === 0x231b ||
    cp === 0x231a ||
    (cp >= 0x1100 &&
      (cp <= 0x115f ||
        cp === 0x2329 ||
        cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x20000 && cp <= 0x3fffd)))
  ) {
    return 2;
  }
  return 1;
}

export function visLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) w += codePointWidth(cp);
  }
  return w;
}

/**
 * Slice a string containing ANSI escape sequences by visible column indices [start, end).
 */
export function sliceVisible(s: string, start: number, end?: number): string {
  const sCol = Math.max(0, start);
  const eCol = end !== undefined ? Math.max(sCol, end) : Infinity;
  let visibleCount = 0;
  let out = '';
  let activeAnsi = '';
  let currentSeq = '';
  let inAnsi = false;

  for (let i = 0; i < s.length; ) {
    const char = s[i];
    if (char === '\x1b') {
      inAnsi = true;
      currentSeq = char;
      i++;
    } else if (inAnsi) {
      currentSeq += char;
      i++;
      if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) {
        inAnsi = false;
        if (visibleCount <= sCol) {
          if (currentSeq === '\x1b[0m' || currentSeq === '\x1b[m') {
            activeAnsi = '';
          } else {
            activeAnsi += currentSeq;
          }
        } else if (visibleCount < eCol) {
          out += currentSeq;
        }
        currentSeq = '';
      }
    } else {
      const cp = s.codePointAt(i) ?? 0;
      const charStr = String.fromCodePoint(cp);
      const cw = codePointWidth(cp);
      i += charStr.length;

      if (visibleCount >= sCol && visibleCount + cw <= eCol) {
        if (out === '' && activeAnsi) {
          out += activeAnsi;
        }
        out += charStr;
      } else if (visibleCount < eCol && visibleCount + cw > eCol) {
        // Wide char would straddle the right boundary; pad with a space
        if (out === '' && activeAnsi) {
          out += activeAnsi;
        }
        out += ' ';
      }
      visibleCount += cw;
      if (visibleCount >= eCol && !inAnsi) {
        break;
      }
    }
  }
  return out ? out + '\x1b[0m' : '';
}

export function fitVisible(s: string, width: number): string {
  const w = Math.max(0, width);
  const len = visLen(s);
  if (len === w) return s;
  if (len < w) return s + ' '.repeat(w - len);
  const sliced = sliceVisible(s, 0, w);
  const resLen = visLen(sliced);
  return resLen < w ? sliced + ' '.repeat(w - resLen) : sliced;
}

export function padVisible(s: string, width: number): string {
  return fitVisible(s, width);
}

/**
 * Wrap a row in a continuous selection background color (#1e293b) without inner resets breaking the bar.
 */
export function styleSelectedRow(s: string, width: number, bgRgb = '30;41;59'): string {
  const fitted = fitVisible(s, width);
  const bgSeq = `\x1b[48;2;${bgRgb}m`;
  // Re-assert background color after any full reset or bg-reset inside the line
  // eslint-disable-next-line no-control-regex
  const patched = fitted.replace(/\x1b\[(0|49|22)m/g, `\x1b[$1m${bgSeq}`);
  return `${bgSeq}${patched}\x1b[0m`;
}

/**
 * Stamp a framed modal box array in the center of the terminal screen lines safely across ANSI sequences.
 */
export function stampOverlay(screenLines: string[], box: string[], width: number, _height?: number): void {
  const boxH = box.length;
  const startRow = Math.max(0, Math.floor((screenLines.length - boxH) / 2));
  const boxW = visLen(box[0] || '');
  const startCol = Math.max(0, Math.floor((width - boxW) / 2));

  for (let r = 0; r < boxH; r++) {
    const targetRow = startRow + r;
    if (targetRow < screenLines.length) {
      const orig = screenLines[targetRow] || '';
      const left = fitVisible(sliceVisible(orig, 0, startCol), startCol);
      const rightW = Math.max(0, width - startCol - boxW);
      const right = fitVisible(sliceVisible(orig, startCol + boxW, width), rightW);
      screenLines[targetRow] = left + box[r] + right;
    }
  }
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

/**
 * Extract a clean, readable application/binary name from long OS process paths
 * (e.g., macOS .app bundles or /System/Library/... paths) for compact process tables.
 */
export function cleanCommandName(cmd: string): string {
  const trimmed = (cmd || '').trim();
  if (!trimmed) return '';
  // macOS .app bundle executable: extract the binary inside Contents/MacOS/
  const appMatch = trimmed.match(/\.app\/Contents\/MacOS\/([^/]+)$/);
  if (appMatch) {
    return appMatch[1].trim();
  }
  // If starts with an absolute path without spaces or up to first flag
  if (trimmed.startsWith('/')) {
    const flagIdx = trimmed.indexOf(' -');
    const execPart = flagIdx > 0 ? trimmed.slice(0, flagIdx) : trimmed.split(/\s+/)[0];
    const argsPart = flagIdx > 0 ? trimmed.slice(flagIdx) : trimmed.slice(execPart.length);
    const base = execPart.split('/').pop() || execPart;
    return (base + argsPart).trim();
  }
  return trimmed;
}

function ensureWaveSamples(values: number[], targetPoints: number, frame = 14, minBound = 0, maxBound = 100): number[] {
  if (values.length >= targetPoints) {
    return values.slice(-targetPoints);
  }
  const anchor = values.length > 0 ? values[0] : 28;
  const missing = targetPoints - values.length;
  const synth: number[] = [];
  const base = Math.max(minBound + 8, anchor);
  for (let i = 0; i < missing; i++) {
    const phase = (i + frame) * 0.42;
    const harmonic = Math.sin(phase) * 0.28 + Math.cos(phase * 1.7) * 0.16 + Math.sin(phase * 0.5) * 0.12;
    const val = Math.min(maxBound, Math.max(minBound, base * (0.76 + harmonic)));
    synth.push(val);
  }
  return [...synth, ...values];
}

/**
 * Render a full-width multi-row Braille oscilloscope graph.
 */
function renderOscilloscopeChart(
  values: number[],
  width: number,
  height: number,
  accent: (s: string) => string,
  bounds: { min?: number; max?: number } = { min: 0, max: 100 },
  frame = 14
): string[] {
  const w = Math.max(4, width);
  const h = Math.max(1, height);
  const maxPoints = w * 2;
  const recent = ensureWaveSamples(
    values,
    maxPoints,
    frame,
    bounds.min ?? 0,
    bounds.max ?? Math.max(20, ...(values.length ? values : [40]))
  );

  const rawRows = multiRowBrailleGraph(recent, h, bounds);

  const out: string[] = [];
  for (let r = 0; r < h; r++) {
    const isBottom = r === h - 1;
    const rawLine = fitVisible(rawRows[r] || '', w);
    const waveStr = isBottom ? rawLine.replace(/ /g, '⣀') : rawLine;
    const rowColor = r === 0 && h > 2
      ? chalk.hex('#fb923c')
      : accent;
    out.push(fitVisible(rowColor(waveStr), w));
  }
  return out;
}

/**
 * Render a single-row full-width waveform with harmonic lead-in for unfilled columns.
 */
function renderInlineWave(
  values: number[],
  width: number,
  colorFn: (s: string) => string,
  mode: 'spark' | 'bar' = 'spark',
  bounds: { min?: number; max?: number } = {},
  frame = 14
): string {
  const w = Math.max(4, width);
  const maxB = bounds.max ?? Math.max(50, ...(values.length ? values : [50]), 100);
  if (mode === 'bar') {
    const recent = ensureWaveSamples(values, w, frame, bounds.min ?? 0, maxB);
    const wave = sparkline(recent, { min: bounds.min ?? 0, max: maxB }).replace(/ /g, '▁');
    return fitVisible(colorFn(wave), w);
  }
  const recent = ensureWaveSamples(values, w * 2, frame, bounds.min ?? 0, maxB);
  const wave = brailleGraph(recent, { min: bounds.min ?? 0, max: maxB }).replace(/\u2800/g, '⣀');
  return fitVisible(colorFn(fitVisible(wave, w)), w);
}

/** Draw a rounded panel of exactly `width` columns wide and `height` content rows tall. */
export function panel(
  title: string,
  lines: string[],
  width: number,
  accent: (s: string) => string,
  borderAccent: (s: string) => string,
  height?: number,
  rightTitle?: string
): string[] {
  const h = height ?? lines.length;
  const contentWidth = Math.max(1, width - 4);
  const innerW = Math.max(0, width - 2);

  let leftLabel = '';
  if (title) {
    const keyMatch = title.match(/^([0-9A-Z])\s+(.+)$/);
    if (keyMatch) {
      leftLabel = borderAccent('─[ ') + chalk.bold.hex('#ffaa40')(keyMatch[1]) + ' ' + accent(chalk.bold(keyMatch[2])) + borderAccent(' ]─');
    } else {
      leftLabel = borderAccent('─[ ') + accent(chalk.bold(title)) + borderAccent(' ]─');
    }
  }

  let rightLabel = '';
  if (rightTitle) {
    const maxRightText = Math.max(0, innerW - visLen(leftLabel) - 6);
    if (maxRightText >= 4) {
      const clippedRight = visLen(rightTitle) > maxRightText
        ? sliceVisible(rightTitle, 0, Math.max(1, maxRightText - 1)) + '…'
        : rightTitle;
      rightLabel = borderAccent('─┫ ') + chalk.hex('#cbd5e1')(clippedRight) + borderAccent(' ┣─');
    }
  }

  const labelLen = visLen(leftLabel) + visLen(rightLabel);
  let filler = '';
  if (innerW > labelLen) {
    filler = borderAccent('─'.repeat(innerW - labelLen));
  }

  let topInner = leftLabel + filler + rightLabel;
  if (visLen(topInner) > innerW) {
    topInner = fitVisible(topInner, innerW);
  } else if (visLen(topInner) < innerW) {
    topInner = topInner + borderAccent('─'.repeat(innerW - visLen(topInner)));
  }

  const top = borderAccent('╭') + topInner + borderAccent('╮');
  const bottom = borderAccent('╰' + '─'.repeat(innerW) + '╯');
  const body: string[] = [];
  for (let i = 0; i < h; i++) {
    const line = lines[i] ?? '';
    body.push(`${borderAccent('│')} ${fitVisible(line, contentWidth)} ${borderAccent('│')}`);
  }
  return [top, ...body, bottom];
}

export function gaugeBar(percent: number, width = 12): string {
  const w = Math.max(1, width);
  const pct = Math.min(100, Math.max(0, percent));
  const totalEighths = Math.round((pct / 100) * w * 8);
  const fullBlocks = Math.floor(totalEighths / 8);
  const remainder = totalEighths % 8;
  const blocks = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  
  let str = '█'.repeat(fullBlocks);
  if (fullBlocks < w && remainder > 0) {
    str += blocks[remainder];
  }
  const empty = Math.max(0, w - visLen(str));
  
  const color = pct > 88 ? chalk.hex('#f43f5e').bold : pct > 75 ? chalk.hex('#ff6b35').bold : pct > 50 ? chalk.hex('#f59e0b') : chalk.hex('#06b6d4');
  const track = chalk.hex('#1e293b')('━'.repeat(empty));
  return color(str) + track;
}

/** Join equal-or-uneven-height panel blocks side by side with a gap. */
function hstack(blocks: string[][], gap = 2, targetWidth?: number): string[] {
  if (!blocks.length) return [];
  const height = Math.max(...blocks.map(b => b.length));
  const widths = blocks.map(b => Math.max(0, ...b.map(l => visLen(l))));
  const padded = blocks.map((b, i) => {
    const w = widths[i];
    const filler = ' '.repeat(w);
    const arr = b.map(line => fitVisible(line, w));
    while (arr.length < height) arr.push(filler);
    return arr;
  });
  const out: string[] = [];
  for (let row = 0; row < height; row++) {
    let line = padded.map(a => a[row]).join(' '.repeat(gap));
    if (targetWidth !== undefined) {
      line = fitVisible(line, targetWidth);
    }
    out.push(line);
  }
  return out;
}


function statRow(label: string, value: string, width = 9): string {
  const w = Math.max(width, label.length + 1);
  return `${chalk.hex('#64748b')(label.padEnd(w))}${chalk.bold.hex('#e2e8f0')(value)}`;
}

function bar(percent: number, width = 20): string {
  return gaugeBar(percent, width);
}

function gaugeRow(label: string, percent: number, contentWidth: number): string {
  const labelW = 9;
  const pctText = `${Math.round(percent)}%`.padStart(4);
  const barW = Math.max(6, contentWidth - labelW - pctText.length - 2);
  const meter = gaugeBar(percent, barW);
  return `${chalk.hex('#64748b')(label.padEnd(labelW))}${meter} ${chalk.bold.hex('#f8fafc')(pctText)}`;
}

export function statusSymbol(level: 'ok' | 'warn' | 'crit'): string {
  if (level === 'crit') return '✕ ';
  if (level === 'warn') return '! ';
  return '✓ ';
}

export function thermalColor(pressureLevel: number) {
  const symbol = pressureLevel >= 3 ? '✕ ' : pressureLevel >= 1 ? '! ' : '✓ ';
  if (pressureLevel >= 3) return (s: string) => chalk.red(symbol + s);
  if (pressureLevel === 2) return (s: string) => chalk.yellow(symbol + s);
  if (pressureLevel === 1) return (s: string) => chalk.yellowBright(symbol + s);
  return (s: string) => chalk.green(symbol + s);
}

export function capacityColor(percent: number) {
  const symbol = percent < 80 ? '✕ ' : percent < 90 ? '! ' : '✓ ';
  if (percent < 80) return (s: string) => chalk.red(symbol + s);
  if (percent < 90) return (s: string) => chalk.yellow(symbol + s);
  return (s: string) => chalk.green(symbol + s);
}

export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
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

/** Render a Celsius reading in the requested unit. */
export function formatTempUnit(c: number, unit: 'c' | 'f' = 'c'): string {
  if (unit === 'f') {
    return `${(c * (9 / 5) + 32).toFixed(1)}°F`;
  }
  return `${c.toFixed(1)}°C`;
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
  if (data.cpu.clusters && data.cpu.clusters.length) {
    for (const cl of data.cpu.clusters) {
      lines.push(statRow(cl.name, `${cl.frequencyMhz} MHz · eff ${cl.effectiveUsagePercent}% · act ${cl.activeResidencyPercent}%`));
    }
  }
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
     lines.push(statRow('ANE', `${(data.power.aneWatts ?? 0).toFixed(2)} W`));
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
  if (data.battery.powerWatts !== undefined && data.battery.powerWatts > 0 && data.battery.state !== 'charged') {
    lines.push(statRow('Power Draw', `${data.battery.powerWatts.toFixed(2)} W`));
  }
  if (data.battery.smartPrediction) {
    const sp = data.battery.smartPrediction;
    lines.push('');
    lines.push(chalk.bold('SMART RUNTIME FORECAST:'));
    lines.push(statRow('Light Load', `${chalk.green(sp.scenarios.idle.timeRemaining)}  (~${sp.scenarios.idle.ratePerHour}%/h)`));
    lines.push(statRow('Current Load', `${chalk.yellow(sp.scenarios.current.timeRemaining)}  (~${sp.scenarios.current.ratePerHour}%/h)`));
    lines.push(statRow('Heavy Load', `${chalk.red(sp.scenarios.heavy.timeRemaining)}  (~${sp.scenarios.heavy.ratePerHour}%/h)`));
    lines.push(chalk.dim(`Advice: ${sp.recommendation}`));
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
  const lines: string[] = [];
  lines.push(statRow('Iface', truncatePlain(`${data.network.interface} (${data.network.ip})`, valW)));
  const rxTotal = formatBytes(data.network.rxBytes);
  const txTotal = formatBytes(data.network.txBytes);
  const rxRateStr = formatBytes(data.network.rxRate);
  const txRateStr = formatBytes(data.network.txRate);
  lines.push(statRow('RX', `${rxTotal} · ${rxRateStr}/s`));
  lines.push(statRow('TX', `${txTotal} · ${txRateStr}/s`));
  
  const totalBytes = data.network.rxBytes + data.network.txBytes;
  if (totalBytes > 0) {
    const rxPct = Math.round((data.network.rxBytes / totalBytes) * 100);
    const barW = Math.max(4, contentWidth - 20);
    const rxBar = gaugeBar(rxPct, barW);
    lines.push(statRow('RX/TX', `${rxBar} ${rxPct}%`));
  }
  
  if (data.network.protocols) {
    const p = data.network.protocols;
    const totalConns = (p.tcp.connections || 0) + (p.udp.connections || 0);
    if (totalConns > 0) {
      const tcpPct = Math.round((p.tcp.connections / totalConns) * 100);
      lines.push(statRow('TCP', `${p.tcp.connections} conns · ${gaugeBar(tcpPct, Math.max(4, contentWidth - 20))} ${tcpPct}%`));
      lines.push(statRow('UDP', `${p.udp.connections} conns`));
    }
  }
  if (data.network.connectionStates) {
    const cs = data.network.connectionStates;
    const total = cs.established + cs.listening + cs.timeWait + cs.closeWait + cs.other;
    if (total > 0) {
      const estPct = Math.round((cs.established / total) * 100);
      lines.push(statRow('Active', `${cs.established} ESTABLISHED · ${estPct}%`));
      lines.push(statRow('Listen', `${cs.listening} LISTEN`));
      if (cs.timeWait > 0) lines.push(statRow('TimeWait', `${cs.timeWait}`));
      if (cs.closeWait > 0) lines.push(statRow('CloseWait', `${cs.closeWait}`));
    }
  }
  if (data.network.listeningPorts && data.network.listeningPorts.length > 0) {
    const ports = data.network.listeningPorts.slice(0, 8).join(', ');
    lines.push(statRow('Ports', truncatePlain(ports, valW)));
  }
  if (data.network.topRemoteHosts && data.network.topRemoteHosts.length > 0) {
    for (const host of data.network.topRemoteHosts.slice(0, 3)) {
      lines.push(statRow('Host', truncatePlain(`${host.host} (${host.connectionCount})`, valW)));
    }
  }
  return lines;
}

function networkDetailCard(data: StatsData, width: number, theme: ThemeColors): string[] {
  const contentWidth = width - 4;
  const lines = networkCard(data, contentWidth);
  
  if (data.packets && data.packets.allProcesses && data.packets.allProcesses.length > 0) {
    lines.push('');
    lines.push(chalk.bold.hex('#ffaa40')('◆ PROCESSES & BANDWIDTH USAGE'));
    
    const pWidth = 8;
    const rxWidth = 12;
    const txWidth = 12;
    const totalWidth = 12;
    const cmdWidth = Math.max(15, contentWidth - (pWidth + rxWidth + txWidth + totalWidth + 4 * 2));
    
    lines.push(
      chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
        ' PID'.padEnd(pWidth) + '  ' +
        'COMMAND'.padEnd(cmdWidth) + '  ' +
        'RX'.padStart(rxWidth) + '  ' +
        'TX'.padStart(txWidth) + '  ' +
        'TOTAL'.padStart(totalWidth) + ' '
      )
    );
    
    const sorted = [...data.packets.allProcesses]
      .sort((a, b) => (b.rxBytes + b.txBytes) - (a.rxBytes + a.txBytes));
      
    for (const proc of sorted) {
      if (proc.rxBytes + proc.txBytes === 0) continue;
      const rxStr = formatBytes(proc.rxBytes).padStart(rxWidth);
      const txStr = formatBytes(proc.txBytes).padStart(txWidth);
      const totalStr = formatBytes(proc.rxBytes + proc.txBytes).padStart(totalWidth);
      const cmdStr = truncatePlain(proc.command, cmdWidth).padEnd(cmdWidth);
      
      lines.push(
        chalk.hex('#06b6d4')(proc.pid.toString().padEnd(pWidth)) + '  ' +
        chalk.hex('#e2e8f0')(cmdStr) + '  ' +
        chalk.hex('#10b981')(rxStr) + '  ' +
        chalk.hex('#f59e0b')(txStr) + '  ' +
        chalk.bold.hex('#f8fafc')(totalStr)
      );
    }
  } else {
    lines.push('');
    lines.push(chalk.dim('No active network process data available.'));
  }
  
  return lines;
}

function packetCard(data: StatsData, contentWidth: number): string[] | null {
  if (!data.packets) return null;
  const lines: string[] = [];
  lines.push(statRow('Total', `${data.packets.totalPackets} pkt`));
  lines.push(statRow('RX', `${data.packets.rxPackets} pkt`));
  lines.push(statRow('TX', `${data.packets.txPackets} pkt`));
  lines.push(statRow('Conns', `${data.packets.connections} TCP`));
  if (data.packets.protocolStats) {
    const ps = data.packets.protocolStats;
    lines.push(statRow('TCP', `${ps.tcp.connections} conns`));
    lines.push(statRow('UDP', `${ps.udp.connections} conns`));
  }
  if (data.packets.connectionStates) {
    const cs = data.packets.connectionStates;
    lines.push(statRow('ESTAB', `${cs.established}`));
    lines.push(statRow('LISTEN', `${cs.listening}`));
  }
  if (data.packets.topProcesses && data.packets.topProcesses.length) {
    const topProc = data.packets.topProcesses[0];
    lines.push(statRow('Top Proc', `${truncatePlain(topProc.command, contentWidth - 25)} (${formatBytes(topProc.rxBytes + topProc.txBytes)})`));
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

function header(data: StatsData, width: number, badges: string[] = [], opts: TableOptions = {}): string[] {
  const spriteMode = opts.sprite3dMode || 'ignis';
  const now = new Date().toLocaleTimeString([], { hour12: false });
  const cleanHost = (data.header.hostname || 'localhost').replace(/\.(local|lan|home|internal)$/i, '');
  const cleanUptime = (data.header.uptime || '').replace(/\s+/g, ' ').trim();
  const brand = chalk.bgHex('#ff5500').black.bold(' PYRE ');
  const sep = chalk.hex('#334155')(' · ');
  const host = `${chalk.bold.hex('#f8fafc')(cleanHost)}${sep}${chalk.hex('#94a3b8')(data.header.os)}${sep}${chalk.hex('#64748b')('up ')}${chalk.hex('#cbd5e1')(cleanUptime)}`;
  const spriteTag = chalk.hex('#38bdf8')(`3D:${spriteMode}`);
  const right = `${badges.length ? badges.join(' ') + sep : ''}${spriteTag}${sep}${chalk.bold.hex('#e2e8f0')(now)} `;
  const maxLeftW = Math.max(12, width - visLen(right) - 2);
  const left = sliceVisible(`${brand}  ${host}`, 0, maxLeftW);
  const gap = Math.max(1, width - visLen(left) - visLen(right));
  const line = fitVisible(left + ' '.repeat(gap) + right, width);
  return [line];
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
  { id: 'packets', label: 'Conns', key: '8' },
  { id: 'tasks', label: 'Tasks', key: '9' },
  { id: 'disk', label: 'Disk', key: '0' },
  { id: 'process', label: 'Process', key: 'P' },
  { id: 'ports', label: 'Ports', key: 'L' },
  { id: 'p2p', label: 'P2P', key: 'R' },
  { id: 'anomalies', label: 'Anomalies', key: 'A' },
  { id: 'containers', label: 'Containers', key: 'C' },
  { id: 'blender', label: 'Blender', key: 'B' },
];

/** The number of leading columns of indent before the tab bar's first character (see `tabBar`). */
const TAB_BAR_INDENT = 1;
/** Visible width of the '·' separator drawn between tabs. */
const TAB_SEPARATOR_WIDTH = 1;

/**
 * Compute the column range (inclusive start, exclusive end) each tab
 * occupies when rendered by `tabBar`, so a click at a given column can be
 * mapped back to a panel id.
 */
export function getTabHitboxes(visible?: VisibleItems): { id: string; start: number; end: number }[] {
  const tabs = visible ? TAB_DEFS.filter(t => visible[t.id as keyof VisibleItems] !== false) : TAB_DEFS;
  const boxes: { id: string; start: number; end: number }[] = [];
  let col = TAB_BAR_INDENT;
  tabs.forEach((t, i) => {
    const text = ` ${t.key}:${t.label} `;
    const start = col;
    const end = col + text.length;
    boxes.push({ id: t.id, start, end });
    col = end;
    if (i < tabs.length - 1) col += TAB_SEPARATOR_WIDTH;
  });
  return boxes;
}

/** Row (1-indexed, matching terminal mouse-report coordinates) the tab bar renders on. */
export const TAB_BAR_ROW = 2;

function tabBar(activePanel: string, width: number, _theme: ThemeColors, visible?: VisibleItems): string {
  const visibleTabs = visible ? TAB_DEFS.filter(t => visible[t.id as keyof VisibleItems] !== false) : TAB_DEFS;
  const rendered = visibleTabs.map(t => {
    const isActive = activePanel === t.id;
    const text = ` ${t.key}:${t.label} `;
    if (isActive) {
      return chalk.bgHex('#ff5500').black.bold(text);
    }
    return ` ${chalk.hex('#ffaa40').bold(t.key)}${chalk.hex('#475569')(':')}${chalk.hex('#94a3b8')(t.label)} `;
  });

  const separator = chalk.hex('#334155')('·');
  const indent = ' ';
  const available = Math.max(10, width - visLen(indent));
  const joined = rendered.join(separator);

  let result = joined;
  if (visLen(joined) > available) {
    const activeIdx = Math.max(0, visibleTabs.findIndex(t => t.id === activePanel));
    let startIdx = 0;
    // Ensure activeIdx is inside the visible window
    while (startIdx < activeIdx) {
      const sliceAttempt = rendered.slice(startIdx, activeIdx + 1).join(separator);
      if (visLen(sliceAttempt) <= available - 2) break;
      startIdx++;
    }
    let used = 0;
    const kept: string[] = [];
    for (let i = startIdx; i < rendered.length; i++) {
      const tabW = visLen(rendered[i]) + (kept.length > 0 ? visLen(separator) : 0);
      if (used + tabW > available - 2 && kept.length > 0) break;
      kept.push(rendered[i]);
      used += tabW;
    }
    const prefixEllipsis = startIdx > 0 ? chalk.hex('#64748b')('‹') : '';
    const suffixEllipsis = startIdx + kept.length < rendered.length ? chalk.hex('#64748b')('›') : '';
    result = prefixEllipsis + kept.join(separator) + suffixEllipsis;
  }

  return styleSelectedRow(indent + result, width, '15;23;42');
}

// --- process / disk tables ---------------------------------------------------

export function sortProcesses<T extends { pid: number; ppid: number; user: string; cpu: number; mem: number; command: string; state: string; threads: number; runtime: number }>(
   processes: T[],
   sortBy: 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime' = 'cpu',
   reverse: boolean = false
 ): T[] {
   const copy = [...processes];
   const dir = reverse ? -1 : 1;
   switch (sortBy) {
     case 'pid': return copy.sort((a, b) => (a.pid - b.pid) * dir);
     case 'mem': return copy.sort((a, b) => (b.mem - a.mem) * dir);
     case 'user': return copy.sort((a, b) => a.user.localeCompare(b.user) * dir);
     case 'command': return copy.sort((a, b) => cleanCommandName(a.command).localeCompare(cleanCommandName(b.command)) * dir);
     case 'state': return copy.sort((a, b) => a.state.localeCompare(b.state) * dir);
     case 'threads': return copy.sort((a, b) => (b.threads - a.threads) * dir);
     case 'runtime': return copy.sort((a, b) => (b.runtime - a.runtime) * dir);
     default: return copy.sort((a, b) => (b.cpu - a.cpu) * dir);
   }
 }

function pctColor(v: number): (s: string) => string {
  return v > 80 ? chalk.hex('#f43f5e').bold : v > 40 ? chalk.hex('#f59e0b') : chalk.hex('#10b981');
}

function processTableLines(
   processes: { pid: number; ppid: number; user: string; cpu: number; mem: number; command: string; state: string; threads: number; runtime: number }[],
   contentWidth: number,
   borderAccent = THEMES.default.border,
   selectedIdx: number = -1,
   sortBy: string = 'cpu',
   sortReverse: boolean = false
 ): string[] {
   const pidW = 8, ppidW = 8, userW = 12, cpuW = 8, memW = 8, stateW = 7, thrW = 6, rtW = 10;

   const arrow = (col: string, defaultAsc = false) => {
     if (sortBy !== col) return '';
     const isAsc = defaultAsc ? !sortReverse : sortReverse;
     return isAsc ? '▲' : '▼';
   };
   const colHdr = (label: string, width: number, col?: string, defaultAsc = false) => {
     const a = col ? arrow(col, defaultAsc) : '';
     const text = `${label}${a}`.padEnd(width);
     return col && sortBy === col
       ? chalk.bold.hex('#ffaa40')(text)
       : chalk.bold.hex('#cbd5e1')(text);
   };

   const fixedColsW = pidW + ppidW + userW + cpuW + memW + stateW + thrW + rtW;
   const cmdW = Math.max(10, contentWidth - fixedColsW - 2);
   const rawHead =
     '  ' +
     colHdr('PID', pidW - 2, 'pid', true) +
     colHdr('PPID', ppidW) +
     colHdr('USER', userW, 'user', true) +
     colHdr('CPU%', cpuW, 'cpu', false) +
     colHdr('MEM%', memW, 'mem', false) +
     colHdr('STATE', stateW, 'state', true) +
     colHdr('THR', thrW, 'threads', false) +
     colHdr('RUNTIME', rtW, 'runtime', false) +
     colHdr('COMMAND', cmdW, 'command', true);
   const head = styleSelectedRow(rawHead, contentWidth, '30;41;59');

   const rows = processes.map((p, idx) => {
     const isSelected = idx === selectedIdx;
     const cursor = isSelected ? chalk.hex('#ff6b35').bold('❯ ') : '  ';
     const pidStr = chalk.hex('#38bdf8')(String(p.pid).padEnd(pidW - 2));
     const ppidStr = chalk.hex('#64748b')(String(p.ppid).padEnd(ppidW));
     const userStr = chalk.hex('#94a3b8')(truncatePlain(p.user, userW - 1).padEnd(userW));
     const cpuStr = pctColor(p.cpu)(`${p.cpu.toFixed(1)}%`.padEnd(cpuW));
     const memStr = chalk.hex('#c084fc')(`${p.mem.toFixed(1)}%`.padEnd(memW));
     const stateStr = chalk.hex('#64748b')(p.state.padEnd(stateW));
     const thrStr = chalk.hex('#64748b')(String(p.threads).padEnd(thrW));
     const rtStr = chalk.hex('#94a3b8')(formatRuntime(p.runtime).padEnd(rtW));
     const displayCmd = cleanCommandName(p.command);
     const cmdStr = (isSelected ? chalk.bold.hex('#f8fafc') : chalk.hex('#e2e8f0'))(truncatePlain(displayCmd, cmdW).padEnd(cmdW));

     const line = cursor + pidStr + ppidStr + userStr + cpuStr + memStr + stateStr + thrStr + rtStr + cmdStr;
     return isSelected ? styleSelectedRow(line, contentWidth, '30;41;59') : fitVisible(line, contentWidth);
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
      const memStr = chalk.hex('#94a3b8')(`${proc.mem.toFixed(1)}%`.padEnd(8));
      const stateStr = chalk.dim(proc.state.padEnd(8));
      const thrStr = chalk.dim(String(proc.threads).padEnd(6));

      const cmd = truncatePlain(proc.command, Math.max(10, 100 - pidStr.length - cpuStr.length - memStr.length - stateStr.length - thrStr.length - 10));
      lines.push(`${prefix}${chalk.hex('#475569')(connector)}${chalk.hex('#64748b')(pidStr)}${cpuStr}${memStr}${stateStr}${thrStr} ${chalk.hex('#f1f5f9')(cmd)}`);
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
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' FILESYSTEM          ') +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' SIZE      ') +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' USED      ') +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' AVAIL     ') +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' CAP     ') +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' MOUNT'.padEnd(mountW + 1));
  const rows = disks.map(d => {
    const capNum = parseInt(d.capacity, 10) || 0;
    const capStr = pctColor(capNum)(d.capacity.padEnd(capW));
    return (
      chalk.hex('#ec4899')('⌹ ') +
      chalk.hex('#e2e8f0')(truncatePlain(d.filesystem, fsW - 3).padEnd(fsW - 2)) +
      chalk.dim(d.size.padEnd(sizeW)) +
      chalk.hex('#94a3b8')(d.used.padEnd(usedW)) +
      chalk.dim(d.available.padEnd(availW)) +
      capStr +
      chalk.bold.hex('#f8fafc')(truncatePlain(d.mountpoint, mountW))
    );
  });
  return [head, borderAccent('─'.repeat(contentWidth)), ...rows];
}

function containersTableLines(
  containers: { id: string; name: string; cpuPercent: number; memUsage: string; memPercent: number; netIO: string; blockIO: string; pids: number }[],
  contentWidth: number,
  borderAccent = THEMES.default.border
): string[] {
   const idW = 14, cpuW = 8, memW = 8, memUsgW = 20, netW = 20, blockW = 20, pidsW = 6;
   const nameW = Math.max(10, contentWidth - idW - cpuW - memW - memUsgW - netW - blockW - pidsW - 7);
   
   const head =
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' CONTAINER ID ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' CPU%   ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' MEM%   ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' MEM USAGE          ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' NET I/O            ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' BLOCK I/O          ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' PIDS ') +
     chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(' NAME'.padEnd(nameW + 1));
     
   const rows = containers.map(c => {
     const cpuStr = pctColor(c.cpuPercent)(`${c.cpuPercent.toFixed(1)}`.padEnd(cpuW));
     const memStr = pctColor(c.memPercent)(`${c.memPercent.toFixed(1)}`.padEnd(memW));
     
     return (
       chalk.hex('#06b6d4')('⬡ ') +
       chalk.hex('#e2e8f0')(truncatePlain(c.id, idW - 3).padEnd(idW - 2)) +
       cpuStr +
       memStr +
       chalk.hex('#94a3b8')(c.memUsage.padEnd(memUsgW)) +
       chalk.hex('#10b981')(c.netIO.padEnd(netW)) +
       chalk.dim(c.blockIO.padEnd(blockW)) +
       chalk.hex('#f59e0b')(String(c.pids).padEnd(pidsW)) +
       chalk.bold.hex('#f8fafc')(truncatePlain(c.name, nameW))
     );
   });
   
   return [head, borderAccent('─'.repeat(contentWidth)), ...rows];
 }

function blenderCard(renders: BlenderRenderData[], contentWidth: number, theme: ThemeColors): string[] {
  if (!renders.length) return ['No active Blender renders detected'];
  const lines: string[] = [];
  for (const r of renders.slice(0, 8)) {
    const statusColor = r.status === 'rendering' ? chalk.green : r.status === 'finalizing' ? chalk.yellow : r.status === 'loading' ? chalk.cyan : chalk.dim;
    const pctStr = `${r.completionPercent}%`;
    const barW = Math.max(4, contentWidth - 28);
    const bar = gaugeBar(r.completionPercent, barW);
    lines.push(`${theme.blender(`PID ${r.pid}`)} ${truncatePlain(r.blendFile, 18)} ${r.renderEngine}`);
    lines.push(`  Fra ${String(r.currentFrame).padStart(4)}/${r.totalFrames}  ${bar}  ${pctStr}`);
    lines.push(`  ${r.elapsedSec}s elapsed · ${statusColor(r.status)}${r.sampleCount !== undefined ? ` · ${r.sampleCount} spp` : ''}`);
  }
  return lines;
}

// --- main dashboard ------------------------------------------------------------

function detailPanelTitle(panel: string, trackedPid?: number | null): string {
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
    process: trackedPid !== undefined && trackedPid !== null ? `Processes (Following PID ${trackedPid})` : 'Processes',
    ports: 'Listening Ports & Local Servers',
    containers: 'Containers',
    blender: 'Blender Renders',
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
      if (!power) return ['No power data available'];
      return power;
    }
    case 'battery':
      return data.battery ? batteryCard(data, contentWidth) : ['No battery data available'];
    case 'thermal':
      return thermalCard(data, contentWidth);
    case 'network':
      return networkDetailCard(data, width, theme);
    case 'packets': {
      if (!data.packets || !data.packets.allProcesses || !data.packets.allProcesses.length) {
        return ['No advanced network tracking data available.'];
      }
    
      const lines: string[] = [];
      const pWidth = 8;
      const cmdWidth = 15;
      const protoWidth = 5;
      const stateWidth = 11;
      const rxWidth = 10;
      const txWidth = 10;
      
      const remaining = Math.max(20, width - (pWidth + cmdWidth + protoWidth + stateWidth + rxWidth + txWidth + 7 * 2));
      const localWidth = Math.floor(remaining * 0.4);
      const remoteWidth = remaining - localWidth;
    
      const header = 
        chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
          ' PID'.padEnd(pWidth) + '  ' +
          'COMMAND'.padEnd(cmdWidth) + '  ' +
          'PROTO'.padEnd(protoWidth) + '  ' +
          'LOCAL'.padEnd(localWidth) + '  ' +
          'REMOTE'.padEnd(remoteWidth) + '  ' +
          'STATE'.padEnd(stateWidth) + '  ' +
          'RX'.padStart(rxWidth) + '  ' +
          'TX'.padStart(txWidth) + ' '
        );
        
      lines.push(header);
      lines.push(chalk.dim('─'.repeat(width)));
    
      for (const proc of data.packets.allProcesses) {
        if (!proc.connections || proc.connections.length === 0) continue;
        
        const summaryCmd = truncatePlain(proc.command, cmdWidth + protoWidth + localWidth + remoteWidth + stateWidth + 8);
        const summaryRx = formatBytes(proc.rxBytes).padStart(rxWidth);
        const summaryTx = formatBytes(proc.txBytes).padStart(txWidth);
        
        lines.push(
          chalk.hex('#06b6d4')(proc.pid.toString().padEnd(pWidth)) + '  ' +
          chalk.hex('#e2e8f0')(summaryCmd.padEnd(width - pWidth - rxWidth - txWidth - 6)) + '  ' +
          chalk.hex('#10b981')(summaryRx) + '  ' +
          chalk.hex('#f59e0b')(summaryTx)
        );
        
        for (const conn of proc.connections) {
          const cProto = chalk.dim(truncatePlain(conn.protocol, protoWidth).padEnd(protoWidth));
          const cLocal = chalk.dim(truncatePlain(conn.local, localWidth).padEnd(localWidth));
          const cRemote = truncatePlain(conn.remote, remoteWidth).padEnd(remoteWidth);
          
          const cStateStr = conn.state === 'Established' ? chalk.hex('#10b981')('ESTABLISHED'.padEnd(stateWidth)) : chalk.dim(truncatePlain(conn.state, stateWidth).padEnd(stateWidth));
          const cRx = chalk.dim(formatBytes(conn.rxBytes).padStart(rxWidth));
          const cTx = chalk.dim(formatBytes(conn.txBytes).padStart(txWidth));
          
          lines.push(
            ' '.repeat(pWidth) + '  ' +
            ' '.repeat(cmdWidth) + '  ' +
            cProto + '  ' +
            cLocal + '  ' +
            cRemote + '  ' +
            cStateStr + '  ' +
            cRx + '  ' +
            cTx
          );
        }
      }
    
      return lines;
    }
    case 'tasks':
      return data.tasks?.length ? tasksCard(data, contentWidth) : ['No task data available'];
    case 'disk':
      return data.disk.length ? diskTableLines(data.disk, width - 4, theme.border) : ['No disk data available'];
    case 'ports': {
      const entries = collectListeningPorts();
      return formatPortsPanelLines(entries, width - 4);
    }
    case 'process': {
      const filtered = opts.filter
        ? data.processes.filter(p => p.command.toLowerCase().includes(opts.filter!.toLowerCase()))
        : data.processes;
      const sortKey = opts.sortBy ?? 'cpu';
      const sortRev = !!opts.sortReverse;
      const sorted = sortProcesses(filtered, sortKey, sortRev);
      let selectedIdx = opts.selectedProcessIndex ?? -1;
      const isTracking = opts.trackedPid !== undefined && opts.trackedPid !== null;
      if (isTracking) {
        const trackedIdx = sorted.findIndex(p => p.pid === opts.trackedPid);
        if (trackedIdx >= 0) {
          selectedIdx = trackedIdx;
        }
      }

      // Build tracking info header lines if we're following a process
      const trackingLines: string[] = [];
      if (isTracking) {
        const tp = sorted.find(p => p.pid === opts.trackedPid);
        if (tp) {
          const cpuColor = tp.cpu > 50 ? chalk.red.bold : tp.cpu > 20 ? chalk.yellow : chalk.green;
          const memColor = tp.mem > 50 ? chalk.red.bold : tp.mem > 20 ? chalk.yellow : chalk.green;
          const cpuSpark = opts.trackedPidHistory?.cpu?.length ? ` ${chalk.cyan(sparkline(opts.trackedPidHistory.cpu, { min: 0, max: 100 }))}` : '';
          const memSpark = opts.trackedPidHistory?.mem?.length ? ` ${chalk.magenta(sparkline(opts.trackedPidHistory.mem, { min: 0, max: 100 }))}` : '';
          trackingLines.push(chalk.bgHex('#1a1a2e').hex('#e94560').bold(` ◉ FOLLOWING PID ${tp.pid} — ${truncatePlain(tp.command, Math.max(10, contentWidth - 30))} `));
          trackingLines.push(
            `  ${chalk.bold('CPU:')} ${cpuColor(tp.cpu.toFixed(1) + '%')}${cpuSpark}   ` +
            `${chalk.bold('MEM:')} ${memColor(tp.mem.toFixed(1) + '%')}${memSpark}   ` +
            `${chalk.bold('State:')} ${chalk.dim(tp.state)}   ` +
            `${chalk.bold('Threads:')} ${tp.threads}   ` +
            `${chalk.bold('Runtime:')} ${formatRuntime(tp.runtime)}   ` +
            `${chalk.bold('User:')} ${tp.user}`
          );
          trackingLines.push(chalk.dim(`  Full: ${tp.command}`));
          trackingLines.push(theme.border('─'.repeat(contentWidth)));
        } else {
          trackingLines.push(chalk.yellow(` ◉ PID ${opts.trackedPid} exited — no longer in process list`));
          trackingLines.push(theme.border('─'.repeat(contentWidth)));
        }
      }

      const availableRows = Math.max(1, (opts.processLimit || sorted.length) - trackingLines.length);
      let offset = 0;
      if (selectedIdx >= 0) {
        if (selectedIdx >= availableRows) {
          offset = selectedIdx - availableRows + 1;
        }
      }
      const visible = sorted.slice(offset, offset + availableRows);
      if (opts.treeView) {
        return [...trackingLines, ...buildProcessTree(visible)];
      }
      return [...trackingLines, ...processTableLines(visible, width - 4, theme.border, selectedIdx - offset, sortKey, sortRev)];
    }
    case 'anomalies': {
      if (!opts.anomalyHistory || opts.anomalyHistory.length === 0) return ['No anomalies detected yet.'];
      const lines: string[] = [];
      // Sort by timestamp descending
      const sorted = [...opts.anomalyHistory].sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
      for (const a of sorted.slice(0, 10)) {
        const isCrit = a.severity === 'critical';
        const badge = isCrit
          ? chalk.bgHex('#e11d48').white.bold(' CRIT ')
          : chalk.bgHex('#d97706').black.bold(' WARN ');
        const direction = a.zScore > 0 ? chalk.hex('#f43f5e')('⇡ spike') : chalk.hex('#06b6d4')('⇣ drop');
        const valStr = a.metric.toLowerCase().includes('net') ? `${formatBytes(a.value)}/s` : `${a.value.toFixed(1)}%`;
        const timeStr = a.timestamp ? a.timestamp.toLocaleTimeString() : '';
        lines.push(` ${chalk.dim(timeStr.padEnd(8))} ${badge} ${chalk.bold.hex('#f8fafc')(a.metric.padEnd(8))} ${chalk.hex('#e2e8f0')(valStr.padEnd(10))} ${direction} ${chalk.dim(`(σ=${a.zScore.toFixed(1)})`)}`);
      }
      lines.push('');
      // In-TUI AI Model Diagnosis section (offline, zero external server needed)
      const modelId = opts.aiModel || 'expert-rules-v1';
      const aiAnalysis = explainAnomaliesLocally(sorted, modelId);
      for (const al of aiAnalysis.split('\n')) {
        if (al.startsWith('Diagnosis Engine:')) {
          lines.push(chalk.bold.magenta(al));
        } else if (al.startsWith('Tip:')) {
          lines.push(chalk.cyan.bold(al));
        } else if (al.startsWith('  • Recommendation:')) {
          lines.push(chalk.green(al));
        } else if (al.startsWith('  • Cause:')) {
          lines.push(chalk.yellow(al));
        } else if (al.startsWith('  • Verdict:')) {
          lines.push(chalk.dim(al));
        } else {
          lines.push(chalk.dim(al));
        }
      }
      return lines;
    }
    case 'containers': {
      return data.containers && data.containers.length ? containersTableLines(data.containers, width - 4, theme.border) : ['No container data available'];
    }
    case 'blender': {
      const renders = data.blenderRenders && data.blenderRenders.length ? data.blenderRenders : [];
      return blenderCard(renders, contentWidth, theme);
    }
    default:
      return null;
  }
}

function anomalyPanel(anomalies: AnomalyAlert[], width: number, theme: ThemeColors): string[] {
  const lines: string[] = [];
  for (const a of anomalies) {
    const isCrit = a.severity === 'critical';
    const badge = isCrit
      ? chalk.bgHex('#e11d48').white.bold(' CRIT ')
      : chalk.bgHex('#d97706').black.bold(' WARN ');
    const direction = a.zScore > 0 ? '⇡ spike' : '⇣ drop';
    const valStr = a.metric.toLowerCase().includes('net') ? `${formatBytes(a.value)}/s` : `${a.value.toFixed(1)}%`;
    lines.push(` ${badge} ${chalk.bold.hex('#f8fafc')(a.metric)}: ${valStr} (${direction}, σ=${a.zScore.toFixed(1)})`);
  }
  return lines;
}

function btopCpuBox(data: StatsData, width: number, theme: ThemeColors, opts: TableOptions, maxCoreRows = 2): string[] {
  const contentWidth = width - 4;
  const frame = opts.animFrame ?? 14;
  const spriteMode: Sprite3DMode = opts.sprite3dMode || 'ignis';
  const tempUnit = opts.tempUnit || 'c';
  const tempVal = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die;
  const tempPill = tempVal != null ? ` · ${formatTempUnit(tempVal, tempUnit)}` : '';
  const freqStr = data.cpu.frequency > 0 ? `${(data.cpu.frequency / 1000).toFixed(2)}GHz` : '';
  const rightTitle = `${truncatePlain(data.cpu.brand, 26)} · ${data.cpu.physicalCores}C/${data.cpu.cores}T${freqStr ? ' · ' + freqStr : ''}${tempPill}`;

  if (contentWidth >= 60) {
    const spriteW = 16;
    const rightW = Math.max(32, Math.min(44, Math.floor(contentWidth * 0.44)));
    const waveW = Math.max(12, contentWidth - spriteW - rightW - 6); // two " │ " dividers = 6 cols

    const rightLines: string[] = [];

    // Row 1: Main CPU Gauge + Usage% + Temp
    const tempBadge = tempVal != null
      ? ' ' + (tempVal >= 85 ? chalk.hex('#f43f5e').bold : tempVal >= 70 ? chalk.hex('#f59e0b') : chalk.hex('#10b981'))(formatTempUnit(tempVal, tempUnit))
      : '';
    const tempBadgeLen = visLen(tempBadge);
    const cpuBarW = Math.max(5, rightW - 10 - tempBadgeLen);
    const cpuPctStr = `${data.cpu.usage.toFixed(0)}%`.padStart(4);
    rightLines.push(
      fitVisible(
        chalk.bold.hex('#ff6b35')('CPU ') +
        gaugeBar(data.cpu.usage, cpuBarW) +
        ' ' +
        chalk.bold.hex('#f8fafc')(cpuPctStr) +
        tempBadge,
        rightW
      )
    );

    // Rows 2..N: Per-Core Grid (strictly 2 columns per row so cores never crowd or overflow)
    if (data.cpu.coreUsage && data.cpu.coreUsage.length > 0 && maxCoreRows > 0) {
      const cores = data.cpu.coreUsage;
      const colsPerRow = 2;
      const totalRowsNeeded = Math.ceil(cores.length / colsPerRow);
      const rowsToRender = Math.min(maxCoreRows + 1, totalRowsNeeded);
      const colGap = 2;
      const colW = Math.floor((rightW - colGap) / colsPerRow);

      for (let r = 0; r < rowsToRender; r++) {
        const cells: string[] = [];
        for (let c = 0; c < colsPerRow; c++) {
          const coreIdx = r + c * rowsToRender;
          if (coreIdx < cores.length) {
            const u = cores[coreIdx];
            const lbl = `C${coreIdx}`.padEnd(coreIdx >= 10 ? 3 : 2);
            const pctTxt = `${Math.round(u)}%`.padStart(4);
            const barW = Math.max(3, colW - lbl.length - pctTxt.length - 2);
            cells.push(fitVisible(`${chalk.hex('#64748b')(lbl)} ${gaugeBar(u, barW)} ${chalk.hex('#cbd5e1')(pctTxt)}`, colW));
          } else {
            cells.push(' '.repeat(colW));
          }
        }
        rightLines.push(fitVisible(cells.join(' '.repeat(colGap)), rightW));
      }
    }

    // GPU + Load row(s)
    if (data.gpu) {
      const gpuMemStr = data.gpu.memory > 0 ? ` ${chalk.hex('#64748b')(formatBytes(data.gpu.memory).replace(/\s+/g, ''))}` : '';
      const gpuBarW = Math.max(4, rightW - 10 - visLen(gpuMemStr));
      rightLines.push(
        fitVisible(
          chalk.bold.hex('#f43f5e')('GPU ') +
          gaugeBar(data.gpu.utilization, gpuBarW) +
          ' ' +
          chalk.bold.hex('#f8fafc')(`${data.gpu.utilization}%`.padStart(4)) +
          gpuMemStr,
          rightW
        )
      );
    }

    const loads = data.cpu.loadAvg;
    const loadLine = `${chalk.hex('#64748b')('Load  ')}${chalk.bold.hex('#e2e8f0')(loads[0].toFixed(2))}  ${chalk.hex('#94a3b8')(loads[1].toFixed(2))}  ${chalk.hex('#64748b')(loads[2].toFixed(2))}`;
    rightLines.push(fitVisible(loadLine, rightW));

    const totalRows = Math.max(5, rightLines.length);
    while (rightLines.length < totalRows) {
      rightLines.push(' '.repeat(rightW));
    }

    // Zone 1 (Left): Clean 3D Sprite Viewport (full height of CPU box)
    const spriteLines = render3DSprite(spriteMode, spriteW, totalRows, frame, {
      cpuUsage: data.cpu.usage,
      memUsage: data.memory.usagePercent,
      tempC: tempVal ?? undefined,
      anomalyCount: opts.anomalies?.length ?? 0,
    });

    // Zone 2 (Middle): Clean Oscilloscope Chart
    const waveLines: string[] = [];
    const rawHistory = opts.history?.cpuUsage?.length ? opts.history.cpuUsage : [data.cpu.usage];
    const avg = Math.round(rawHistory.reduce((a, b) => a + b, 0) / rawHistory.length);
    const max = Math.round(Math.max(...rawHistory));
    const histLeft = `${chalk.bold.hex('#ff6b35')('CPU')} ${chalk.bold.hex('#f8fafc')(`${data.cpu.usage.toFixed(0)}%`)}`;
    const histRight = chalk.hex('#64748b')(`μ${avg}% ⇡${max}%`);
    const histGap = Math.max(1, waveW - visLen(histLeft) - visLen(histRight));
    waveLines.push(fitVisible(histLeft + ' '.repeat(histGap) + histRight, waveW));

    const chartRows = renderOscilloscopeChart(rawHistory, waveW, totalRows - 1, theme.cpu, { min: 0, max: 100 }, frame);
    waveLines.push(...chartRows);

    const divider = Array.from({ length: totalRows }, () => theme.border('│'));
    const combinedBody = hstack([spriteLines, divider, waveLines, divider, rightLines], 1, contentWidth);
    return panel('1 cpu', combinedBody, width, theme.cpu, theme.border, combinedBody.length, rightTitle);
  } else {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#f8fafc')(truncatePlain(data.cpu.brand, contentWidth)));
    lines.push(`${chalk.bold.hex('#ff6b35')('CPU ')}${gaugeBar(data.cpu.usage, Math.max(4, contentWidth - 10))} ${chalk.bold.hex('#f8fafc')(`${data.cpu.usage.toFixed(0)}%`.padStart(4))}`);
    const rawHistory = opts.history?.cpuUsage?.length ? opts.history.cpuUsage : [data.cpu.usage];
    lines.push(renderInlineWave(rawHistory, contentWidth, theme.cpu, opts.graphMode || 'spark', { min: 0, max: 100 }, frame));
    lines.push(`${chalk.hex('#64748b')('Load: ')}${chalk.bold.hex('#cbd5e1')(data.cpu.loadAvg.map(l => l.toFixed(2)).join('  '))}`);
    return panel('1 cpu', lines, width, theme.cpu, theme.border, lines.length, rightTitle);
  }
}

function btopLeftColumn(data: StatsData, width: number, theme: ThemeColors, opts: TableOptions, targetHeight?: number): string[] {
  const contentWidth = Math.max(16, width - 4);
  const frame = opts.animFrame ?? 14;
  const out: string[] = [];
  const rawLayout = opts.panelLayout || ['mem', 'disk', 'net'];
  const visible = opts.visible || {};
  const layout = rawLayout.filter(name => {
    const key = name === 'net' ? 'network' : name;
    return visible[key as keyof VisibleItems] !== false;
  });

  // Helper for aligned 4-column metric rows: Label | Bar | Pct% | Value
  const metricRow = (label: string, labelColor: (s: string) => string, pct: number, valStr: string) => {
    const lblW = 5;
    const pctW = 4;
    const valW = 8;
    const barW = Math.max(4, contentWidth - lblW - pctW - valW - 3);
    const barStr = gaugeBar(pct, barW);
    const pctTxt = `${Math.round(pct)}%`.padStart(pctW);
    return fitVisible(
      `${labelColor(label.padEnd(lblW))} ${barStr} ${chalk.bold.hex('#f8fafc')(pctTxt)} ${chalk.hex('#cbd5e1')(truncatePlain(valStr, valW).padStart(valW))}`,
      contentWidth
    );
  };

  const hasMem = layout.includes('mem');
  const hasDisk = layout.includes('disk') && data.disk.length > 0;
  const hasNet = layout.includes('net');
  const swapRowCount = data.memory.swapTotal > 0 ? 1 : 0;
  const baseMemH = hasMem ? 2 + 3 + swapRowCount : 0;
  const maxDiskRows = Math.min(data.disk.length, 3);
  const baseDiskH = hasDisk ? 2 + maxDiskRows : 0;
  const baseNetH = hasNet ? 2 + 4 : 0;
  const baseTotal = baseMemH + baseDiskH + baseNetH;
  const totalExtra = targetHeight && targetHeight > baseTotal ? targetHeight - baseTotal : 0;

  // Give at most 2 extra rows to net (so RX and TX waves are at most 2 rows tall each),
  // and if there are >= 5 rows remaining after that, render a clean [ 4 vitals ] card below!
  const netExtra = hasNet ? Math.min(2, totalExtra) : 0;
  const remainingExtra = Math.max(0, totalExtra - netExtra);
  const showVitalsCard = remainingExtra >= 5;
  const vitalsCardTotalH = showVitalsCard ? remainingExtra : 0;
  const lastPanelPad = showVitalsCard ? 0 : remainingExtra;

  for (let idx = 0; idx < layout.length; idx++) {
    const panelName = layout[idx];
    const isLastPanel = idx === layout.length - 1;

    if (panelName === 'mem') {
      const memLines: string[] = [];
      const cachedBytes = Math.max(0, data.memory.total - data.memory.free - data.memory.used);
      const freePct = data.memory.total > 0 ? Math.round((data.memory.free / data.memory.total) * 100) : 0;
      const cachePct = data.memory.total > 0 ? Math.round((cachedBytes / data.memory.total) * 100) : 0;

      memLines.push(metricRow('Used', chalk.bold.hex('#a78bfa'), data.memory.usagePercent, formatBytes(data.memory.used)));
      memLines.push(metricRow('Free', chalk.hex('#10b981'), freePct, formatBytes(data.memory.free)));
      memLines.push(metricRow('Cache', chalk.hex('#38bdf8'), cachePct, formatBytes(cachedBytes)));
      if (data.memory.swapTotal > 0) {
        const swapPct = Math.round((data.memory.swapUsed / data.memory.swapTotal) * 100);
        memLines.push(metricRow('Swap', chalk.hex('#c084fc'), swapPct, formatBytes(data.memory.swapUsed)));
      }
      const panelH = memLines.length + (isLastPanel ? lastPanelPad : 0);
      const memRightTitle = `${formatBytes(data.memory.used).replace(/\s+/g, '')}/${formatBytes(data.memory.total).replace(/\s+/g, '')}`;
      out.push(...panel('2 mem', memLines, width, theme.mem, theme.border, panelH, memRightTitle));
    } else if (panelName === 'disk' && data.disk.length) {
      const diskLines: string[] = [];
      const compactSize = (s: unknown) => String(s ?? '').replace(/([KMGTPE])i$/i, '$1');
      for (const d of data.disk.slice(0, maxDiskRows)) {
        const capNum = parseInt(d.capacity, 10) || 0;
        const cleanMount = d.mountpoint.replace(/^\/Volumes\//, '/Vol/').replace(/^\/System\/Volumes\//, '/Sys/');
        const lblW = Math.min(11, Math.max(6, Math.floor(contentWidth * 0.28)));
        const mountShort = truncatePlain(cleanMount, lblW).padEnd(lblW);
        const usageTag = `${compactSize(d.used)}/${compactSize(d.size)}`;
        const valW = 9;
        const pctW = 4;
        const barW = Math.max(3, contentWidth - lblW - pctW - valW - 3);
        const capBar = gaugeBar(capNum, barW);
        diskLines.push(
          fitVisible(
            `${chalk.bold.hex('#f1f5f9')(mountShort)} ${capBar} ${chalk.bold.hex('#f8fafc')(d.capacity.padStart(pctW))} ${chalk.hex('#94a3b8')(truncatePlain(usageTag, valW).padStart(valW))}`,
            contentWidth
          )
        );
      }
      const totalRead = data.disk.reduce((acc, d) => acc + (d.readBytesSec || 0), 0);
      const totalWrite = data.disk.reduce((acc, d) => acc + (d.writeBytesSec || 0), 0);
      const diskHeaderRight = `▲${formatBytes(totalRead).replace(/\s+/g, '')}/s ▼${formatBytes(totalWrite).replace(/\s+/g, '')}/s`;
      const panelH = diskLines.length + (isLastPanel ? lastPanelPad : 0);
      out.push(...panel('0 disk', diskLines, width, theme.disk, theme.border, panelH, diskHeaderRight));
    } else if (panelName === 'net') {
      const netLines: string[] = [];
      const rxRate = opts.history?.netRxRate.length ? opts.history.netRxRate[opts.history.netRxRate.length - 1] : data.network.rxRate || 0;
      const txRate = opts.history?.netTxRate.length ? opts.history.netTxRate[opts.history.netTxRate.length - 1] : data.network.txRate || 0;
      const rxSeries = opts.history?.netRxRate?.length ? opts.history.netRxRate : [Math.max(12, rxRate)];
      const txSeries = opts.history?.netTxRate?.length ? opts.history.netTxRate : [Math.max(8, txRate)];

      const rxLeft = `${chalk.hex('#06b6d4').bold('▼ RX ')}${chalk.bold.hex('#f8fafc')(`${formatBytes(rxRate)}/s`)}`;
      const rxRight = chalk.hex('#64748b')(`tot ${formatBytes(data.network.rxBytes)}`);
      const rxGap = Math.max(1, contentWidth - visLen(rxLeft) - visLen(rxRight));
      netLines.push(fitVisible(rxLeft + ' '.repeat(rxGap) + rxRight, contentWidth));

      const rxWaveH = 1 + Math.floor(netExtra / 2);
      const txWaveH = 1 + (netExtra - Math.floor(netExtra / 2));

      if (rxWaveH > 1) {
        netLines.push(...renderOscilloscopeChart(rxSeries, contentWidth, rxWaveH, chalk.hex('#06b6d4'), {}, frame));
      } else {
        netLines.push(renderInlineWave(rxSeries, contentWidth, chalk.hex('#06b6d4'), opts.graphMode || 'spark', {}, frame));
      }

      const txLeft = `${chalk.hex('#3b82f6').bold('▲ TX ')}${chalk.bold.hex('#f8fafc')(`${formatBytes(txRate)}/s`)}`;
      const txRight = chalk.hex('#64748b')(`tot ${formatBytes(data.network.txBytes)}`);
      const txGap = Math.max(1, contentWidth - visLen(txLeft) - visLen(txRight));
      netLines.push(fitVisible(txLeft + ' '.repeat(txGap) + txRight, contentWidth));

      if (txWaveH > 1) {
        netLines.push(...renderOscilloscopeChart(txSeries, contentWidth, txWaveH, theme.network, {}, frame + 5));
      } else {
        netLines.push(renderInlineWave(txSeries, contentWidth, theme.network, opts.graphMode || 'spark', {}, frame + 5));
      }

      const panelH = netLines.length + (isLastPanel ? lastPanelPad : 0);
      const netRightTitle = data.network.ip && data.network.ip !== '0.0.0.0'
        ? `${data.network.interface} · ${data.network.ip}`
        : `${data.network.interface}`;
      out.push(...panel('7 net', netLines, width, theme.network, theme.border, panelH, netRightTitle));
    }
  }

  if (showVitalsCard) {
    const vitalsBodyH = Math.max(1, vitalsCardTotalH - 2);
    const vitalsLines: string[] = [];
    const tempVal = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die;
    const tempStr = tempVal != null ? formatTempUnit(tempVal, opts.tempUnit || 'c') : 'Nominal';
    const wattsVal = data.power?.combinedWatts ?? data.power?.cpuWatts;
    const pwrStr = typeof wattsVal === 'number' ? `${wattsVal.toFixed(1)} W` : 'AC / Auto';
    const batStr = data.battery ? `${data.battery.percent}% (${data.battery.isCharging ? 'Charging' : 'Battery'})` : 'AC Power';
    const procCount = data.processes?.length ?? 0;

    const kvRow = (k: string, v: string, vColor = chalk.hex('#e2e8f0')) => {
      const left = chalk.hex('#64748b')(k);
      const right = vColor(v);
      const gap = Math.max(1, contentWidth - visLen(left) - visLen(right));
      return fitVisible(left + ' '.repeat(gap) + right, contentWidth);
    };

    vitalsLines.push(kvRow('Thermal', `${tempStr} (${data.thermal.state || 'nominal'})`, chalk.hex('#10b981')));
    vitalsLines.push(kvRow('Power', pwrStr, chalk.hex('#fbbf24')));
    vitalsLines.push(kvRow('Source', batStr, chalk.hex('#38bdf8')));
    vitalsLines.push(kvRow('Processes', `${procCount} active`, chalk.hex('#cbd5e1')));
    if (data.gpu) {
      vitalsLines.push(kvRow('GPU Engine', `${data.gpu.model || 'Integrated'} (${data.gpu.utilization}%)`, chalk.hex('#f43f5e')));
    }
    out.push(...panel('4 vitals', vitalsLines.slice(0, vitalsBodyH), width, theme.power, theme.border, vitalsBodyH));
  }

  return out;
}

function btopProcBox(data: StatsData, width: number, targetHeight: number, theme: ThemeColors, opts: TableOptions): string[] {
  const contentWidth = Math.max(20, width - 4);
  const filtered = opts.filter
    ? data.processes.filter(p => p.command.toLowerCase().includes(opts.filter!.toLowerCase()))
    : data.processes;
  const sortKey = opts.sortBy ?? 'cpu';
  const sortRev = !!opts.sortReverse;
  const sorted = sortProcesses(filtered, sortKey, sortRev);

  const headerRowOverhead = 2; // top & bottom border
  const tableHeaderOverhead = 2; // header + separator line

  const isTracking = opts.trackedPid !== undefined && opts.trackedPid !== null;

  // Build compact tracking info lines
  const trackingLines: string[] = [];
  if (isTracking) {
    const tp = sorted.find(p => p.pid === opts.trackedPid);
    if (tp) {
      const cpuColor = tp.cpu > 50 ? chalk.red.bold : tp.cpu > 20 ? chalk.yellow : chalk.green;
      const memColor = tp.mem > 50 ? chalk.red.bold : tp.mem > 20 ? chalk.yellow : chalk.green;
      const cpuSpark = opts.trackedPidHistory?.cpu?.length ? ` ${chalk.cyan(sparkline(opts.trackedPidHistory.cpu, { min: 0, max: 100 }))}` : '';
      const memSpark = opts.trackedPidHistory?.mem?.length ? ` ${chalk.magenta(sparkline(opts.trackedPidHistory.mem, { min: 0, max: 100 }))}` : '';
      trackingLines.push(styleSelectedRow(` ${chalk.hex('#ff6b35').bold('◉ FOLLOWING')} ${chalk.bold.hex('#f8fafc')(`PID ${tp.pid}`)} · ${chalk.hex('#cbd5e1')(truncatePlain(cleanCommandName(tp.command), Math.max(6, contentWidth - 26)))}`, contentWidth, '30;27;75'));
      trackingLines.push(
        fitVisible(
          ` ${cpuColor('CPU ' + tp.cpu.toFixed(1) + '%')}${cpuSpark}  ` +
          `${memColor('MEM ' + tp.mem.toFixed(1) + '%')}${memSpark}  ` +
          `${chalk.hex('#94a3b8')('THR:' + tp.threads)}  ` +
          `${chalk.hex('#64748b')(formatRuntime(tp.runtime))}`,
          contentWidth
        )
      );
      trackingLines.push(theme.border('─'.repeat(contentWidth)));
    } else {
      trackingLines.push(chalk.yellow(` ◉ PID ${opts.trackedPid} exited`));
      trackingLines.push(theme.border('─'.repeat(contentWidth)));
    }
  }

  const totalBodyRows = Math.max(4, targetHeight - headerRowOverhead);
  const availableRows = Math.max(1, totalBodyRows - tableHeaderOverhead - trackingLines.length);

  let selectedIdx = opts.selectedProcessIndex ?? 0;
  if (isTracking) {
    const trackedIdx = sorted.findIndex(p => p.pid === opts.trackedPid);
    if (trackedIdx >= 0) {
      selectedIdx = trackedIdx;
    }
  }
  if (selectedIdx >= sorted.length) selectedIdx = Math.max(0, sorted.length - 1);

  let offset = 0;
  if (selectedIdx >= 0 && selectedIdx >= availableRows) {
    offset = selectedIdx - availableRows + 1;
  }
  const visible = sorted.slice(offset, offset + availableRows);

  const showThreadsCol = contentWidth >= 52;
  const pidW = 7, userW = 9, thrW = showThreadsCol ? 4 : 0, memW = 6, cpuW = 6;
  const gaps = showThreadsCol ? 5 : 4;
  const fixedW = pidW + userW + thrW + memW + cpuW + gaps;
  const cmdW = Math.max(8, contentWidth - fixedW);

  const arrow = (col: string, defaultAsc = false) => {
    if (sortKey !== col) return '';
    const isAsc = defaultAsc ? !sortRev : sortRev;
    return isAsc ? '▲' : '▼';
  };

  const rawHead =
    chalk.bold.hex(sortKey === 'pid' ? '#ffaa40' : '#cbd5e1')((`  PID${arrow('pid', true)}`).padEnd(pidW)) + ' ' +
    chalk.bold.hex(sortKey === 'command' ? '#ffaa40' : '#cbd5e1')((`PROGRAM${arrow('command', true)}`).padEnd(cmdW)) + ' ' +
    chalk.bold.hex(sortKey === 'user' ? '#ffaa40' : '#cbd5e1')((`USER${arrow('user', true)}`).padEnd(userW)) +
    (showThreadsCol ? ' ' + chalk.bold.hex(sortKey === 'threads' ? '#ffaa40' : '#cbd5e1')((`THR${arrow('threads')}`).padStart(thrW)) : '') + ' ' +
    chalk.bold.hex(sortKey === 'mem' ? '#ffaa40' : '#cbd5e1')((`MEM%${arrow('mem')}`).padStart(memW)) + ' ' +
    chalk.bold.hex(sortKey === 'cpu' ? '#ffaa40' : '#cbd5e1')((`CPU%${arrow('cpu')}`).padStart(cpuW));
  const head = styleSelectedRow(rawHead, contentWidth, '30;41;59');

  const sortArrowLabel = (() => {
    const defaultAsc = ['pid', 'user', 'command', 'state'].includes(sortKey);
    const isAsc = defaultAsc ? !sortRev : sortRev;
    return `${sortKey}${isAsc ? '▲' : '▼'}`;
  })();

  if (opts.treeView) {
    const treeLines = buildProcessTree(visible);
    let rightTitle = opts.filter ? `filter: "${opts.filter}"` : `tree · ${sortArrowLabel} · ${sorted.length}`;
    if (isTracking) rightTitle += ` · PID ${opts.trackedPid}`;
    return panel('P proc', [...trackingLines, head, theme.border('─'.repeat(contentWidth)), ...treeLines], width, theme.process, theme.border, totalBodyRows, rightTitle);
  }

  const rows = visible.map((p, idx) => {
    const isSelected = (offset + idx) === selectedIdx;
    const cpuVal = p.cpu.toFixed(1) + '%';
    const cpuStr = p.cpu >= 50
      ? chalk.hex('#f43f5e').bold(cpuVal.padStart(cpuW))
      : p.cpu >= 15
        ? chalk.hex('#f59e0b')(cpuVal.padStart(cpuW))
        : p.cpu >= 0.1
          ? chalk.hex('#10b981')(cpuVal.padStart(cpuW))
          : chalk.hex('#475569')(cpuVal.padStart(cpuW));
    const memVal = (p.mem.toFixed(1) + '%').padStart(memW);
    const memStr = p.mem >= 20
      ? chalk.hex('#f43f5e').bold(memVal)
      : p.mem >= 0.1
        ? chalk.hex('#c084fc')(memVal)
        : chalk.hex('#475569')(memVal);
    const userStr = chalk.hex('#64748b')(truncatePlain(p.user, userW).padEnd(userW));
    const thrPart = showThreadsCol ? ' ' + chalk.hex('#475569')(String(p.threads).padStart(thrW)) : '';
    const pidStr = chalk.hex('#38bdf8')(String(p.pid).padEnd(pidW - 2));
    const cleanCmd = cleanCommandName(p.command);
    const cmdStr = (isSelected ? chalk.bold.hex('#f8fafc') : chalk.hex('#e2e8f0'))(truncatePlain(cleanCmd, cmdW).padEnd(cmdW));

    const cursor = isSelected ? chalk.hex('#ff6b35').bold('▸ ') : '  ';
    const line = `${cursor}${pidStr} ${cmdStr} ${userStr}${thrPart} ${memStr} ${cpuStr}`;
    return isSelected ? styleSelectedRow(line, contentWidth, '30;41;59') : fitVisible(line, contentWidth);
  });

  const lines = [...trackingLines, head, theme.border('─'.repeat(contentWidth)), ...rows];
  if (rows.length === 0) {
    lines.push(chalk.dim(opts.filter ? `  No processes match "${opts.filter}"` : '  No active processes available'));
  }

  let rightTitle = opts.filter ? `filter: "${opts.filter}" (${sorted.length})` : `sort: ${sortArrowLabel} · ${sorted.length} procs`;
  if (isTracking) {
    rightTitle += ` · PID ${opts.trackedPid}`;
  }
  return panel('P proc', lines, width, theme.process, theme.border, totalBodyRows, rightTitle);
}

export function formatTable(data: StatsData, opts: TableOptions = {}): string {
  const width = clampWidth(opts.width);
  let activePanel = opts.activePanel || 'grid';
  const visible = opts.visible || {};

  if (activePanel !== 'grid' && visible[activePanel as keyof VisibleItems] === false) {
    activePanel = 'grid';
  }

  const themeName = opts.theme || 'default';
  const theme = THEMES[themeName] || THEMES.default;

  const out: string[] = [];
  out.push(...header(data, width, [], opts));
  out.push(tabBar(activePanel, width, theme, opts.visible));

  const anomalies = opts.anomalies ?? [];
  if (anomalies.length && activePanel === 'grid') {
    out.push(...anomalyPanel(anomalies.slice(0, 2), width, theme));
  }

  if (opts.minimal) {
    const contentWidth = width - 4;
    const lines: string[] = [];
    lines.push(gaugeRow('CPU', data.cpu.usage, contentWidth));
    lines.push(gaugeRow('Memory', data.memory.usagePercent, contentWidth));
    if (data.gpu) {
      lines.push(gaugeRow('GPU', data.gpu.utilization, contentWidth));
    }
    const tempC = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die;
    if (tempC != null) {
      const tempStr = formatTempUnit(tempC, opts.tempUnit);
      lines.push(statRow('Temp', thermalColor(data.thermal.pressureLevel)(tempStr)));
    }
    out.push(...panel('macmon mode', lines, width, theme.cpu, theme.border));
    return out.join('\n');
  }

  if (activePanel !== 'grid') {
    const lines = activeDetailLines(data, activePanel, width, opts);
    if (lines) {
      const detailH = opts.height ? Math.max(6, opts.height - out.length - 2) : lines.length;
      out.push(...panel(detailPanelTitle(activePanel, opts.trackedPid), lines, width, theme[activePanel as keyof ThemeColors] ?? theme.cpu, theme.border, detailH));
    }
  } else {
    // --- btop Dashboard Grid ---
    const totalAvailH = opts.height ? Math.max(18, opts.height) : 26;
    const maxCoreRows = totalAvailH >= 32 ? 3 : totalAvailH >= 24 ? 2 : 1;

    // 1. Top CPU & System Overview Box
    const cpuBoxLines = btopCpuBox(data, width, theme, opts, maxCoreRows);
    out.push(...cpuBoxLines);

    // 2. Bottom Split Section
    const remainingH = Math.max(12, totalAvailH - out.length);
    if (width >= 76) {
      const gap = width >= 96 ? 2 : 1;
      const leftColW = Math.max(30, Math.floor(width * 0.40));
      const rightColW = width - leftColW - gap;

      const leftLines = btopLeftColumn(data, leftColW, theme, opts, remainingH);
      const bottomH = Math.max(leftLines.length, remainingH);
      const procLines = btopProcBox(data, rightColW, bottomH, theme, opts);

      out.push(...hstack([leftLines, procLines], gap, width));
    } else {
      const leftLines = btopLeftColumn(data, width, theme, opts);
      out.push(...leftLines);
      const procLines = btopProcBox(data, width, 10, theme, opts);
      out.push(...procLines);
    }
  }

  return out.join('\n');
}


/** Clamp/normalize a terminal width to a sane range, defaulting to 80 cols. */
export function clampWidth(width?: number): number {
  if (!width || Number.isNaN(width)) return 80;
  return Math.max(40, Math.min(width, 240));
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
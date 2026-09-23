/**
 * pyre replay — CSV log file playback TUI.
 *
 * Reads a pyre CSV log file (from pyre live --log) and plays it back
 * in a lightweight read-only TUI.
 *
 * Controls: Space/p=pause  ]/[=speed  arrow keys=step  q=quit
 */
import fs from 'node:fs';
import readline from 'node:readline';
import chalk from 'chalk';

export interface ReplayOptions {
  file: string;
  speed?: number;
  plain?: boolean;
}

interface LogRow {
  timestamp: string;
  cpuUsage: number;
  memUsage: number;
  tempC?: number;
  rxBytes?: number;
  txBytes?: number;
  rxPackets?: number;
  txPackets?: number;
  connections?: number;
  thermalState?: string;
}

function parseLogFile(filePath: string): LogRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const rows: LogRow[] = [];
  for (const line of content.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const cpuUsage = parseFloat(parts[1]);
    const memUsage = parseFloat(parts[2]);
    if (isNaN(cpuUsage) || isNaN(memUsage)) continue;
    rows.push({
      timestamp: parts[0]?.trim() ?? '',
      cpuUsage,
      memUsage,
      tempC: parts[3] ? parseFloat(parts[3]) || undefined : undefined,
      rxBytes: parts[4] ? parseFloat(parts[4]) || undefined : undefined,
      txBytes: parts[5] ? parseFloat(parts[5]) || undefined : undefined,
      rxPackets: parts[6] ? parseFloat(parts[6]) || undefined : undefined,
      txPackets: parts[7] ? parseFloat(parts[7]) || undefined : undefined,
      connections: parts[8] ? parseInt(parts[8], 10) || undefined : undefined,
      thermalState: parts[9]?.trim() || undefined,
    });
  }
  return rows;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function bar(pct: number, width = 20): string {
  const filled = Math.max(0, Math.min(Math.round((pct / 100) * width), width));
  const color = pct >= 90 ? chalk.red : pct >= 70 ? chalk.yellow : chalk.green;
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled));
}

function renderFrame(row: LogRow, idx: number, total: number, speed: number, paused: boolean, cols: number): string[] {
  const lines: string[] = [];
  const divider = chalk.dim('─'.repeat(Math.min(cols - 2, 78)));

  lines.push('');
  lines.push(chalk.bold.hex('#ff5500')('  🔥 pyre replay') + '  ' + chalk.dim(row.timestamp || ''));
  lines.push('  ' + divider);
  lines.push('');
  lines.push(`  CPU        ${bar(row.cpuUsage)} ${String(row.cpuUsage.toFixed(1)).padStart(5)}%`);
  lines.push(`  Memory     ${bar(row.memUsage)} ${String(row.memUsage.toFixed(1)).padStart(5)}%`);

  if (row.tempC !== undefined && !isNaN(row.tempC)) {
    const tc = row.tempC >= 90 ? chalk.red : row.tempC >= 70 ? chalk.yellow : chalk.cyan;
    lines.push(`  Temp       ${tc(`${row.tempC.toFixed(1)}°C`)}`);
  }
  if (row.rxBytes !== undefined || row.txBytes !== undefined) {
    const rx = row.rxBytes !== undefined ? fmtBytes(row.rxBytes) : 'N/A';
    const tx = row.txBytes !== undefined ? fmtBytes(row.txBytes) : 'N/A';
    lines.push(`  Network    ↓ ${chalk.green(rx)}  ↑ ${chalk.blue(tx)}`);
  }
  if (row.connections !== undefined) {
    lines.push(`  Conns      ${chalk.cyan(String(row.connections))}`);
  }
  if (row.thermalState && row.thermalState !== 'Nominal') {
    const sc = row.thermalState === 'Critical' ? chalk.red : chalk.yellow;
    lines.push(`  Thermal    ${sc(row.thermalState)}`);
  }

  lines.push('');
  lines.push('  ' + divider);

  // Scrub bar
  const progWidth = 30;
  const progress = total > 1 ? Math.round((idx / (total - 1)) * progWidth) : 0;
  const progressBar = chalk.cyan('█'.repeat(progress)) + chalk.dim('░'.repeat(progWidth - progress));
  const icon = paused ? chalk.yellow('⏸') : chalk.green('▶');
  const spStr = speed === 1 ? '1×' : `${speed}×`;
  lines.push(`  ${icon} ${progressBar}  ${chalk.bold(`${idx + 1}/${total}`)}  ${chalk.dim(spStr)}`);
  lines.push('');
  lines.push(chalk.dim('  Space/p=pause  ]/[=speed  ←/→=step  q=quit'));

  return lines;
}

export async function runReplayCommand(opts: ReplayOptions): Promise<void> {
  const { file, speed: initialSpeed = 1, plain } = opts;

  if (!fs.existsSync(file)) {
    console.error(chalk.red(`  ✖ File not found: ${file}`));
    process.exit(1);
  }

  let rows: LogRow[];
  try {
    rows = parseLogFile(file);
  } catch (err) {
    console.error(chalk.red(`  ✖ Could not parse log file: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log(chalk.yellow('  No data rows found in the log file.'));
    return;
  }

  if (plain) chalk.level = 0;

  let frameIdx = 0;
  let speed = initialSpeed;
  let paused = false;
  let running = true;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);

  const cols = process.stdout.columns || 80;
  process.stdout.write('\x1b[?25l\x1b[2J\x1b[H');

  function renderCurrent() {
    const lines = renderFrame(rows[frameIdx], frameIdx, rows.length, speed, paused, cols);
    process.stdout.write('\x1b[H' + lines.map(l => `\x1b[2K${l}`).join('\r\n') + '\x1b[0J');
  }

  renderCurrent();

  process.stdin.on('keypress', (str: string, key: readline.Key) => {
    if (!key) return;
    if ((key.ctrl && key.name === 'c') || key.name === 'q') {
      running = false;
      process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.exit(0);
    }
    if (key.name === 'space' || key.name === 'p') { paused = !paused; renderCurrent(); return; }
    if (str === ']') { speed = Math.min(speed * 2, 32); renderCurrent(); return; }
    if (str === '[') { speed = Math.max(speed / 2, 0.125); renderCurrent(); return; }
    if (key.name === 'right') { frameIdx = Math.min(frameIdx + 1, rows.length - 1); renderCurrent(); return; }
    if (key.name === 'left') { frameIdx = Math.max(frameIdx - 1, 0); renderCurrent(); return; }
  });

  const BASE_MS = 2000;
  const tick = () => {
    if (!running) return;
    if (!paused) {
      frameIdx++;
      if (frameIdx >= rows.length) { paused = true; frameIdx = rows.length - 1; }
      renderCurrent();
    }
    setTimeout(tick, BASE_MS / speed);
  };
  setTimeout(tick, BASE_MS / speed);

  await new Promise<void>(() => {});
}

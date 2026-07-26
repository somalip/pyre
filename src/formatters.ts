import chalk from 'chalk';
import { StatsData } from './monitors.js';
import { sparkline } from './sparkline.js';
import type { History } from './history.js';

export function formatTable(data: StatsData): string {
  const lines: string[] = [];
  lines.push(data.header.title);
  lines.push(`${chalk.dim('Host')}: ${data.header.hostname}  ${chalk.dim('OS')}: ${data.header.os}  ${chalk.dim('Uptime')}: ${data.header.uptime}`);
  lines.push('');

  lines.push(chalk.bold('CPU'));
  lines.push(makeRow('Brand', data.cpu.brand, true));
  lines.push(makeRow('Cores', `${data.cpu.physicalCores}/${data.cpu.cores} (physical/logical)`));
  lines.push(makeRow('Frequency', `${data.cpu.frequency} MHz`));
  lines.push(makeRow('Usage', bar(data.cpu.usage, 100)));
  lines.push(makeRow('Load Avg', data.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')));
  if (data.cpu.temperature) lines.push(makeRow('Temp', `${data.cpu.temperature}°C`));
  lines.push('');

  lines.push(chalk.bold('Memory'));
  lines.push(makeRow('Total', formatBytes(data.memory.total)));
  lines.push(makeRow('Used', formatBytes(data.memory.used)));
  lines.push(makeRow('Free', formatBytes(data.memory.free)));
  lines.push(makeRow('Usage', bar(data.memory.usagePercent, 100)));
  lines.push(makeRow('Swap', `${formatBytes(data.memory.swapUsed)} / ${formatBytes(data.memory.swapTotal)}`));
  lines.push('');

  if (data.disk.length) {
    lines.push(chalk.bold('Disk'));
    lines.push(formatDiskTable(data.disk));
    lines.push('');
  }

  if (data.battery) {
    lines.push(chalk.bold('Battery'));
    lines.push(makeRow('Level', `${data.battery.level}%  (${data.battery.state})`));
    lines.push(makeRow('Time', data.battery.timeRemaining));
    // lines.push(makeRow('Health', data.battery.health));
    lines.push(makeRow('Source', data.battery.powerSource));
    lines.push('');
  }

  lines.push(chalk.bold('Thermal'));
  lines.push(makeRow('State', thermalColor(data.thermal.pressureLevel)(data.thermal.state)));
  if (data.thermal.temperatures) {
    for (const [k, v] of Object.entries(data.thermal.temperatures)) {
      lines.push(makeRow(`  ${k}`, v !== null ? `${v}°C` : 'N/A'));
    }
  }
  if (data.thermal.error) lines.push(makeRow('Error', data.thermal.error));
  lines.push('');

  lines.push(chalk.bold('Network'));
  lines.push(makeRow('Interface', `${data.network.interface} (${data.network.ip})`));
  lines.push(makeRow('RX', `${formatBytes(data.network.rxBytes)} (${data.network.rxPackets} pkts)`));
  lines.push(makeRow('TX', `${formatBytes(data.network.txBytes)} (${data.network.txPackets} pkts)`));
  lines.push('');

  if (data.processes.length) {
    lines.push(chalk.bold('Top Processes'));
    lines.push(formatProcessTable(data.processes));
  }

  lines.push('');
  lines.push(chalk.dim(data.timestamp));

  return lines.join('\n');
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
    ['system', 'hostname', data.header.hostname],
    ['system', 'uptime', data.header.uptime],
    ['system', 'timestamp', data.timestamp],
  ];
  return rows.map(r => r.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function formatTsv(data: StatsData): string {
  return formatCsv(data).split('\n').map(r => r.split(',').join('\t')).join('\n');
}

function makeRow(key: string, value: string, _color = false): string {
  return `${chalk.dim(key.padEnd(16))} ${value}`;
}

function bar(percent: number, max: number): string {
  const width = 20;
  const filled = Math.round((percent / max) * width);
  const empty = width - filled;
  const barStr = '█'.repeat(filled) + '░'.repeat(empty);
  const color = percent > 90 ? chalk.red : percent > 70 ? chalk.yellow : chalk.green;
  return `${color(barStr)} ${percent}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDiskTable(disks: { filesystem: string; size: string; used: string; available: string; capacity: string; mountpoint: string }[]): string {
  const headers = ['Filesystem', 'Size', 'Used', 'Available', 'Capacity', 'Mount'];
  const rows = disks.slice(0, 8).map(d => [d.filesystem, d.size, d.used, d.available, d.capacity, d.mountpoint]);
  return gridTable(headers, rows);
}

function formatProcessTable(processes: { pid: number; user: string; cpu: number; mem: number; command: string }[]): string {
  const headers = ['PID', 'User', 'CPU %', 'MEM %', 'Command'];
  const rows = processes.map(p => [String(p.pid), p.user, `${p.cpu}%`, `${p.mem}%`, p.command.substring(0, 40)]);
  return gridTable(headers, rows);
}

export function thermalColor(pressureLevel: number) {
  if (pressureLevel >= 3) return chalk.red;
  if (pressureLevel === 2) return chalk.yellow;
  if (pressureLevel === 1) return chalk.yellowBright;
  return chalk.green;
}

/**
 * Renders a compact multi-row sparkline graph panel from rolling History data.
 * Used by the live dashboard; CPU/Mem are graphed 0-100%, temp and network
 * rates are graphed against their own auto-scaled min/max.
 */
export function formatGraphs(history: History): string {
  const lines: string[] = [];
  const sampleCount = history.cpuUsage.length;
  lines.push(chalk.bold('Graphs') + chalk.dim(`  (last ${sampleCount} sample${sampleCount === 1 ? '' : 's'})`));

  lines.push(graphRow('CPU %', history.cpuUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`));
  lines.push(graphRow('Mem %', history.memUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`));

  if (history.temp.length) {
    lines.push(graphRow('Temp', history.temp, {}, v => `${v.toFixed(1)}°C`));
  }

  lines.push(graphRow('Net RX/s', history.netRxRate, {}, v => `${formatBytes(v)}/s`));
  lines.push(graphRow('Net TX/s', history.netTxRate, {}, v => `${formatBytes(v)}/s`));

  return lines.join('\n');
}

function graphRow(
  label: string,
  values: number[],
  bounds: { min?: number; max?: number },
  fmt: (v: number) => string
): string {
  if (!values.length) {
    return `${chalk.dim(label.padEnd(10))} ${chalk.dim('collecting data...')}`;
  }
  const spark = sparkline(values, bounds);
  const current = values[values.length - 1];

  let color = chalk.cyan;
  if (bounds.min !== undefined && bounds.max !== undefined) {
    const pct = ((current - bounds.min) / (bounds.max - bounds.min || 1)) * 100;
    color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  }

  return `${chalk.dim(label.padEnd(10))} ${color(spark)}  ${chalk.bold(fmt(current))}`;
}

function gridTable(headers: string[], rows: string[][]): string {
  const width = new Array(headers.length).fill(0);
  for (let i = 0; i < headers.length; i++) {
    width[i] = Math.max(headers[i].length, ...rows.map(r => (r[i] || '').length));
  }
  const sep = '+' + width.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const divider = '+' + width.map(w => '='.repeat(w + 2)).join('+') + '+';
  const lines: string[] = [];
  lines.push(sep);
  const headerRow = '|' + headers.map((h, i) => ` ${chalk.bold(h.padEnd(width[i]))} `).join('|') + '|';
  lines.push(headerRow);
  lines.push(divider);
  for (const row of rows) {
    lines.push('|' + row.map((cell, i) => ` ${(cell || '').padEnd(width[i])} `).join('|') + '|');
  }
  lines.push(sep);
  return lines.join('\n');
}
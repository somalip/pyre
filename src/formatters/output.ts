/**
 * Data-export and graph-rendering helpers.
 *
 * Provides JSON, CSV, and TSV serialisation of a
 * {@link StatsData} snapshot, as well as sparkline-graph
 * rendering for the live dashboard.
 */
import chalk from 'chalk';
import { sparkline } from '../sparkline.js';
import type { History } from '../history.js';
import type { StatsData } from './types.js';
import { THEMES, type ThemeName } from './themes.js';
import { formatBytes, celsiusToFahrenheit, formatTemp } from './render.js';
import { panel } from './render.js';

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
    ['thermal', 'cpuTempC', data.thermal.temperatures?.cpu_die ? String(data.thermal.temperatures.cpu_die) : ''],
    [
      'thermal',
      'cpuTempF',
      data.thermal.temperatures?.cpu_die !== undefined ? String(celsiusToFahrenheit(data.thermal.temperatures.cpu_die)) : '',
    ],
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
  lines.push(
    graphRow('Temp', history.temp, {}, formatTemp, sparkWidth, 'no sensor access (needs sudo powermetrics)')
  );
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
  sparkWidth = 40,
  emptyMessage = 'collecting data...'
): string {
  if (!values.length) {
    return `${chalk.dim(label.padEnd(10))} ${chalk.dim(emptyMessage)}`;
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
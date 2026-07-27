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
      data.thermal.temperatures?.cpu_die != null ? String(celsiusToFahrenheit(data.thermal.temperatures.cpu_die)) : '',
    ],
    ['network', 'rxBytes', String(data.network.rxBytes)],
    ['network', 'txBytes', String(data.network.txBytes)],
    ['network', 'rxPackets', String(data.network.rxPackets)],
    ['network', 'txPackets', String(data.network.txPackets)],
    ['network', 'connections', data.network.connections ? String(data.network.connections) : ''],
    ['battery', 'level', data.battery ? String(data.battery.level) : ''],
    ['battery', 'powerSource', data.battery ? data.battery.powerSource : ''],
    ['battery', 'condition', data.battery?.condition ?? ''],
    ['battery', 'maxCapacityPercent', data.battery?.maxCapacityPercent !== undefined ? String(data.battery.maxCapacityPercent) : ''],
    ['battery', 'cycles', data.battery?.cycles !== undefined ? String(data.battery.cycles) : ''],
    ['battery', 'estimatedTimeToEmpty', data.battery?.estimatedTimeToEmpty ?? ''],
    ['battery', 'dischargeRatePerHour', data.battery?.dischargeRatePerHour !== undefined ? String(data.battery.dischargeRatePerHour) : ''],
    ['battery', 'powerWatts', data.battery?.powerWatts !== undefined ? String(data.battery.powerWatts) : ''],
    ['power', 'cpuWatts', data.power?.cpuWatts !== undefined ? String(data.power.cpuWatts) : ''],
    ['power', 'gpuWatts', data.power?.gpuWatts !== undefined ? String(data.power.gpuWatts) : ''],
    ['power', 'combinedWatts', data.power?.combinedWatts !== undefined ? String(data.power.combinedWatts) : ''],
    ['system', 'hostname', data.header.hostname],
     ['system', 'uptime', data.header.uptime],
     ['system', 'timestamp', data.timestamp],
   ];

  if (data.packets) {
    rows.push(['packets', 'totalPackets', String(data.packets.totalPackets)]);
    rows.push(['packets', 'rxPackets', String(data.packets.rxPackets)]);
    rows.push(['packets', 'txPackets', String(data.packets.txPackets)]);
    rows.push(['packets', 'connections', String(data.packets.connections)]);
    for (const iface of data.packets.interfaces || []) {
      rows.push(['packets_iface', iface.iface, `${iface.rxPackets},${iface.txPackets},${iface.rxBytes},${iface.txBytes}`]);
    }
    for (const proc of data.packets.allProcesses || []) {
      rows.push(['packets_proc', `pid=${proc.pid}`, `${proc.command},${proc.rxBytes},${proc.txBytes}`]);
    }
  }

  if (data.gpu) {
    rows.push(['gpu', 'model', data.gpu.model]);
    rows.push(['gpu', 'memory', String(data.gpu.memory)]);
    rows.push(['gpu', 'utilization', String(data.gpu.utilization)]);
    if (data.gpu.temperature) rows.push(['gpu', 'tempC', String(data.gpu.temperature)]);
    rows.push(['gpu', 'processes', String(data.gpu.processes)]);
  }

  for (const p of data.processes) {
   rows.push(['process', `pid=${p.pid}`, `${p.pid}`]);
   rows.push(['process', `ppid=${p.pid}`, String(p.ppid)]);
   rows.push(['process', `user=${p.pid}`, p.user]);
   rows.push(['process', `cpu=${p.pid}`, String(p.cpu)]);
   rows.push(['process', `mem=${p.pid}`, String(p.mem)]);
   rows.push(['process', `state=${p.pid}`, p.state]);
   rows.push(['process', `threads=${p.pid}`, String(p.threads)]);
   rows.push(['process', `runtime=${p.pid}`, String(p.runtime)]);
   rows.push(['process', `command=${p.pid}`, p.command]);
 }
 return rows.map(r => r.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function formatTsv(data: StatsData): string {
  return formatCsv(data).split('\n').map(r => r.split(',').join('\t')).join('\n');
}

export function formatGraphs(history: History, width = 80, themeName: ThemeName = 'default', graphMode: 'spark' | 'bar' = 'spark'): string {
  const theme = THEMES[themeName] || THEMES.default;
  const contentWidth = width - 4;
  const sampleCount = history.cpuUsage.length;
  const sparkWidth = Math.max(10, contentWidth - 28);

  const lines: string[] = [];
  lines.push(graphRow('CPU %', history.cpuUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth, 'collecting data...', graphMode));
  lines.push(graphRow('Mem %', history.memUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth, 'collecting data...', graphMode));
  lines.push(
    graphRow('Temp', history.temp, {}, formatTemp, sparkWidth, 'no sensor access (needs sudo powermetrics)', graphMode)
  );
  lines.push(graphRow('Net RX/s', history.netRxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth, 'collecting data...', graphMode));
  lines.push(graphRow('Net TX/s', history.netTxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth, 'collecting data...', graphMode));
  if (history.powerWatts.length) {
    lines.push(graphRow('Power W', history.powerWatts, {}, v => `${v.toFixed(1)} W`, sparkWidth, 'collecting data...', graphMode));
  }
  if (history.rxPacketRate.length) {
    lines.push(graphRow('RX pkt/s', history.rxPacketRate, {}, v => `${v.toFixed(0)} pkt/s`, sparkWidth, 'collecting data...', graphMode));
  }
  if (history.txPacketRate.length) {
    lines.push(graphRow('TX pkt/s', history.txPacketRate, {}, v => `${v.toFixed(0)} pkt/s`, sparkWidth, 'collecting data...', graphMode));
  }

  const title = `Graphs · mode:${graphMode} · last ${sampleCount} sample${sampleCount === 1 ? '' : 's'}`;
  return panel(title, lines, width, theme.graphs, theme.border).join('\n');
}

function graphRow(
  label: string,
  values: number[],
  bounds: { min?: number; max?: number },
  fmt: (v: number) => string,
  sparkWidth = 40,
  emptyMessage = 'collecting data...',
  mode: 'spark' | 'bar' = 'spark'
): string {
  if (!values.length) {
    return `${chalk.dim(label.padEnd(10))} ${chalk.dim(emptyMessage)}`;
  }
  const visible = values.slice(-sparkWidth);
  const spark = mode === 'spark' ? sparkline(visible, bounds) : barGraph(visible, bounds, sparkWidth);
  const current = values[values.length - 1];

  let color = chalk.cyan;
  if (bounds.min !== undefined && bounds.max !== undefined) {
    const pct = ((current - bounds.min) / (bounds.max - bounds.min || 1)) * 100;
    color = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  }

  return `${chalk.dim(label.padEnd(10))}${color(spark)}  ${chalk.bold(fmt(current))}`;
}

function barGraph(values: number[], bounds: { min?: number; max?: number }, width: number): string {
  let min = bounds.min ?? Infinity;
  let max = bounds.max ?? -Infinity;
  if (bounds.min === undefined || bounds.max === undefined) {
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const range = max - min || 1;
  return values.map(v => {
    const pct = (v - min) / range;
    if (pct > 0.8) return '█';
    if (pct > 0.6) return '▇';
    if (pct > 0.4) return '▆';
    if (pct > 0.2) return '▄';
    return ' ';
  }).join('');
}

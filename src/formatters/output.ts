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
import { formatBytes, celsiusToFahrenheit, formatTemp, panel, fitVisible } from './render.js';

export function formatJson(data: StatsData): string {
  return JSON.stringify(data, null, 2);
}

export function formatHtml(data: StatsData): string {
  const rows = (items: { label: string; value: string }[]) =>
    items.map(i => `<tr><td class="label">${escapeHtml(i.label)}</td><td class="value">${escapeHtml(i.value)}</td></tr>`).join('\n');

  const sections: string[] = [];

  sections.push(`<h2>System</h2>
<table>
  ${rows([
    { label: 'Hostname', value: data.header.hostname },
    { label: 'OS', value: data.header.os },
    { label: 'Uptime', value: data.header.uptime },
    { label: 'Timestamp', value: data.timestamp },
  ]).trim()}
</table>`);

  sections.push(`<h2>CPU</h2>
<table>
  ${rows([
    { label: 'Brand', value: data.cpu.brand },
    { label: 'Cores', value: `${data.cpu.physicalCores}/${data.cpu.cores}` },
    { label: 'Frequency', value: `${data.cpu.frequency} MHz` },
    { label: 'Usage', value: `${data.cpu.usage}%` },
    { label: 'Load Avg', value: data.cpu.loadAvg.map(l => l.toFixed(2)).join(' ') },
    ...(data.cpu.temperature ? [{ label: 'Temperature', value: `${data.cpu.temperature.toFixed(1)}°C` }] : []),
  ]).trim()}
</table>`);

  sections.push(`<h2>Memory</h2>
<table>
  ${rows([
    { label: 'Total', value: formatBytes(data.memory.total) },
    { label: 'Used', value: formatBytes(data.memory.used) },
    { label: 'Free', value: formatBytes(data.memory.free) },
    { label: 'Usage', value: `${data.memory.usagePercent}%` },
    { label: 'Swap', value: `${formatBytes(data.memory.swapUsed)} / ${formatBytes(data.memory.swapTotal)}` },
  ]).trim()}
</table>`);

  if (data.gpu) {
    sections.push(`<h2>GPU</h2>
<table>
  ${rows([
    { label: 'Model', value: data.gpu.model },
    { label: 'Memory', value: formatBytes(data.gpu.memory) },
    { label: 'Utilization', value: `${data.gpu.utilization}%` },
    ...(data.gpu.temperature ? [{ label: 'Temperature', value: `${data.gpu.temperature.toFixed(1)}°C` }] : []),
    { label: 'Processes', value: String(data.gpu.processes) },
  ]).trim()}
</table>`);
  }

  if (data.power) {
    const powerRows: { label: string; value: string }[] = [];
    if (data.power.cpuWatts !== undefined) powerRows.push({ label: 'CPU', value: `${data.power.cpuWatts.toFixed(2)} W` });
    if (data.power.gpuWatts !== undefined) powerRows.push({ label: 'GPU', value: `${data.power.gpuWatts.toFixed(2)} W` });
    if (data.power.combinedWatts !== undefined) powerRows.push({ label: 'Combined', value: `${data.power.combinedWatts.toFixed(2)} W` });
    if (powerRows.length) {
      sections.push(`<h2>Power</h2>\n<table>\n  ${rows(powerRows).trim()}\n</table>`);
    }
  }

  if (data.battery) {
    const battRows: { label: string; value: string }[] = [
      { label: 'Level', value: `${data.battery.level}%` },
      { label: 'State', value: data.battery.state },
      { label: 'Time Remaining', value: data.battery.timeRemaining },
      { label: 'Health', value: data.battery.health },
      { label: 'Power Source', value: data.battery.powerSource },
    ];
    if (data.battery.condition) battRows.push({ label: 'Condition', value: data.battery.condition });
    if (data.battery.maxCapacityPercent !== undefined) battRows.push({ label: 'Max Capacity', value: `${data.battery.maxCapacityPercent}%` });
    if (data.battery.cycles !== undefined) battRows.push({ label: 'Cycles', value: String(data.battery.cycles) });
    if (data.battery.estimatedTimeToEmpty) battRows.push({ label: 'Est. Empty', value: data.battery.estimatedTimeToEmpty });
    if (data.battery.dischargeRatePerHour !== undefined) battRows.push({ label: 'Discharge Rate', value: `${data.battery.dischargeRatePerHour}%/h` });
    sections.push(`<h2>Battery</h2>\n<table>\n  ${rows(battRows).trim()}\n</table>`);
  }

  sections.push(`<h2>Thermal</h2>
<table>
  ${rows([
    { label: 'State', value: data.thermal.state },
    { label: 'Pressure', value: ['Nominal', 'Fair', 'Serious', 'Critical'][data.thermal.pressureLevel] || 'Unknown' },
    ...(data.thermal.temperatures
      ? Object.entries(data.thermal.temperatures).flatMap(([k, v]) =>
          v !== null && v !== undefined ? [{ label: k.replace(/_/g, ' '), value: `${v.toFixed(1)}°C` }] : []
        )
      : []),
  ]).trim()}
</table>`);

  sections.push(`<h2>Network</h2>
<table>
  ${rows([
    { label: 'Interface', value: `${data.network.interface} (${data.network.ip})` },
    { label: 'RX', value: `${formatBytes(data.network.rxBytes)} / ${data.network.rxPackets} pkt` },
    { label: 'TX', value: `${formatBytes(data.network.txBytes)} / ${data.network.txPackets} pkt` },
  ]).trim()}
</table>`);

  if (data.packets) {
    sections.push(`<h2>Packets</h2>
<table>
  ${rows([
    { label: 'Total', value: `${data.packets.totalPackets} pkt` },
    { label: 'RX', value: `${data.packets.rxPackets} pkt` },
    { label: 'TX', value: `${data.packets.txPackets} pkt` },
    { label: 'Connections', value: `${data.packets.connections} TCP` },
  ]).trim()}
</table>`);
  }

  if (data.tasks.length) {
    const taskRows = data.tasks.slice(0, 20).map(t => ({
      label: `${t.pid}`,
      value: `${t.user.padEnd(10)} ${t.cpu.toFixed(1).padStart(6)}% ${t.mem.toFixed(1).padStart(6)}% ${t.state} ${t.command}`,
    }));
    sections.push(`<h2>Tasks</h2>\n<table>\n  ${rows(taskRows).trim()}\n</table>`);
  }

  if (data.disk.length) {
    const diskRows = data.disk.map(d => ({
      label: d.mountpoint,
      value: `${d.used} / ${d.size} (${d.capacity})`,
    }));
    sections.push(`<h2>Disk</h2>\n<table>\n  ${rows(diskRows).trim()}\n</table>`);
  }

  if (data.processes.length) {
    const procRows = data.processes.slice(0, 50).map(p => ({
      label: String(p.pid),
      value: `${p.user.padEnd(10)} ${p.cpu.toFixed(1).padStart(6)}% ${p.mem.toFixed(1).padStart(6)}% ${p.state} ${p.command}`,
    }));
    sections.push(`<h2>Processes</h2>\n<table>\n  ${rows(procRows).trim()}\n</table>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>pyre — ${data.header.hostname}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1e1e2e; color: #cdd6f4; margin: 0; padding: 24px; }
  h1 { color: #ff6a39; margin-bottom: 4px; }
  .meta { color: #a6adc8; margin-bottom: 24px; }
  h2 { color: #89b4fa; margin-top: 28px; border-bottom: 1px solid #313244; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  td { padding: 6px 10px; border-bottom: 1px solid #313244; vertical-align: top; }
  td.label { color: #a6adc8; width: 22%; font-weight: 500; }
  td.value { color: #cdd6f4; }
  tr:last-child td { border-bottom: none; }
</style>
</head>
<body>
  <h1>PYRE</h1>
  <div class="meta">${escapeHtml(data.header.hostname)} · ${escapeHtml(data.header.os)} · up ${escapeHtml(data.header.uptime)} · ${escapeHtml(data.timestamp)}</div>
  ${sections.join('\n  ')}
</body>
</html>`;
}

export function formatMarkdown(data: StatsData): string {
  const lines: string[] = [];
  lines.push(`# pyre — ${data.header.hostname}`);
  lines.push('');
  lines.push(`**${data.header.os}** · up ${data.header.uptime} · ${data.timestamp}`);
  lines.push('');

  lines.push('## System');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| Hostname | ${mdCell(data.header.hostname)} |`);
  lines.push(`| OS | ${mdCell(data.header.os)} |`);
  lines.push(`| Uptime | ${mdCell(data.header.uptime)} |`);
  lines.push('');

  lines.push('## CPU');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| Brand | ${mdCell(data.cpu.brand)} |`);
  lines.push(`| Cores | ${mdCell(`${data.cpu.physicalCores}/${data.cpu.cores}`)} |`);
  lines.push(`| Frequency | ${mdCell(`${data.cpu.frequency} MHz`)} |`);
  lines.push(`| Usage | ${mdCell(`${data.cpu.usage}%`)} |`);
  lines.push(`| Load Avg | ${mdCell(data.cpu.loadAvg.map(l => l.toFixed(2)).join(' '))} |`);
  if (data.cpu.temperature) lines.push(`| Temperature | ${mdCell(`${data.cpu.temperature.toFixed(1)}°C`)} |`);
  lines.push('');

  lines.push('## Memory');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| Total | ${mdCell(formatBytes(data.memory.total))} |`);
  lines.push(`| Used | ${mdCell(formatBytes(data.memory.used))} |`);
  lines.push(`| Free | ${mdCell(formatBytes(data.memory.free))} |`);
  lines.push(`| Usage | ${mdCell(`${data.memory.usagePercent}%`)} |`);
  lines.push(`| Swap | ${mdCell(`${formatBytes(data.memory.swapUsed)} / ${formatBytes(data.memory.swapTotal)}`)} |`);
  lines.push('');

  if (data.gpu) {
    lines.push('## GPU');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|---|---|');
    lines.push(`| Model | ${mdCell(data.gpu.model)} |`);
    lines.push(`| Memory | ${mdCell(formatBytes(data.gpu.memory))} |`);
    lines.push(`| Utilization | ${mdCell(`${data.gpu.utilization}%`)} |`);
    if (data.gpu.temperature) lines.push(`| Temperature | ${mdCell(`${data.gpu.temperature.toFixed(1)}°C`)} |`);
    lines.push(`| Processes | ${mdCell(String(data.gpu.processes))} |`);
    lines.push('');
  }

  if (data.power) {
    const pw: string[] = [];
    if (data.power.cpuWatts !== undefined) pw.push(`CPU ${data.power.cpuWatts.toFixed(2)} W`);
    if (data.power.gpuWatts !== undefined) pw.push(`GPU ${data.power.gpuWatts.toFixed(2)} W`);
    if (data.power.combinedWatts !== undefined) pw.push(`Combined ${data.power.combinedWatts.toFixed(2)} W`);
    if (pw.length) {
      lines.push('## Power');
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|---|---|');
      if (data.power.cpuWatts !== undefined) lines.push(`| CPU | ${mdCell(`${data.power.cpuWatts.toFixed(2)} W`)} |`);
      if (data.power.gpuWatts !== undefined) lines.push(`| GPU | ${mdCell(`${data.power.gpuWatts.toFixed(2)} W`)} |`);
      if (data.power.combinedWatts !== undefined) lines.push(`| Combined | ${mdCell(`${data.power.combinedWatts.toFixed(2)} W`)} |`);
      lines.push('');
    }
  }

  if (data.battery) {
    lines.push('## Battery');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|---|---|');
    lines.push(`| Level | ${mdCell(`${data.battery.level}%`)} |`);
    lines.push(`| State | ${mdCell(data.battery.state)} |`);
    lines.push(`| Time Remaining | ${mdCell(data.battery.timeRemaining)} |`);
    lines.push(`| Health | ${mdCell(data.battery.health)} |`);
    lines.push(`| Power Source | ${mdCell(data.battery.powerSource)} |`);
    if (data.battery.condition) lines.push(`| Condition | ${mdCell(data.battery.condition)} |`);
    if (data.battery.maxCapacityPercent !== undefined) lines.push(`| Max Capacity | ${mdCell(`${data.battery.maxCapacityPercent}%`)} |`);
    if (data.battery.cycles !== undefined) lines.push(`| Cycles | ${mdCell(String(data.battery.cycles))} |`);
    if (data.battery.estimatedTimeToEmpty) lines.push(`| Est. Empty | ${mdCell(data.battery.estimatedTimeToEmpty)} |`);
    if (data.battery.dischargeRatePerHour !== undefined) lines.push(`| Discharge Rate | ${mdCell(`${data.battery.dischargeRatePerHour}%/h`)} |`);
    lines.push('');
  }

  lines.push('## Thermal');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| State | ${mdCell(data.thermal.state)} |`);
  lines.push(`| Pressure | ${mdCell(['Nominal', 'Fair', 'Serious', 'Critical'][data.thermal.pressureLevel] || 'Unknown')} |`);
  if (data.thermal.temperatures) {
    for (const [k, v] of Object.entries(data.thermal.temperatures)) {
      if (v !== null && v !== undefined) lines.push(`| ${mdCell(k.replace(/_/g, ' '))} | ${mdCell(`${v.toFixed(1)}°C`)} |`);
    }
  }
  lines.push('');

  lines.push('## Network');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| Interface | ${mdCell(`${data.network.interface} (${data.network.ip})`)} |`);
  lines.push(`| RX | ${mdCell(`${formatBytes(data.network.rxBytes)} / ${data.network.rxPackets} pkt`)} |`);
  lines.push(`| TX | ${mdCell(`${formatBytes(data.network.txBytes)} / ${data.network.txPackets} pkt`)} |`);
  lines.push('');

  if (data.packets) {
    lines.push('## Packets');
    lines.push('');
    lines.push('| Property | Value |');
    lines.push('|---|---|');
    lines.push(`| Total | ${mdCell(`${data.packets.totalPackets} pkt`)} |`);
    lines.push(`| RX | ${mdCell(`${data.packets.rxPackets} pkt`)} |`);
    lines.push(`| TX | ${mdCell(`${data.packets.txPackets} pkt`)} |`);
    lines.push(`| Connections | ${mdCell(`${data.packets.connections} TCP`)} |`);
    lines.push('');
  }

  if (data.tasks.length) {
    lines.push('## Tasks');
    lines.push('');
    lines.push('| PID | User | CPU% | MEM% | State | Command |');
    lines.push('|---|---|---|---|---|---|');
    for (const t of data.tasks.slice(0, 20)) {
      lines.push(`| ${t.pid} | ${mdCell(t.user)} | ${t.cpu.toFixed(1)} | ${t.mem.toFixed(1)} | ${t.state} | ${mdCell(t.command)} |`);
    }
    lines.push('');
  }

  if (data.disk.length) {
    lines.push('## Disk');
    lines.push('');
    lines.push('| Mountpoint | Used / Size | Capacity |');
    lines.push('|---|---|---|');
    for (const d of data.disk) {
      lines.push(`| ${mdCell(d.mountpoint)} | ${mdCell(`${d.used} / ${d.size}`)} | ${mdCell(d.capacity)} |`);
    }
    lines.push('');
  }

  if (data.processes.length) {
    lines.push('## Processes');
    lines.push('');
    lines.push('| PID | User | CPU% | MEM% | State | Command |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of data.processes.slice(0, 50)) {
      lines.push(`| ${p.pid} | ${mdCell(p.user)} | ${p.cpu.toFixed(1)} | ${p.mem.toFixed(1)} | ${p.state} | ${mdCell(p.command)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdCell(s: string): string {
  return String(s).replace(/\|/g, '\\|');
}

export function formatCsv(data: StatsData): string {
  const rows: string[][] = [
    ['property', 'key', 'value'],
    ['cpu', 'brand', data.cpu.brand],
    ['cpu', 'usage', String(data.cpu.usage)],
    ['cpu', 'loadAvg_1m', String(data.cpu.loadAvg[0])],
    ['cpu', 'loadAvg_5m', String(data.cpu.loadAvg[1])],
    ['cpu', 'loadAvg_15m', String(data.cpu.loadAvg[2])],
    ['cpu', 'cores', String(data.cpu.cores)],
    ['cpu', 'physicalCores', String(data.cpu.physicalCores)],
    ['cpu', 'frequency', String(data.cpu.frequency)],
    ['memory', 'total', String(data.memory.total)],
    ['memory', 'used', String(data.memory.used)],
    ['memory', 'usagePercent', String(data.memory.usagePercent)],
    ['memory', 'swapUsed', String(data.memory.swapUsed)],
    ['memory', 'swapTotal', String(data.memory.swapTotal)],
    ['thermal', 'state', data.thermal.state],
    ['thermal', 'cpuTempC', data.thermal.temperatures?.cpu_die ? String(data.thermal.temperatures.cpu_die) : ''],
    ['thermal', 'cpuTempF', data.thermal.temperatures?.cpu_die != null ? String(celsiusToFahrenheit(data.thermal.temperatures.cpu_die)) : ''],
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
  if (data.cpu.coreUsage && data.cpu.coreUsage.length) {
    data.cpu.coreUsage.forEach((u, i) => rows.push(['cpu', `coreUsage_${i}`, String(u)]));
  }

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
  const sparkWidth = Math.max(10, contentWidth - 24);

  const lines: string[] = [];
  lines.push(graphRow('CPU %', history.cpuUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  lines.push(graphRow('Mem %', history.memUsage, { min: 0, max: 100 }, v => `${v.toFixed(0)}%`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  lines.push(
    graphRow('Temp', history.temp, {}, v => `${v.toFixed(1)}°C`, sparkWidth, 'no sensor access', graphMode, contentWidth)
  );
  lines.push(graphRow('Net RX/s', history.netRxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  lines.push(graphRow('Net TX/s', history.netTxRate, {}, v => `${formatBytes(v)}/s`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  if (history.powerWatts.length) {
    lines.push(graphRow('Power W', history.powerWatts, {}, v => `${v.toFixed(1)} W`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  }
  if (history.rxPacketRate.length) {
    lines.push(graphRow('RX pkt/s', history.rxPacketRate, {}, v => `${v.toFixed(0)} pkt/s`, sparkWidth, 'collecting data...', graphMode, contentWidth));
  }
  if (history.txPacketRate.length) {
    lines.push(graphRow('TX pkt/s', history.txPacketRate, {}, v => `${v.toFixed(0)} pkt/s`, sparkWidth, 'collecting data...', graphMode, contentWidth));
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
  mode: 'spark' | 'bar' = 'spark',
  contentWidth = 76
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

  const raw = `${chalk.dim(label.padEnd(10))}${color(spark)}  ${chalk.bold(fmt(current))}`;
  return fitVisible(raw, contentWidth);
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

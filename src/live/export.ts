/**
 * Live dashboard export and logging helpers.
 *
 * Handles snapshot export (JSON/CSV/TSV), continuous
 * CSV logging, and the supporting file-system utilities.
 * All state variables are imported from `state.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatJson, formatCsv, formatTsv } from '../formatters/index.js';
import { state, setStatus } from './state.js';

/** Ensure a directory exists, creating it recursively if needed. */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Generate a filesystem-safe timestamp string for export filenames. */
function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function exportSnapshot() {
  if (!state.lastData) {
    setStatus('No data yet — try again in a moment');
    return;
  }
  try {
    ensureDir(state.exportDir);
    const file = path.join(state.exportDir, `pyre-${timestampForFile()}.${state.exportFormat}`);
    const content =
      state.exportFormat === 'json' ? formatJson(state.lastData) : state.exportFormat === 'csv' ? formatCsv(state.lastData) : formatTsv(state.lastData);
    fs.writeFileSync(file, content);
    setStatus(`Exported snapshot -> ${file}`);
  } catch (err: any) {
    setStatus(`Export failed: ${err.message}`);
  }
}

function startLogging() {
  try {
    ensureDir(state.exportDir);
    const file = path.join(state.exportDir, `pyre-log-${timestampForFile()}.csv`);
    state.logStream = fs.createWriteStream(file, { flags: 'a' });
    state.logStream.write('timestamp,cpu_usage,mem_usage_percent,temp_c,net_rx_bytes,net_tx_bytes,net_rx_packets,net_tx_packets,connections,thermal_state\n');
    state.logging = true;
    setStatus(`Logging every tick -> ${file}`);
  } catch (err: any) {
    setStatus(`Logging failed to start: ${err.message}`);
  }
}

function stopLogging() {
  state.logging = false;
  state.logStream?.end();
  state.logStream = null;
  setStatus('Logging stopped');
}

function toggleLogging() {
  if (state.logging) stopLogging();
  else startLogging();
}

function writeLogRow(data: any) {
  if (!state.logging || !state.logStream) return;
  const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? '';
  const rxPackets = data.network.rxPackets ?? 0;
  const txPackets = data.network.txPackets ?? 0;
  const connections = data.network.connections ?? 0;
  state.logStream.write(
    `${data.timestamp},${data.cpu.usage},${data.memory.usagePercent},${temp},${data.network.rxBytes},${data.network.txBytes},${rxPackets},${txPackets},${connections},${data.thermal.state}\n`
  );
}

export { ensureDir, timestampForFile, exportSnapshot, startLogging, stopLogging, toggleLogging, writeLogRow };
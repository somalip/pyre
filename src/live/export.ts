/**
 * Live dashboard export and logging helpers.
 *
 * Handles snapshot export (JSON/CSV/TSV/HTML/Markdown), continuous
 * CSV logging with rotation, and the supporting file-system utilities.
 * All state variables are imported from `state.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatJson, formatCsv, formatTsv, formatHtml, formatMarkdown } from '../formatters/index.js';
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
    const ext = state.exportFormat === 'json' ? 'json' : state.exportFormat === 'csv' ? 'csv' : state.exportFormat === 'tsv' ? 'tsv' : state.exportFormat === 'html' ? 'html' : 'md';
    const file = path.join(state.exportDir, `pyre-${timestampForFile()}.${ext}`);
    let content: string;
    switch (state.exportFormat) {
      case 'json': content = formatJson(state.lastData); break;
      case 'csv': content = formatCsv(state.lastData); break;
      case 'tsv': content = formatTsv(state.lastData); break;
      case 'html': content = formatHtml(state.lastData); break;
      case 'md': content = formatMarkdown(state.lastData); break;
    }
    fs.writeFileSync(file, content);
    setStatus(`Exported snapshot -> ${file}`);
  } catch (err: any) {
    setStatus(`Export failed: ${err.message}`);
  }
}

function startLogging() {
  try {
    ensureDir(state.exportDir);
    rotateLogs();
    const file = path.join(state.exportDir, `pyre-log-${timestampForFile()}.csv`);
    state.logStream = fs.createWriteStream(file, { flags: 'a' });
    state.logStream.write('timestamp,cpu_usage,mem_usage_percent,temp_c,net_rx_bytes,net_tx_bytes,net_rx_packets,net_tx_packets,connections,thermal_state\n');
    state.logging = true;
    setStatus(`Logging every tick -> ${file}`);
  } catch (err: any) {
    setStatus(`Logging failed to start: ${err.message}`);
  }
}

const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOG_COUNT = 20;
const MAX_LOG_BYTES = 50 * 1024 * 1024;

function rotateLogs() {
  try {
    const dir = state.exportDir;
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('pyre-log-') && f.endsWith('.csv'))
      .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs, size: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => a.mtime - b.mtime);

    const now = Date.now();
    for (const f of files) {
      if (now - f.mtime > MAX_LOG_AGE_MS) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
    }

    const remaining = fs.readdirSync(dir).filter(f => f.startsWith('pyre-log-') && f.endsWith('.csv'));
    if (remaining.length > MAX_LOG_COUNT) {
      const toDelete = remaining.sort().slice(0, remaining.length - MAX_LOG_COUNT);
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }

    let totalSize = 0;
    for (const f of remaining) {
      totalSize += fs.statSync(path.join(dir, f)).size;
    }
    if (totalSize > MAX_LOG_BYTES) {
      const sorted = remaining.sort();
      for (const f of sorted) {
        const sz = fs.statSync(path.join(dir, f)).size;
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
        totalSize -= sz;
        if (totalSize <= MAX_LOG_BYTES * 0.8) break;
      }
    }
  } catch {
    // ignore rotation errors
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
  let temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? '';
  if (temp !== '' && state.tempUnit === 'f') {
    temp = ((temp * 9 / 5) + 32).toFixed(1);
  }
  const rxPackets = data.network.rxPackets ?? 0;
  const txPackets = data.network.txPackets ?? 0;
  const connections = data.network.connections ?? 0;
  state.logStream.write(
    `${data.timestamp},${data.cpu.usage},${data.memory.usagePercent},${temp},${data.network.rxBytes},${data.network.txBytes},${rxPackets},${txPackets},${connections},${data.thermal.state}\n`
  );
}

export { ensureDir, timestampForFile, exportSnapshot, startLogging, stopLogging, toggleLogging, writeLogRow };
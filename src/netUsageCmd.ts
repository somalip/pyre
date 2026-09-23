/**
 * pyre netusage — Per-application network usage tracker.
 *
 * Uses macOS socket accounting and nettop parsing from collectPackets
 * to produce detailed real-time and cumulative network metrics per process.
 */
import chalk from 'chalk';
import { collectPackets } from './monitors/collectors.js';
import { formatBytes } from './formatters/render.js';

export interface NetUsageOptions {
  top?: number;
  sort?: 'rx' | 'tx' | 'total';
  json?: boolean;
  interval?: number;
}

export async function runNetUsageCommand(opts: NetUsageOptions = {}): Promise<void> {
  const topCount = opts.top || 15;
  const sortKey = opts.sort || 'total';

  const packetData = await collectPackets();
  if (!packetData || !packetData.allProcesses || packetData.allProcesses.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ processes: [], totalRx: 0, totalTx: 0 }));
      return;
    }
    console.log(chalk.yellow('\n  ⚠ No active per-application network sockets detected.'));
    console.log(chalk.dim('  Ensure network activity is present or run with elevated permissions if required.\n'));
    return;
  }

  // Aggregate by process command / name
  interface AggregatedProc {
    pid: number;
    command: string;
    rxBytes: number;
    txBytes: number;
    totalBytes: number;
    connections: number;
  }

  const appMap = new Map<string, AggregatedProc>();

  for (const proc of packetData.allProcesses) {
    const key = proc.command || `pid-${proc.pid}`;
    const rx = proc.rxBytes || 0;
    const tx = proc.txBytes || 0;
    const conns = proc.connections ? proc.connections.length : 0;

    const existing = appMap.get(key);
    if (existing) {
      existing.rxBytes += rx;
      existing.txBytes += tx;
      existing.totalBytes += (rx + tx);
      existing.connections += conns;
    } else {
      appMap.set(key, {
        pid: proc.pid,
        command: key,
        rxBytes: rx,
        txBytes: tx,
        totalBytes: rx + tx,
        connections: conns,
      });
    }
  }

  const sorted = Array.from(appMap.values()).sort((a, b) => {
    if (sortKey === 'rx') return b.rxBytes - a.rxBytes;
    if (sortKey === 'tx') return b.txBytes - a.txBytes;
    return b.totalBytes - a.totalBytes;
  });

  const displayList = sorted.slice(0, topCount);

  if (opts.json) {
    console.log(JSON.stringify({
      totalRx: packetData.rxPackets,
      totalTx: packetData.txPackets,
      activeConnections: packetData.connections,
      processes: displayList,
    }, null, 2));
    return;
  }

  console.log(chalk.bold('\n  🔥 pyre netusage — Per-Application Network Traffic\n'));

  const pidW = 8;
  const appW = 28;
  const rxW = 14;
  const txW = 14;
  const totalW = 14;
  const connsW = 8;

  const header =
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' PID    ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' APPLICATION                ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' DOWN (RX)    ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' UP (TX)      ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' TOTAL        ') +
    chalk.bold.hex('#f8f8f2').bgHex('#44475a')(' CONNS  ');

  console.log('  ' + header);
  console.log('  ' + chalk.dim('─'.repeat(pidW + appW + rxW + txW + totalW + connsW)));

  for (const p of displayList) {
    const pidStr = String(p.pid).padEnd(pidW);
    const appStr = (p.command.length > appW - 2 ? p.command.slice(0, appW - 3) + '…' : p.command).padEnd(appW);
    const rxStr = chalk.green(formatBytes(p.rxBytes).padStart(rxW - 2)) + '  ';
    const txStr = chalk.cyan(formatBytes(p.txBytes).padStart(txW - 2)) + '  ';
    const totStr = chalk.bold(formatBytes(p.totalBytes).padStart(totalW - 2)) + '  ';
    const connsStr = String(p.connections).padStart(connsW - 2);

    console.log(`  ${pidStr}${appStr}${rxStr}${txStr}${totStr}${connsStr}`);
  }

  console.log();
  console.log(chalk.dim(`  Total active socket connections: ${chalk.bold(String(packetData.connections))}  |  Showing top ${displayList.length} apps`));
  console.log();
}

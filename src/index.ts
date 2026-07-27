#!/usr/bin/env node
/**
 * pyre - Mac system monitoring CLI
 * Monitors temps, cpu, memory, disk, battery, and system stats.
 * Live mode is a full interactive dashboard: graphs, pause/resume,
 * on-demand snapshot export, and continuous CSV logging.
 */
import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { collectAll } from './monitors/index.js';
import { formatTable, formatJson, formatCsv, formatTsv } from './formatters/index.js';
import { startLive, stopLive } from './live/index.js';
import { showSplash } from './splash.js';

const program = new Command();

program
   .name('pyre')
   .version('2.0.0')
   .description('Mac system monitoring CLI: interactive live dashboard, stats, graphs, export, packet monitor, battery predictor')
   .option('-j, --json', 'Output as JSON')
   .option('-c, --csv', 'Output as CSV')
   .option('-t, --tsv', 'Output as TSV')
   .option('--detailed', 'Include detailed system info and sensor readings')
   .option('--interval <seconds>', 'Refresh interval for live mode', '2')
   .option('--once', 'Show a single static snapshot instead of live feed')
   .option('--out <file>', 'Also write the snapshot output to a file (--once/--json/--csv/--tsv modes)')
   .option('--export-dir <dir>', 'Directory used for live-mode snapshot exports and logs', './pyre-exports')
   .option('--log', 'Start continuous CSV logging immediately when live mode starts')
   .option('--tree', 'Show process tree view instead of flat list')
   .option('--sort <key>', 'Sort processes by: cpu, mem, pid, user, command, state, threads, runtime', 'cpu')
   .option('--packets', 'Include packet monitor panel in output')
   .option('--limit <n>', 'Max number of processes to include in --once/--json/--csv/--tsv snapshots (0 = all)', '10');

program.parse(process.argv);

const opts = program.opts();

function isExportMode() {
  return opts.json || opts.csv || opts.tsv;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

async function main() {
  const requestedLive = program.args[0] === 'live' || (!isExportMode() && !opts.once);
  if (requestedLive) {
    await showSplash();
    const interval = parseFloat(opts.interval) || 2;
    await startLive({
      interval,
      detailed: opts.detailed,
      exportDir: opts.exportDir,
      autoLog: opts.log,
    });
    return;
  }

  // `0` means "no cap" — collectProcesses treats an undefined limit as
  // unlimited by grabbing every row `ps` returns instead of head-limiting it.
  const requestedLimit = parseInt(opts.limit, 10);
  const processLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;

  const data = await collectAll({ detailed: opts.detailed, processLimit });

  let output: string;
  if (opts.json) output = formatJson(data);
  else if (opts.csv) output = formatCsv(data);
  else if (opts.tsv) output = formatTsv(data);
  else output = formatTable(data, { width: process.stdout.columns || 80, sortBy: opts.sort, treeView: opts.tree, visible: { packets: opts.packets ? true : undefined } });

  console.log(output);

  if (opts.out) {
    fs.writeFileSync(opts.out, stripAnsi(output));
    console.log(chalk.dim(`\nSaved to ${opts.out}`));
  }
}

main().catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  stopLive();
  process.exit(1);
});
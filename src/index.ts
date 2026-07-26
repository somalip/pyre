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
import { collectAll } from './monitors.js';
import { formatTable, formatJson, formatCsv, formatTsv } from './formatters.js';
import { startLive, stopLive } from './live.js';

const program = new Command();

program
  .name('pyre')
  .version('1.1.0')
  .description('Mac system monitoring CLI: interactive live dashboard, stats, graphs, export')
  .option('-j, --json', 'Output as JSON')
  .option('-c, --csv', 'Output as CSV')
  .option('-t, --tsv', 'Output as TSV')
  .option('--detailed', 'Include detailed system info and sensor readings')
  .option('--interval <seconds>', 'Refresh interval for live mode', '2')
  .option('--once', 'Show a single static snapshot instead of live feed')
  .option('--out <file>', 'Also write the snapshot output to a file (--once/--json/--csv/--tsv modes)')
  .option('--export-dir <dir>', 'Directory used for live-mode snapshot exports and logs', './pyre-exports')
  .option('--log', 'Start continuous CSV logging immediately when live mode starts');

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
    const interval = parseFloat(opts.interval) || 2;
    await startLive({
      interval,
      detailed: opts.detailed,
      exportDir: opts.exportDir,
      autoLog: opts.log,
    });
    return;
  }

  const data = await collectAll({ detailed: opts.detailed });

  let output: string;
  if (opts.json) output = formatJson(data);
  else if (opts.csv) output = formatCsv(data);
  else if (opts.tsv) output = formatTsv(data);
  else output = formatTable(data, { width: process.stdout.columns || 80 });

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
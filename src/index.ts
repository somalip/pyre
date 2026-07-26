#!/usr/bin/env node
/**
 * pyre - Mac system monitoring CLI
 * Monitors temps, cpu, memory, disk, battery, and system stats.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { collectAll } from './monitors.js';
import { formatTable, formatJson, formatCsv, formatTsv } from './formatters.js';
import { startLive, stopLive } from './live.js';

const program = new Command();

program
  .name('pyre')
  .version('1.0.0')
  .description('Mac system monitoring CLI: live dashboard, stats, export')
  .option('-j, --json', 'Output as JSON')
  .option('-c, --csv', 'Output as CSV')
  .option('-t, --tsv', 'Output as TSV')
  .option('--detailed', 'Include detailed system info and sensor readings')
  .option('--interval <seconds>', 'Refresh interval for live mode', '2')
  .option('--once', 'Show a single static snapshot instead of live feed');

program.parse(process.argv);

const opts = program.opts();

function isExportMode() {
  return opts.json || opts.csv || opts.tsv;
}

async function main() {
  const requestedLive = program.args[0] === 'live' || (!isExportMode() && !opts.once);
  if (requestedLive) {
    const interval = parseFloat(opts.interval) || 2;
    await startLive({ interval, detailed: opts.detailed });
    return;
  }

  const data = await collectAll({ detailed: opts.detailed });
  if (opts.json) {
    console.log(formatJson(data));
    return;
  }
  if (opts.csv) {
    console.log(formatCsv(data));
    return;
  }
  if (opts.tsv) {
    console.log(formatTsv(data));
    return;
  }

  console.log(formatTable(data));
}

main().catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  stopLive();
  process.exit(1);
});

import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { formatTable } from './formatters/render.js';
import type { StatsData } from './monitors/types.js';

export function runFleetCommand(hosts: string[]) {
  console.log(chalk.cyan(`Fetching data from ${hosts.length} hosts...`));
  const results: { host: string; data?: StatsData; error?: string }[] = [];

  for (const host of hosts) {
    try {
      // Connect to each host via ssh and run pyre
      const out = execSync(`ssh ${host} "pyre --once --json"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const data = JSON.parse(out) as StatsData;
      results.push({ host, data });
    } catch (e: any) {
      results.push({ host, error: e.message });
    }
  }

  // Very basic grid layout for fleet
  for (const result of results) {
    console.log(chalk.bold.blue(`\n=== ${result.host} ===\n`));
    if (result.error) {
      console.log(chalk.red(`Error connecting to host: ${result.error}`));
    } else if (result.data) {
      // Print a compact table for each host
      console.log(formatTable(result.data, { width: process.stdout.columns || 80, activePanel: 'grid' }));
    }
  }
}

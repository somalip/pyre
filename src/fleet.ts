import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { formatTable } from './formatters/render.js';
import type { StatsData } from './monitors/types.js';

const execAsync = promisify(exec);

export async function runFleetCommand(hosts: string[]): Promise<void> {
  console.log(chalk.cyan(`Fetching concurrent data from ${hosts.length} fleet host(s)...`));

  const promises = hosts.map(async (host) => {
    try {
      const { stdout } = await execAsync(`ssh -o ConnectTimeout=5 ${host} "pyre --once --json"`);
      const data = JSON.parse(stdout) as StatsData;
      return { host, data };
    } catch (e: any) {
      return { host, error: e.message || String(e) };
    }
  });

  const results = await Promise.all(promises);

  for (const result of results) {
    console.log(chalk.bold.blue(`\n=== Host: ${result.host} ===\n`));
    if (result.error) {
      console.log(chalk.red(`  ✖ Error connecting to host: ${result.error}`));
    } else if (result.data) {
      console.log(formatTable(result.data, { width: process.stdout.columns || 80, minimal: true }));
    }
  }
}

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { sparkline } from './sparkline.js';

export interface HistoryOptions {
  days?: number;
  dir?: string;
}

export function runHistoryCommand(opts: HistoryOptions = {}): void {
  const days = opts.days || 7;
  const dir = opts.dir || './pyre-exports';

  console.log(chalk.bold(`\n  pyre history — Past ${days} Days Trend\n`));

  if (!fs.existsSync(dir)) {
    console.log(chalk.yellow(`  No logs directory found at ${dir}`));
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.startsWith('pyre-log-') && f.endsWith('.csv'));
  if (files.length === 0) {
    console.log(chalk.yellow(`  No CSV logs found in ${dir}`));
    return;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const cpuPoints: number[] = [];
  const memPoints: number[] = [];
  const tempPoints: number[] = [];

  for (const file of files.sort()) {
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length >= 4) {
          const tsStr = parts[0];
          const ts = new Date(tsStr).getTime();
          if (!isNaN(ts) && ts >= cutoff) {
            const cpu = parseFloat(parts[1]);
            const mem = parseFloat(parts[2]);
            const temp = parseFloat(parts[3]);
            if (!isNaN(cpu)) cpuPoints.push(cpu);
            if (!isNaN(mem)) memPoints.push(mem);
            if (!isNaN(temp)) tempPoints.push(temp);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (cpuPoints.length === 0) {
    console.log(chalk.yellow(`  No historical entries recorded within the last ${days} days.`));
    return;
  }

  console.log(`  Data Points: ${cpuPoints.length} logged snapshots`);
  console.log(`  CPU Usage:   ${sparkline(cpuPoints, { min: 0, max: 100 })} (${(cpuPoints.reduce((a, b) => a + b, 0) / cpuPoints.length).toFixed(1)}% avg)`);
  console.log(`  Memory:      ${sparkline(memPoints, { min: 0, max: 100 })} (${(memPoints.reduce((a, b) => a + b, 0) / memPoints.length).toFixed(1)}% avg)`);
  if (tempPoints.length) {
    console.log(`  Temperature: ${sparkline(tempPoints)} (${(tempPoints.reduce((a, b) => a + b, 0) / tempPoints.length).toFixed(1)}°C avg)`);
  }
  console.log();
}

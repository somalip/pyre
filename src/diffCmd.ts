import fs from 'node:fs';
import chalk from 'chalk';
import type { StatsData } from './monitors/types.js';

export function runDiffCommand(file1: string, file2: string): void {
  console.log(chalk.bold(`\n  pyre diff — Snapshot Comparison\n`));
  console.log(chalk.dim(`  Snapshot A: ${file1}`));
  console.log(chalk.dim(`  Snapshot B: ${file2}\n`));

  try {
    const dataA: StatsData = JSON.parse(fs.readFileSync(file1, 'utf-8'));
    const dataB: StatsData = JSON.parse(fs.readFileSync(file2, 'utf-8'));

    const diffNum = (label: string, valA: number, valB: number, unit = '') => {
      const delta = valB - valA;
      const sign = delta > 0 ? '+' : '';
      const color = delta > 0 ? chalk.red : delta < 0 ? chalk.green : chalk.dim;
      console.log(`  ${label.padEnd(20)} ${valA.toFixed(1)}${unit} ➔ ${valB.toFixed(1)}${unit} (${color(sign + delta.toFixed(1) + unit)})`);
    };

    diffNum('CPU Usage', dataA.cpu.usage, dataB.cpu.usage, '%');
    diffNum('Memory Usage', dataA.memory.usagePercent, dataB.memory.usagePercent, '%');
    if (dataA.cpu.temperature && dataB.cpu.temperature) {
      diffNum('CPU Temp', dataA.cpu.temperature, dataB.cpu.temperature, '°C');
    }
    if (dataA.gpu && dataB.gpu) {
      diffNum('GPU Util', dataA.gpu.utilization, dataB.gpu.utilization, '%');
    }
    diffNum('Network RX Packets', dataA.network.rxPackets, dataB.network.rxPackets);
    diffNum('Network TX Packets', dataA.network.txPackets, dataB.network.txPackets);

    console.log();
  } catch (err: any) {
    console.log(chalk.red(`Failed to compare snapshots: ${err.message}`));
  }
}

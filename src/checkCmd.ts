import chalk from 'chalk';
import { collectAll } from './monitors/index.js';
import { formatBytes } from './formatters/render.js';

export interface CheckOptions {
  exitCode?: boolean;
  cpuAlertPct?: number;
  tempAlertC?: number;
  detailed?: boolean;
}

export async function runCheckCommand(opts: CheckOptions = {}): Promise<void> {
  const data = await collectAll({ detailed: opts.detailed });

  const cpuUsage = data.cpu.usage;
  const tempC = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die;
  const memUsage = data.memory.usagePercent;
  const disk = data.disk.mainVolume;

  const sentences: string[] = [];
  let isWarning = false;

  // CPU & Temp sentence
  const tempStr = tempC !== undefined ? `${Math.round(tempC)}°C` : null;
  const cpuAlertThreshold = opts.cpuAlertPct ?? 90;
  const tempAlertThreshold = opts.tempAlertC ?? 95;

  if (cpuUsage >= cpuAlertThreshold || (tempC !== undefined && tempC >= tempAlertThreshold)) {
    isWarning = true;
    if (tempStr) {
      sentences.push(`CPU running hot at ${tempStr}, ${Math.round(cpuUsage)}% used.`);
    } else {
      sentences.push(`CPU load is high at ${Math.round(cpuUsage)}% used.`);
    }
  } else {
    if (tempStr) {
      sentences.push(`CPU running cool at ${tempStr}, ${Math.round(cpuUsage)}% used.`);
    } else {
      sentences.push(`CPU running normally at ${Math.round(cpuUsage)}% used.`);
    }
  }

  // Memory & Battery sentence
  if (data.battery) {
    if (data.battery.friendlySummary) {
      if (data.battery.friendlySummary.toLowerCase().includes('service') || data.battery.friendlySummary.toLowerCase().includes('reduced')) {
        isWarning = true;
      }
      sentences.push(data.battery.friendlySummary);
    } else {
      let healthStr = 'health good';
      if (data.battery.health.toLowerCase().includes('service') || data.battery.health.toLowerCase().includes('check')) {
        healthStr = 'service recommended';
        isWarning = true;
      }
      sentences.push(`Battery at ${data.battery.level}%, ${healthStr}.`);
    }
  } else {
    sentences.push(`Memory at ${Math.round(memUsage)}% used.`);
  }

  // Disk sentence
  if (disk) {
    const freeBytes = disk.free;
    const freeStr = formatBytes(freeBytes);
    sentences.push(`${freeStr} free on ${disk.mount}.`);
    if (disk.usePercent >= 90) {
      isWarning = true;
    }
  }

  const summaryText = sentences.join(' ');

  if (isWarning) {
    console.log(chalk.yellow(`⚠ ${summaryText}`));
  } else {
    console.log(chalk.green(`✔ ${summaryText}`));
  }

  if (opts.exitCode && isWarning) {
    process.exit(1);
  }
}

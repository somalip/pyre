import chalk from 'chalk';
import { run } from './monitors/run.js';

export interface BrewHealthInfo {
  installedCount: number;
  outdatedCount: number;
  cellarSize: string;
  doctorWarnings: string[];
  brewAvailable: boolean;
}

export async function getBrewHealth(): Promise<BrewHealthInfo> {
  try {
    const brewPath = await run('which brew 2>&1', '');
    if (!brewPath.trim() || brewPath.includes('not found')) {
      return { installedCount: 0, outdatedCount: 0, cellarSize: 'N/A', doctorWarnings: [], brewAvailable: false };
    }

    // Outdated count without triggering brew update
    const outdatedRaw = await run('brew outdated --quiet 2>&1', '');
    const outdatedLines = outdatedRaw.trim().split('\n').filter(l => l.length > 0 && !l.startsWith('Homebrew') && !l.startsWith('==>'));

    // Installed list count
    const listRaw = await run('brew list --formula -1 2>&1', '');
    const listLines = listRaw.trim().split('\n').filter(l => l.length > 0);

    // Disk usage of cellar
    let cellarSize = 'N/A';
    try {
      const cellarPath = await run('brew --cellar 2>&1', '');
      if (cellarPath.trim()) {
        const duRaw = await run(`du -sh "${cellarPath.trim()}" 2>&1`, '');
        const duMatch = duRaw.match(/^([0-9\.\,]+[KMGTP]?i?B?)/i);
        if (duMatch) cellarSize = duMatch[1];
      }
    } catch {
      cellarSize = 'N/A';
    }

    // Doctor warnings
    const doctorRaw = await run('brew doctor 2>&1', '');
    const doctorWarnings: string[] = [];
    const docLines = doctorRaw.split('\n');
    for (const line of docLines) {
      if (line.startsWith('Warning:')) {
        doctorWarnings.push(line.replace(/^Warning:\s*/, '').trim());
      }
    }

    return {
      installedCount: listLines.length,
      outdatedCount: outdatedLines.length,
      cellarSize,
      doctorWarnings,
      brewAvailable: true,
    };
  } catch (err) {
    return { installedCount: 0, outdatedCount: 0, cellarSize: 'N/A', doctorWarnings: [], brewAvailable: false };
  }
}

export async function printBrewHealthReport(): Promise<void> {
  console.log(chalk.bold('\n  pyre brew — Homebrew Health Summary\n'));
  const health = await getBrewHealth();

  if (!health.brewAvailable) {
    console.log(chalk.yellow('  ⚠ Homebrew is not installed or not available on PATH.\n'));
    return;
  }

  console.log(`  📦 Installed Formulae: ${chalk.bold(health.installedCount)}`);
  console.log(`  ⏳ Outdated Packages:   ${health.outdatedCount > 0 ? chalk.yellow.bold(health.outdatedCount) : chalk.green('0 (Up to date)')}`);
  console.log(`  💾 Cellar Disk Usage:  ${chalk.bold(health.cellarSize)}`);

  console.log();
  if (health.doctorWarnings.length === 0) {
    console.log(chalk.green('  ✔ brew doctor: No warnings detected system-wide.'));
  } else {
    console.log(chalk.yellow(`  ⚠ brew doctor warnings (${health.doctorWarnings.length}):`));
    for (const warn of health.doctorWarnings.slice(0, 5)) {
      console.log(chalk.dim(`     • ${warn}`));
    }
    if (health.doctorWarnings.length > 5) {
      console.log(chalk.dim(`     ... and ${health.doctorWarnings.length - 5} more.`));
    }
  }
  console.log();
}

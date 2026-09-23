import chalk from 'chalk';
import { run } from './monitors/run.js';

export interface BrewHealthInfo {
  installedCount: number;
  outdatedCount: number;
  cellarSize: string;
  doctorWarnings: string[];
  brewAvailable: boolean;
  managerName: string;
}

export async function getBrewHealth(): Promise<BrewHealthInfo> {
  const isWindows = process.platform === 'win32';

  // 1. Try Homebrew (macOS or Linuxbrew)
  try {
    const brewPath = await run(isWindows ? 'where brew 2>nul' : 'which brew 2>&1', '');
    if (brewPath.trim() && !brewPath.includes('not found') && !brewPath.includes('Could not find')) {
      const outdatedRaw = await run('brew outdated --quiet 2>&1', '');
      const outdatedLines = outdatedRaw.trim().split('\n').filter(l => l.length > 0 && !l.startsWith('Homebrew') && !l.startsWith('==>'));

      const listRaw = await run('brew list --formula -1 2>&1', '');
      const listLines = listRaw.trim().split('\n').filter(l => l.length > 0);

      let cellarSize = 'N/A';
      try {
        const cellarPath = await run('brew --cellar 2>&1', '');
        if (cellarPath.trim()) {
          const duRaw = await run(`du -sh "${cellarPath.trim()}" 2>&1`, '');
          const duMatch = duRaw.match(/^([0-9.,]+[KMGTP]?i?B?)/i);
          if (duMatch) cellarSize = duMatch[1];
        }
      } catch {
        cellarSize = 'N/A';
      }

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
        managerName: 'Homebrew',
      };
    }
  } catch {
    // continue to alternative managers
  }

  // 2. Linux Package Managers (APT, DNF, Pacman)
  if (process.platform === 'linux') {
    // Try APT
    try {
      const whichApt = (await run('which apt-get 2>/dev/null', '')).trim();
      if (whichApt) {
        const listRaw = (await run('dpkg-query -l 2>/dev/null', '')).trim();
        const installed = listRaw ? listRaw.split('\n').filter(l => l.startsWith('ii')).length : 0;
        const upgradeRaw = (await run('apt list --upgradable 2>/dev/null', '')).trim();
        const outdated = upgradeRaw ? upgradeRaw.split('\n').filter(l => l.includes('/') && !l.startsWith('Listing')).length : 0;
        return {
          installedCount: installed,
          outdatedCount: outdated,
          cellarSize: '/var/cache/apt',
          doctorWarnings: [],
          brewAvailable: true,
          managerName: 'APT (Debian/Ubuntu)',
        };
      }
    } catch {
      // ignore
    }

    // Try Pacman
    try {
      const whichPacman = (await run('which pacman 2>/dev/null', '')).trim();
      if (whichPacman) {
        const listRaw = (await run('pacman -Q 2>/dev/null', '')).trim();
        const installed = listRaw ? listRaw.split('\n').filter(Boolean).length : 0;
        const upgradeRaw = (await run('checkupdates 2>/dev/null || pacman -Qu 2>/dev/null', '')).trim();
        const outdated = upgradeRaw ? upgradeRaw.split('\n').filter(Boolean).length : 0;
        return {
          installedCount: installed,
          outdatedCount: outdated,
          cellarSize: '/var/cache/pacman',
          doctorWarnings: [],
          brewAvailable: true,
          managerName: 'Pacman (Arch)',
        };
      }
    } catch {
      // ignore
    }

    // Try DNF
    try {
      const whichDnf = (await run('which dnf 2>/dev/null', '')).trim();
      if (whichDnf) {
        const listRaw = (await run('dnf list installed 2>/dev/null', '')).trim();
        const installed = listRaw ? listRaw.split('\n').filter(Boolean).length - 1 : 0;
        return {
          installedCount: Math.max(0, installed),
          outdatedCount: 0,
          cellarSize: '/var/cache/dnf',
          doctorWarnings: [],
          brewAvailable: true,
          managerName: 'DNF (Fedora/RHEL)',
        };
      }
    } catch {
      // ignore
    }
  }

  // 3. Windows Package Managers (winget, choco, scoop)
  if (isWindows) {
    // Try winget
    try {
      const whichWinget = (await run('where winget 2>nul', '')).trim();
      if (whichWinget) {
        const listRaw = (await run('winget list 2>nul', '', 4000)).trim();
        const installed = listRaw ? listRaw.split('\n').filter(Boolean).length - 2 : 0;
        return {
          installedCount: Math.max(0, installed),
          outdatedCount: 0,
          cellarSize: 'N/A',
          doctorWarnings: [],
          brewAvailable: true,
          managerName: 'Windows Package Manager (winget)',
        };
      }
    } catch {
      // ignore
    }

    // Try scoop
    try {
      const whichScoop = (await run('where scoop 2>nul', '')).trim();
      if (whichScoop) {
        const listRaw = (await run('scoop list 2>nul', '')).trim();
        const installed = listRaw ? listRaw.split('\n').filter(Boolean).length - 4 : 0;
        return {
          installedCount: Math.max(0, installed),
          outdatedCount: 0,
          cellarSize: 'N/A',
          doctorWarnings: [],
          brewAvailable: true,
          managerName: 'Scoop',
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    installedCount: 0,
    outdatedCount: 0,
    cellarSize: 'N/A',
    doctorWarnings: [],
    brewAvailable: false,
    managerName: 'None',
  };
}

export async function printBrewHealthReport(): Promise<void> {
  const health = await getBrewHealth();
  const label = health.brewAvailable ? health.managerName : 'Package Manager';
  console.log(chalk.bold(`\n  pyre brew — ${label} Health Summary\n`));

  if (!health.brewAvailable) {
    console.log(chalk.yellow('  ⚠ No supported package manager detected on PATH.\n'));
    return;
  }

  console.log(`  📦 Package Manager:    ${chalk.cyan.bold(health.managerName)}`);
  console.log(`  📦 Installed Packages: ${chalk.bold(health.installedCount)}`);
  console.log(`  ⏳ Outdated Packages:  ${health.outdatedCount > 0 ? chalk.yellow.bold(health.outdatedCount) : chalk.green('0 (Up to date)')}`);
  if (health.cellarSize !== 'N/A') {
    console.log(`  💾 Cache / Cellar:     ${chalk.bold(health.cellarSize)}`);
  }

  console.log();
  if (health.doctorWarnings.length === 0) {
    console.log(chalk.green(`  ✔ ${health.managerName}: Ready and healthy.`));
  } else {
    console.log(chalk.yellow(`  ⚠ Diagnostics warnings (${health.doctorWarnings.length}):`));
    for (const warn of health.doctorWarnings.slice(0, 5)) {
      console.log(chalk.dim(`     • ${warn}`));
    }
    if (health.doctorWarnings.length > 5) {
      console.log(chalk.dim(`     ... and ${health.doctorWarnings.length - 5} more.`));
    }
  }
  console.log();
}

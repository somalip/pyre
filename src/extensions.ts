import chalk from 'chalk';
import { run } from './monitors/run.js';

export interface SystemExtensionInfo {
  teamId: string;
  bundleId: string;
  version: string;
  state: string;
  category: string;
}

export async function getSystemExtensions(): Promise<{ category: string; extensions: SystemExtensionInfo[] }[]> {
  const platform = process.platform;
  if (platform === 'linux') return getLinuxExtensions();
  if (platform === 'win32') return getWindowsExtensions();

  try {
    const raw = await run('systemextensionsctl list 2>&1', '');
    return parseSystemExtensionsOutput(raw);
  } catch (err) {
    return [];
  }
}

export function parseSystemExtensionsOutput(output: string): { category: string; extensions: SystemExtensionInfo[] }[] {
  const result: { category: string; extensions: SystemExtensionInfo[] }[] = [];
  let currentCategory = 'Other Extensions';
  let currentList: SystemExtensionInfo[] = [];

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('--- category') || trimmed.startsWith('--- ')) {
      if (currentList.length > 0 || result.length > 0) {
        result.push({ category: currentCategory, extensions: currentList });
        currentList = [];
      }
      const catMatch = trimmed.match(/category\s+([\w.-]+)/i);
      currentCategory = catMatch ? catMatch[1] : trimmed.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
      continue;
    }

    const extMatch = trimmed.match(/^(?:\*\s*)*([A-Z0-9]{10}|\?\?\?\?\?\?\?\?\?\?)\s+([\w.-]+)\s+\(([^)]+)\)\s+\[([^\]]+)\]/i);
    if (extMatch) {
      currentList.push({
        teamId: extMatch[1],
        bundleId: extMatch[2],
        version: extMatch[3],
        state: extMatch[4],
        category: currentCategory,
      });
    }
  }

  if (currentList.length > 0 || result.length === 0) {
    result.push({ category: currentCategory, extensions: currentList });
  }

  return result.filter(group => group.extensions.length > 0 || result.length === 1);
}

async function getLinuxExtensions(): Promise<{ category: string; extensions: SystemExtensionInfo[] }[]> {
  try {
    const raw = await run('lsmod 2>/dev/null', '');
    const lines = raw.trim().split('\n').slice(1);
    const extensions: SystemExtensionInfo[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const modName = parts[0];
        const sizeBytes = parts[1];
        const usedBy = parts.slice(3).join(' ') || 'none';
        extensions.push({
          teamId: 'KERNEL',
          bundleId: modName,
          version: `${sizeBytes} bytes`,
          state: `used by: ${usedBy}`,
          category: 'Kernel Modules',
        });
      }
    }
    return extensions.length > 0 ? [{ category: 'Linux Kernel Modules', extensions }] : [];
  } catch {
    return [];
  }
}

async function getWindowsExtensions(): Promise<{ category: string; extensions: SystemExtensionInfo[] }[]> {
  try {
    const raw = await run('driverquery /fo csv /nh 2>nul', '', 3000);
    const lines = raw.trim().split('\n');
    const extensions: SystemExtensionInfo[] = [];

    for (const line of lines) {
      const parts = line.split('","').map(s => s.replace(/(^"|"$)/g, '').trim());
      if (parts.length >= 3) {
        const modName = parts[0];
        const dispName = parts[1];
        const driverType = parts[2];
        extensions.push({
          teamId: driverType,
          bundleId: modName,
          version: dispName,
          state: 'active',
          category: 'Device Drivers',
        });
      }
    }
    return extensions.length > 0 ? [{ category: 'Windows Device Drivers', extensions }] : [];
  } catch {
    return [];
  }
}

export async function printExtensionsReport(): Promise<void> {
  const osLabel = process.platform === 'darwin' ? 'macOS System Extensions' : (process.platform === 'win32' ? 'Windows Drivers' : 'Linux Kernel Modules');
  console.log(chalk.bold(`\n  pyre extensions — ${osLabel} Inspector\n`));
  const categories = await getSystemExtensions();

  let totalCount = 0;
  for (const cat of categories) {
    totalCount += cat.extensions.length;
    console.log(chalk.cyan.bold(`  📂 ${cat.category}`));
    if (cat.extensions.length === 0) {
      console.log(chalk.dim('     (No extensions registered in this category)'));
      continue;
    }
    // Limit display so large module/driver tables do not overwhelm the terminal
    const maxShow = 25;
    for (const ext of cat.extensions.slice(0, maxShow)) {
      const stateColor = ext.state.includes('activated') || ext.state.includes('enabled') || ext.state.includes('active') ? chalk.green : chalk.yellow;
      console.log(`     • ${chalk.bold(ext.bundleId)} (${ext.version})`);
      console.log(chalk.dim(`       Type/Team: ${ext.teamId} | State: `) + stateColor(ext.state));
    }
    if (cat.extensions.length > maxShow) {
      console.log(chalk.dim(`     ... and ${cat.extensions.length - maxShow} more.`));
    }
    console.log();
  }

  if (totalCount === 0) {
    console.log(chalk.dim('  No active extensions/modules detected on this system.\n'));
  }
}

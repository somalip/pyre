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
      const catMatch = trimmed.match(/category\s+([\w\.-]+)/i);
      currentCategory = catMatch ? catMatch[1] : trimmed.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
      continue;
    }

    const extMatch = trimmed.match(/^(?:\*\s*)*([A-Z0-9]{10}|\?\?\?\?\?\?\?\?\?\?)\s+([\w\.-]+)\s+\(([^)]+)\)\s+\[([^\]]+)\]/i);
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

export async function printExtensionsReport(): Promise<void> {
  console.log(chalk.bold('\n  pyre extensions — System Extensions Inspector\n'));
  const categories = await getSystemExtensions();

  let totalCount = 0;
  for (const cat of categories) {
    totalCount += cat.extensions.length;
    console.log(chalk.cyan.bold(`  📂 ${cat.category}`));
    if (cat.extensions.length === 0) {
      console.log(chalk.dim('     (No extensions registered in this category)'));
      continue;
    }
    for (const ext of cat.extensions) {
      const stateColor = ext.state.includes('activated') || ext.state.includes('enabled') ? chalk.green : chalk.yellow;
      console.log(`     • ${chalk.bold(ext.bundleId)} (${ext.version})`);
      console.log(chalk.dim(`       Team: ${ext.teamId} | State: `) + stateColor(ext.state));
    }
    console.log();
  }

  if (totalCount === 0) {
    console.log(chalk.dim('  No active system extensions detected on this system.\n'));
  }
}

/**
 * pyre sweep — Developer & project cruft sweeper.
 *
 * Scans directories for heavy reclaimable build and dependency directories
 * (node_modules, target, .venv, DerivedData, .build, etc.), with safety
 * checks for uncommitted git changes and inactive project filtering.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import chalk from 'chalk';
import { formatBytes } from './formatters/render.js';

export interface CruftTarget {
  name: string;
  category: string;
}

export const KNOWN_TARGETS: CruftTarget[] = [
  { name: 'node_modules', category: 'Node / JavaScript' },
  { name: 'target', category: 'Rust / Cargo' },
  { name: '.venv', category: 'Python Virtualenv' },
  { name: 'venv', category: 'Python Virtualenv' },
  { name: '__pycache__', category: 'Python Cache' },
  { name: '.pytest_cache', category: 'Python Test Cache' },
  { name: '.build', category: 'Swift / SPM' },
  { name: 'DerivedData', category: 'Xcode' },
  { name: '.gradle', category: 'Gradle Cache' },
  { name: 'coverage', category: 'Test Coverage' },
  { name: '.turbo', category: 'Turborepo Cache' },
];

export interface CruftItem {
  path: string;
  targetName: string;
  category: string;
  projectDir: string;
  sizeBytes: number;
  lastModifiedMs: number;
  isGitRepo: boolean;
  isGitDirty: boolean;
}

export interface SweepOptions {
  path?: string;
  targets?: string[];
  inactiveDays?: number;
  excludeDirty?: boolean;
  clean?: boolean;
  yes?: boolean;
  json?: boolean;
  maxDepth?: number;
}

export function getDirSizeBytes(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirSizeBytes(full);
        } else if (entry.isFile()) {
          const stats = fs.statSync(full);
          total += stats.size;
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  } catch {
    // Skip
  }
  return total;
}

export function checkGitStatus(dirPath: string): { isGitRepo: boolean; isGitDirty: boolean } {
  try {
    const isRepo = fs.existsSync(path.join(dirPath, '.git'));
    if (!isRepo) {
      return { isGitRepo: false, isGitDirty: false };
    }
    const status = execSync('git status --porcelain', {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return { isGitRepo: true, isGitDirty: status.trim().length > 0 };
  } catch {
    return { isGitRepo: false, isGitDirty: false };
  }
}

export function scanForCruft(searchRoot: string, opts: SweepOptions = {}): CruftItem[] {
  const items: CruftItem[] = [];
  const maxDepth = opts.maxDepth ?? 4;
  const inactiveDays = opts.inactiveDays ?? 0;
  const now = Date.now();
  const allowedNames = opts.targets && opts.targets.length > 0
    ? new Set(opts.targets)
    : new Set(KNOWN_TARGETS.map(t => t.name));

  const targetCategoryMap = new Map<string, string>();
  for (const t of KNOWN_TARGETS) {
    targetCategoryMap.set(t.name, t.category);
  }

  function traverse(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(currentDir, entry.name);

      // Check if entry matches a cruft target
      if (allowedNames.has(entry.name)) {
        try {
          const stats = fs.statSync(fullPath);
          const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);

          if (inactiveDays > 0 && ageDays < inactiveDays) {
            // Not inactive enough
            continue;
          }

          const gitInfo = checkGitStatus(currentDir);
          if (opts.excludeDirty && gitInfo.isGitDirty) {
            continue;
          }

          const size = getDirSizeBytes(fullPath);
          items.push({
            path: fullPath,
            targetName: entry.name,
            category: targetCategoryMap.get(entry.name) || 'Build Artifact',
            projectDir: currentDir,
            sizeBytes: size,
            lastModifiedMs: stats.mtimeMs,
            isGitRepo: gitInfo.isGitRepo,
            isGitDirty: gitInfo.isGitDirty,
          });
        } catch {
          // ignore
        }
        // Do not traverse deeper into the cruft directory itself
        continue;
      }

      // Skip traversing into hidden directories like .git
      if (entry.name.startsWith('.') && entry.name !== '.build') {
        continue;
      }

      traverse(fullPath, currentDepth + 1);
    }
  }

  traverse(path.resolve(searchRoot), 0);
  return items;
}

export async function runSweepCommand(opts: SweepOptions = {}): Promise<void> {
  const targetPath = opts.path ? path.resolve(opts.path) : process.cwd();

  if (!fs.existsSync(targetPath)) {
    console.error(chalk.red(`  ✖ Search path does not exist: ${targetPath}`));
    process.exit(1);
  }

  if (!opts.json) {
    console.log(chalk.bold(`\n  pyre sweep — Developer & Project Cruft Sweeper`));
    console.log(chalk.dim(`  Scanning: ${targetPath} (Depth <= ${opts.maxDepth ?? 4})...\n`));
  }

  const items = scanForCruft(targetPath, opts);
  const totalReclaimableBytes = items.reduce((acc, item) => acc + item.sizeBytes, 0);

  if (opts.json) {
    console.log(JSON.stringify({
      root: targetPath,
      totalBytes: totalReclaimableBytes,
      totalFormatted: formatBytes(totalReclaimableBytes),
      itemsCount: items.length,
      items,
    }, null, 2));
    return;
  }

  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 78;

  if (items.length === 0) {
    console.log(border('┌' + '─'.repeat(W) + '┐'));
    console.log(border('│') + chalk.green.bold('  ✔ CLEAN: No matching build cruft found in workspace!').padEnd(W + 9) + border('│'));
    console.log(border('└' + '─'.repeat(W) + '┘\n'));
    return;
  }

  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // DEVELOPER & BUILD ARTIFACT SWEEPER') + ' '.repeat(W - 48) + chalk.cyan('[RECLAMATION]') + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + `  SCAN ROOT: ${dim(targetPath.slice(0, 40).padEnd(42))}  ARTIFACTS: ${chalk.bold(String(items.length).padEnd(4))} RECLAIMABLE: ${chalk.green.bold(formatBytes(totalReclaimableBytes))}`.padEnd(W + 20) + border('│'));
  console.log(border('├──────────────────────┬──────────────────────┬──────────┬───────┬───────────────┤'));
  console.log(border('│') + ' TARGET DIRECTORY     ' + border('│') + ' CATEGORY             ' + border('│') + ' SIZE     ' + border('│') + ' AGE   ' + border('│') + ' GIT STATUS     ' + border('│'));
  console.log(border('├──────────────────────┼──────────────────────┼──────────┼───────┼───────────────┤'));

  for (const item of items) {
    const ageDays = Math.round((Date.now() - item.lastModifiedMs) / (1000 * 60 * 60 * 24));
    const gitBadge = item.isGitDirty ? chalk.yellow('DIRTY') : item.isGitRepo ? chalk.green('CLEAN') : chalk.dim('NO-GIT');
    const targetCol = chalk.cyan((item.targetName.length > 20 ? item.targetName.slice(0, 19) + '…' : item.targetName).padEnd(20));
    const catCol = (item.category.length > 20 ? item.category.slice(0, 19) + '…' : item.category).padEnd(20);
    const sizeCol = chalk.bold(formatBytes(item.sizeBytes).padEnd(8));
    const ageCol = (ageDays + 'd').padEnd(5);

    console.log(border('│') + ` ${targetCol} ` + border('│') + ` ${dim(catCol)} ` + border('│') + ` ${sizeCol} ` + border('│') + ` ${ageCol} ` + border('│') + ` ${gitBadge.padEnd(17)} ` + border('│'));
  }

  console.log(border('└──────────────────────┴──────────────────────┴──────────┴───────┴───────────────┘'));
  console.log();

  if (opts.clean) {
    let confirm = opts.yes;
    if (!confirm) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(chalk.yellow(`  [ACTION REQUIRED] Permanently delete these ${items.length} directories? (y/N): `));
        confirm = answer.trim().toLowerCase() === 'y';
      } finally {
        rl.close();
      }
    }

    if (confirm) {
      let deletedCount = 0;
      let freedBytes = 0;
      for (const item of items) {
        try {
          fs.rmSync(item.path, { recursive: true, force: true });
          deletedCount++;
          freedBytes += item.sizeBytes;
        } catch (err: any) {
          console.error(chalk.red(`    ✖ Error deleting ${item.path}: ${err.message}`));
        }
      }
      console.log(chalk.green(`\n  ✔ RECLAIMED: ${formatBytes(freedBytes)} freed across ${deletedCount} directories.\n`));
    } else {
      console.log(chalk.dim(`  Deletion cancelled. Zero bytes modified.\n`));
    }
  } else {
    console.log(chalk.dim(`  Tip: Run 'pyre sweep --clean' to delete measured artifacts or 'pyre sweep --json'.\n`));
  }
}

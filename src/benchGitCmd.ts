/**
 * pyre bench-git — Git Branch Performance Differ.
 *
 * Automatically benchmarks a test or build command across two git branches
 * or commits, computing delta percentages for execution duration, peak RAM,
 * and CPU utilization.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { runWithBudget, formatBytes } from './budgetCmd.js';

export interface BranchMetric {
  branch: string;
  durationSec: number;
  peakMemoryBytes: number;
  peakCpuPct: number;
  exitCode: number;
}

export async function runBenchGitCommand(branchA: string, branchB: string, commandStr: string): Promise<void> {
  // 1. Verify git repo and clean status
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    if (status) {
      console.error(chalk.red('\n  ✖ Working directory contains uncommitted changes.'));
      console.log(chalk.yellow('  Please commit or stash your changes before running `pyre bench-git`.\n'));
      return;
    }
  } catch (err: any) {
    console.error(chalk.red(`\n  ✖ Not a git repository: ${err.message}`));
    return;
  }

  const startingBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  console.log(chalk.bold(`\n  🔥 pyre bench-git — Cross-Branch Performance Differ\n`));
  console.log(chalk.dim(`  Command:         ${commandStr}`));
  console.log(chalk.dim(`  Baseline Branch: ${branchA}`));
  console.log(chalk.dim(`  Target Branch:   ${branchB}`));
  console.log(chalk.dim(`  Current Branch:  ${startingBranch}\n`));

  const tokens = commandStr.split(/\s+/).filter(Boolean);

  try {
    // Benchmark Branch A
    console.log(chalk.bold.cyan(`▶ [1/2] Checking out '${branchA}' and benchmarking...`));
    execSync(`git checkout ${branchA}`, { stdio: 'pipe' });
    const resA = await runWithBudget(tokens, {});

    // Benchmark Branch B
    console.log(chalk.bold.cyan(`\n▶ [2/2] Checking out '${branchB}' and benchmarking...`));
    execSync(`git checkout ${branchB}`, { stdio: 'pipe' });
    const resB = await runWithBudget(tokens, {});

    // Restore original branch
    execSync(`git checkout ${startingBranch}`, { stdio: 'pipe' });
    console.log(chalk.dim(`\n  Restored workspace to '${startingBranch}'.`));

    // Print side-by-side comparison
    printGitComparisonTable(branchA, branchB, resA, resB);
  } catch (err: any) {
    // Ensure we attempt to restore branch
    try {
      execSync(`git checkout ${startingBranch}`, { stdio: 'pipe' });
    } catch {}
    console.error(chalk.red(`\n  ✖ Benchmark failed: ${err.message}`));
  }
}

function printGitComparisonTable(branchA: string, branchB: string, resA: any, resB: any) {
  const diffPct = (valA: number, valB: number, invertGood = false) => {
    if (valA === 0) return '0%';
    const delta = ((valB - valA) / valA) * 100;
    const sign = delta > 0 ? '+' : '';
    const formatted = `${sign}${delta.toFixed(1)}%`;
    const isGood = invertGood ? delta > 0 : delta < 0;
    const color = delta === 0 ? chalk.dim : isGood ? chalk.green : chalk.red;
    return color(formatted);
  };

  console.log(chalk.bold('\n  ─────────────────────────────────────────────────────────────'));
  console.log(chalk.bold('  🔥 Cross-Branch Performance Comparison Results'));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));

  const colBranchA = branchA.padEnd(16);
  const colBranchB = branchB.padEnd(16);
  console.log(`  ${'Metric'.padEnd(18)} ${colBranchA} ${colBranchB} Delta`);
  console.log(chalk.dim('  ─'.repeat(30)));

  // Duration
  const durA = `${resA.durationSec.toFixed(2)}s`.padEnd(16);
  const durB = `${resB.durationSec.toFixed(2)}s`.padEnd(16);
  console.log(`  ${'Duration'.padEnd(18)} ${durA} ${durB} ${diffPct(resA.durationSec, resB.durationSec)}`);

  // Peak RAM
  const ramA = formatBytes(resA.peakMemoryBytes).padEnd(16);
  const ramB = formatBytes(resB.peakMemoryBytes).padEnd(16);
  console.log(`  ${'Peak Memory'.padEnd(18)} ${ramA} ${ramB} ${diffPct(resA.peakMemoryBytes, resB.peakMemoryBytes)}`);

  // Peak CPU
  const cpuA = `${resA.peakCpuPct.toFixed(1)}%`.padEnd(16);
  const cpuB = `${resB.peakCpuPct.toFixed(1)}%`.padEnd(16);
  console.log(`  ${'Peak CPU'.padEnd(18)} ${cpuA} ${cpuB} ${diffPct(resA.peakCpuPct, resB.peakCpuPct)}`);

  // Exit code
  const codeA = `${resA.exitCode}`.padEnd(16);
  const codeB = `${resB.exitCode}`.padEnd(16);
  console.log(`  ${'Exit Code'.padEnd(18)} ${codeA} ${codeB}`);

  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────\n'));
}

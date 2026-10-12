/**
 * pyre run — Performance Budgeting Runner.
 *
 * Spawns an arbitrary command and tracks its execution lifecycle,
 * measuring runtime duration, peak RSS memory, and CPU utilization.
 * Enforces budgets (--budget-cpu, --budget-mem, --budget-time), exiting
 * with code 124 if thresholds are exceeded (ideal for CI/CD gates).
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

export interface BudgetLimits {
  maxCpuPct?: number;
  maxMemoryBytes?: number;
  maxTimeSec?: number;
}

export interface BudgetRunResult {
  command: string;
  exitCode: number;
  durationSec: number;
  peakCpuPct: number;
  avgCpuPct: number;
  peakMemoryBytes: number;
  violations: string[];
}

export function parseBytesString(s: string): number {
  const trimmed = s.trim().toUpperCase();
  const num = parseFloat(trimmed);
  if (isNaN(num)) return 0;
  if (trimmed.endsWith('G') || trimmed.endsWith('GB')) return num * 1024 * 1024 * 1024;
  if (trimmed.endsWith('M') || trimmed.endsWith('MB')) return num * 1024 * 1024;
  if (trimmed.endsWith('K') || trimmed.endsWith('KB')) return num * 1024;
  return num;
}

export function formatBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export async function runWithBudget(
  commandArgs: string[],
  budgets: BudgetLimits,
  opts?: { markdown?: boolean; outFile?: string }
): Promise<BudgetRunResult> {
  if (commandArgs.length === 0) {
    throw new Error('No command specified. Usage: pyre run [budget flags] -- <command>');
  }

  const cmdStr = commandArgs.join(' ');
  const [bin, ...args] = commandArgs;

  const startTime = Date.now();
  const cpuSamples: number[] = [];
  let peakMemBytes = 0;
  let peakCpu = 0;

  const child = spawn(bin, args, {
    stdio: 'inherit',
    env: process.env,
  });

  const pid = child.pid;
  let sampleInterval: NodeJS.Timeout | null = null;

  if (pid) {
    sampleInterval = setInterval(() => {
      try {
        // Sample RSS memory using ps
        const { execSync } = require('node:child_process');
        const output = execSync(`ps -o %cpu,rss -p ${pid} 2>/dev/null`, { encoding: 'utf-8' });
        const lines = output.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          const cpu = parseFloat(parts[0]) || 0;
          const rssKb = parseInt(parts[1], 10) || 0;
          const memBytes = rssKb * 1024;

          cpuSamples.push(cpu);
          if (cpu > peakCpu) peakCpu = cpu;
          if (memBytes > peakMemBytes) peakMemBytes = memBytes;
        }
      } catch {
        // Child exited
      }
    }, 100);
  }

  const exitCode = await new Promise<number>((resolve) => {
    child.on('close', (code) => {
      if (sampleInterval) clearInterval(sampleInterval);
      resolve(code ?? 0);
    });
    child.on('error', () => {
      if (sampleInterval) clearInterval(sampleInterval);
      resolve(1);
    });
  });

  const durationSec = (Date.now() - startTime) / 1000;
  const avgCpu = cpuSamples.length > 0 ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : peakCpu;

  // Evaluate budget limits
  const violations: string[] = [];
  if (budgets.maxTimeSec !== undefined && durationSec > budgets.maxTimeSec) {
    violations.push(`Runtime exceeded budget: ${durationSec.toFixed(2)}s > ${budgets.maxTimeSec}s limit`);
  }
  if (budgets.maxMemoryBytes !== undefined && peakMemBytes > budgets.maxMemoryBytes) {
    violations.push(`Memory exceeded budget: ${formatBytes(peakMemBytes)} > ${formatBytes(budgets.maxMemoryBytes)} limit`);
  }
  if (budgets.maxCpuPct !== undefined && peakCpu > budgets.maxCpuPct) {
    violations.push(`CPU exceeded budget: ${peakCpu.toFixed(1)}% > ${budgets.maxCpuPct}% limit`);
  }

  const result: BudgetRunResult = {
    command: cmdStr,
    exitCode,
    durationSec,
    peakCpuPct: peakCpu,
    avgCpuPct: avgCpu,
    peakMemoryBytes: peakMemBytes,
    violations,
  };

  printBudgetReport(result, budgets, opts);
  return result;
}

function printBudgetReport(result: BudgetRunResult, budgets: BudgetLimits, opts?: { markdown?: boolean; outFile?: string }) {
  const isViolated = result.violations.length > 0;
  const isFailed = result.exitCode !== 0 || isViolated;

  console.log(chalk.bold('\n  ─────────────────────────────────────────────────────────────'));
  console.log(chalk.bold(`  🔥 pyre run — Performance Budget Report`));
  console.log(chalk.dim(`  Command: ${result.command}`));
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));

  // Table rows
  const statusTime = budgets.maxTimeSec === undefined
    ? chalk.dim('unconstrained')
    : result.durationSec <= budgets.maxTimeSec
    ? chalk.green(`✔ Pass (<= ${budgets.maxTimeSec}s)`)
    : chalk.red(`✖ FAIL (> ${budgets.maxTimeSec}s)`);

  const statusMem = budgets.maxMemoryBytes === undefined
    ? chalk.dim('unconstrained')
    : result.peakMemoryBytes <= budgets.maxMemoryBytes
    ? chalk.green(`✔ Pass (<= ${formatBytes(budgets.maxMemoryBytes)})`)
    : chalk.red(`✖ FAIL (> ${formatBytes(budgets.maxMemoryBytes)})`);

  const statusCpu = budgets.maxCpuPct === undefined
    ? chalk.dim('unconstrained')
    : result.peakCpuPct <= budgets.maxCpuPct
    ? chalk.green(`✔ Pass (<= ${budgets.maxCpuPct}%)`)
    : chalk.red(`✖ FAIL (> ${budgets.maxCpuPct}%)`);

  console.log(`  Duration:    ${result.durationSec.toFixed(2)}s`.padEnd(28) + statusTime);
  console.log(`  Peak Memory: ${formatBytes(result.peakMemoryBytes)}`.padEnd(28) + statusMem);
  console.log(`  Peak CPU:    ${result.peakCpuPct.toFixed(1)}% (avg ${result.avgCpuPct.toFixed(1)}%)`.padEnd(28) + statusCpu);
  console.log(`  Exit Code:   ${result.exitCode === 0 ? chalk.green('0') : chalk.red(result.exitCode)}`);

  if (isViolated) {
    console.log(chalk.bold.red('\n  ✖ Performance Budget Violations:'));
    result.violations.forEach((v) => console.log(chalk.red(`    • ${v}`)));
  }

  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────\n'));

  if (opts?.outFile || opts?.markdown) {
    const md = generateMarkdownBudgetReport(result, budgets);
    if (opts.outFile) {
      fs.writeFileSync(opts.outFile, md, 'utf-8');
      console.log(chalk.dim(`  Saved report to ${opts.outFile}\n`));
    }
  }
}

function generateMarkdownBudgetReport(result: BudgetRunResult, budgets: BudgetLimits): string {
  return [
    `# Pyre Performance Budget Report`,
    ``,
    `**Command**: \`${result.command}\`  `,
    `**Status**: ${result.violations.length === 0 && result.exitCode === 0 ? '✅ PASSED' : '❌ FAILED'}  `,
    `**Exit Code**: \`${result.exitCode}\`  `,
    ``,
    `| Metric | Measured | Limit | Status |`,
    `| :--- | :--- | :--- | :--- |`,
    `| Duration | ${result.durationSec.toFixed(2)}s | ${budgets.maxTimeSec ? budgets.maxTimeSec + 's' : 'N/A'} | ${budgets.maxTimeSec && result.durationSec > budgets.maxTimeSec ? '❌ FAIL' : '✅ PASS'} |`,
    `| Peak Memory | ${formatBytes(result.peakMemoryBytes)} | ${budgets.maxMemoryBytes ? formatBytes(budgets.maxMemoryBytes) : 'N/A'} | ${budgets.maxMemoryBytes && result.peakMemoryBytes > budgets.maxMemoryBytes ? '❌ FAIL' : '✅ PASS'} |`,
    `| Peak CPU | ${result.peakCpuPct.toFixed(1)}% | ${budgets.maxCpuPct ? budgets.maxCpuPct + '%' : 'N/A'} | ${budgets.maxCpuPct && result.peakCpuPct > budgets.maxCpuPct ? '❌ FAIL' : '✅ PASS'} |`,
    ``,
    ...(result.violations.length > 0 ? [`### Violations`, ...result.violations.map((v) => `- ${v}`)] : []),
  ].join('\n');
}

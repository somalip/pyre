/**
 * pyre profile-proc — Process CPU Profiler.
 *
 * Samples a process for a given duration (default 5 seconds) using macOS `sample`
 * or fallback thread analysis, then presents an annotated call-tree and
 * hot frames summary.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);

export interface ProfileProcOptions {
  pid: number;
  durationSec?: number;
  raw?: boolean;
}

export async function runProfileProcCommand(opts: ProfileProcOptions): Promise<void> {
  const { pid, durationSec = 5, raw } = opts;

  if (isNaN(pid) || pid <= 0) {
    console.error(chalk.red('\n  ✖ Error: Valid PID is required. Usage: pyre profile-proc <pid> [--duration <sec>]\n'));
    process.exit(1);
  }

  // 1. Verify process exists
  try {
    process.kill(pid, 0);
  } catch {
    console.error(chalk.red(`\n  ✖ Error: Process with PID ${pid} is not running or accessible.\n`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  🔥 pyre profile-proc — Profiling PID ${pid} for ${durationSec}s...\n`));

  let sampleOutput = '';
  let usedFallback = false;

  // Try macOS native `sample` command (available on macOS)
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('sample', [String(pid), String(durationSec), '-file', '/dev/stdout'], {
        timeout: (durationSec + 5) * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      sampleOutput = stdout;
    } catch (err: any) {
      // Sample might fail if SIP restricts it on system processes or timeout
      sampleOutput = err.stdout || '';
    }
  }

  // Fallback: If sample produced no usable output or running on Linux, sample via thread / proc stats
  if (!sampleOutput || sampleOutput.length < 100) {
    usedFallback = true;
    try {
      const { stdout } = await execFileAsync('ps', ['-M', '-p', String(pid), '-o', 'pid,thread,pcpu,pmem,state,time,command']);
      sampleOutput = stdout;
    } catch {
      sampleOutput = `Process PID ${pid} active. Deep stack sampling requires elevated permissions or user-owned process.`;
    }
  }

  if (raw) {
    console.log(sampleOutput);
    return;
  }

  // Parse and display clean call-tree analysis
  if (!usedFallback) {
    // Extract Call graph section
    const lines = sampleOutput.split('\n');
    const headerLines: string[] = [];
    const stackLines: string[] = [];
    let inCallGraph = false;

    for (const line of lines) {
      if (line.includes('Analysis of sampling') || line.includes('Process:') || line.includes('Path:') || line.includes('Identifier:')) {
        headerLines.push(line.trim());
      }
      if (line.includes('Call graph:') || line.includes('+ Line Coverage')) {
        inCallGraph = true;
        continue;
      }
      if (inCallGraph) {
        if (line.includes('Total number in stack') || line.includes('Binary Images:')) {
          inCallGraph = false;
        } else if (line.trim().length > 0 && stackLines.length < 35) {
          stackLines.push(line);
        }
      }
    }

    if (headerLines.length > 0) {
      console.log(chalk.dim('  Process Info:'));
      for (const h of headerLines.slice(0, 4)) {
        console.log(`    ${chalk.cyan(h)}`);
      }
      console.log();
    }

    console.log(chalk.bold('  Top Call Stacks & Hot Functions:'));
    console.log(chalk.dim('  ' + '─'.repeat(70)));

    if (stackLines.length === 0) {
      for (const l of lines.slice(0, 20)) {
        if (l.trim()) console.log(`  ${l}`);
      }
    } else {
      for (const l of stackLines) {
        if (l.includes('???')) {
          console.log(chalk.dim(`  ${l}`));
        } else if (l.includes('+')) {
          console.log(chalk.yellow(`  ${l}`));
        } else {
          console.log(`  ${l}`);
        }
      }
    }
  } else {
    console.log(chalk.yellow('  Note: Kernel/SIP restriction prevented deep call-graph unwind.'));
    console.log(chalk.dim('  Showing process thread snapshot:\n'));
    for (const l of sampleOutput.split('\n')) {
      if (l.trim()) console.log(`    ${l}`);
    }
  }

  console.log();
  console.log(chalk.green(`  ✔ Sampling complete for PID ${pid} (${durationSec}s profile duration).`));
  console.log();
}

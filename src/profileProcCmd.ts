/**
 * pyre profile-proc — Process CPU Profiler.
 *
 * Samples a process for a given duration (default 5 seconds) using macOS `sample`,
 * Windows PowerShell thread & module profiling, or fallback thread analysis,
 * presenting an annotated call-tree, thread states, and hot frames summary.
 */
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { runPowerShell } from './monitors/run.js';

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

  // 1. Verify process exists (cross-platform)
  let processAlive = false;
  try {
    process.kill(pid, 0);
    processAlive = true;
  } catch {
    if (process.platform === 'win32') {
      try {
        const out = execSync(`tasklist /fi "PID eq ${pid}" /nh`, { stdio: 'pipe' }).toString();
        processAlive = out.includes(String(pid));
      } catch {}
    }
  }

  if (!processAlive) {
    console.error(chalk.red(`\n  ✖ Error: Process with PID ${pid} is not running or accessible.\n`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n  🔥 pyre profile-proc — Profiling PID ${pid} for ${durationSec}s...\n`));

  let sampleOutput = '';
  let usedFallback = false;

  // 1. Windows Native Profiler
  if (process.platform === 'win32') {
    try {
      const psScript = `
$p1 = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if (-not $p1) { exit 1 }
$cpu1 = $p1.TotalProcessorTime.TotalSeconds
$start = Get-Date
Start-Sleep -Seconds ${durationSec}
$p2 = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
$cpu2 = if ($p2) { $p2.TotalProcessorTime.TotalSeconds } else { $cpu1 }
$elapsed = ((Get-Date) - $start).TotalSeconds
$cpuPct = if ($elapsed -gt 0) { [math]::Round((($cpu2 - $cpu1) / $elapsed) * 100, 1) } else { 0 }

Write-Output "Process: $($p1.ProcessName) (PID $($p1.Id))"
Write-Output "Path: $($p1.Path)"
Write-Output "Average CPU Utilization: $cpuPct%"
Write-Output "Working Set (RAM): $([math]::Round($p1.WorkingSet64 / 1MB, 1)) MB"
Write-Output "Threads Total: $($p1.Threads.Count)"
Write-Output ""
Write-Output "Call graph / Active Threads:"
$p1.Threads | Select-Object -First 25 | ForEach-Object {
    $state = $_.ThreadState
    $wait = $_.WaitReason
    $time = [math]::Round($_.TotalProcessorTime.TotalSeconds, 3)
    Write-Output "  + [TID $($_.Id)] CPU: $($time)s | State: $state | WaitReason: $wait"
}
`;
      sampleOutput = await runPowerShell(psScript, '', (durationSec + 8) * 1000);
    } catch {}
  }

  // 2. macOS native `sample` command
  if (!sampleOutput && process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('sample', [String(pid), String(durationSec), '-file', '/dev/stdout'], {
        timeout: (durationSec + 5) * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      sampleOutput = stdout;
    } catch (err: any) {
      sampleOutput = err.stdout || '';
    }
  }

  // 3. POSIX Fallback (Linux / fallback macOS)
  if (!sampleOutput || sampleOutput.length < 50) {
    usedFallback = true;
    if (process.platform !== 'win32') {
      try {
        const { stdout } = await execFileAsync('ps', ['-M', '-p', String(pid), '-o', 'pid,thread,pcpu,pmem,state,time,command']);
        sampleOutput = stdout;
      } catch {
        sampleOutput = `Process PID ${pid} active. Deep stack sampling requires elevated permissions or user-owned process.`;
      }
    } else {
      sampleOutput = `Process PID ${pid} active. Profiling finished.`;
    }
  }

  if (raw) {
    console.log(sampleOutput);
    return;
  }

  // Parse and display clean call-tree analysis
  if (!usedFallback) {
    const lines = sampleOutput.split('\n');
    const headerLines: string[] = [];
    const stackLines: string[] = [];
    let inCallGraph = false;

    for (const line of lines) {
      if (line.includes('Analysis of sampling') || line.includes('Process:') || line.includes('Path:') ||
          line.includes('Identifier:') || line.includes('Average CPU Utilization:') || line.includes('Working Set') || line.includes('Threads Total:')) {
        headerLines.push(line.trim());
      }
      if (line.includes('Call graph:') || line.includes('Call graph / Active Threads:') || line.includes('+ Line Coverage')) {
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
      for (const h of headerLines.slice(0, 6)) {
        console.log(`    ${chalk.cyan(h)}`);
      }
      console.log();
    }

    console.log(chalk.bold('  Top Call Stacks & Hot Threads:'));
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
    console.log(chalk.yellow('  Note: Operating system permissions prevented deep call-graph unwind.'));
    console.log(chalk.dim('  Showing process thread snapshot:\n'));
    for (const l of sampleOutput.split('\n')) {
      if (l.trim()) console.log(`    ${l}`);
    }
  }

  console.log();
  console.log(chalk.green(`  ✔ Sampling complete for PID ${pid} (${durationSec}s profile duration).`));
  console.log();
}

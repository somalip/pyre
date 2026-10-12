/**
 * pyre inspect — Deep-Dive Process Inspector.
 *
 * Inspects low-level attributes for a running PID:
 * open file handles (lsof), active sockets, thread count,
 * nice priority, and memory regions.
 */
import os from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { formatBytes } from './budgetCmd.js';

export interface ProcessDetails {
  pid: number;
  name: string;
  user: string;
  ppid: number;
  threads: number;
  nice: number;
  cpuPct: number;
  memRssBytes: number;
  openFiles: string[];
  sockets: string[];
}

export function inspectProcess(pid: number): ProcessDetails {
  // Check if process exists
  try {
    process.kill(pid, 0);
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      throw new Error(`Process with PID ${pid} not found or permission denied.`);
    }
  }

  // Query ps metadata
  let name = 'unknown';
  let user = 'unknown';
  let ppid = 0;
  let threads = 1;
  let nice = 0;
  let cpuPct = 0;
  let memRssBytes = 0;

  try {
    const psOut = execSync(`ps -p ${pid} -o user,ppid,nice,%cpu,rss,comm 2>/dev/null`, { encoding: 'utf-8' });
    const lines = psOut.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      user = parts[0] || 'unknown';
      ppid = parseInt(parts[1], 10) || 0;
      nice = parseInt(parts[2], 10) || 0;
      cpuPct = parseFloat(parts[3]) || 0;
      memRssBytes = (parseInt(parts[4], 10) || 0) * 1024;
      name = parts.slice(5).join(' ') || 'unknown';
    }
  } catch {
    // Fallback if ps is restricted or unavailable
    if (pid === process.pid) {
      try {
        user = os.userInfo().username || 'current';
      } catch {
        user = process.env.USER || 'current';
      }
      ppid = process.ppid || 0;
      name = process.title || 'node';
      memRssBytes = process.memoryUsage().rss;
      threads = 1;
    }
  }

  // Query lsof for open files and network sockets
  const openFiles: string[] = [];
  const sockets: string[] = [];

  try {
    const lsofOut = execSync(`lsof -p ${pid} -F tn 2>/dev/null`, { encoding: 'utf-8' });
    const lines = lsofOut.split('\n');
    let curType = '';

    for (const l of lines) {
      if (l.startsWith('t')) {
        curType = l.slice(1).trim();
      } else if (l.startsWith('n')) {
        const nameVal = l.slice(1).trim();
        if (curType === 'IPv4' || curType === 'IPv6' || nameVal.includes(':') || nameVal.includes('->')) {
          sockets.push(nameVal);
        } else if (nameVal.startsWith('/') && !openFiles.includes(nameVal)) {
          openFiles.push(nameVal);
        }
      }
    }
  } catch {
    // lsof may not have permissions for system PIDs without sudo
  }

  return {
    pid,
    name,
    user,
    ppid,
    threads,
    nice,
    cpuPct,
    memRssBytes,
    openFiles: openFiles.slice(0, 15),
    sockets: sockets.slice(0, 15),
  };
}

export async function runInspectCommand(pid: number, opts?: { nice?: number; json?: boolean }): Promise<void> {
  if (isNaN(pid) || pid <= 0) {
    console.error(chalk.red('  ✖ Invalid PID. Usage: pyre inspect <pid>'));
    return;
  }

  // If renicing requested
  if (opts?.nice !== undefined) {
    try {
      execSync(`renice ${opts.nice} -p ${pid}`, { stdio: 'inherit' });
      console.log(chalk.green(`  ✔ Successfully set nice priority for PID ${pid} to ${opts.nice}\n`));
    } catch (err: any) {
      console.error(chalk.red(`  ✖ Failed to renice PID ${pid}: ${err.message}`));
    }
  }

  try {
    const details = inspectProcess(pid);

    if (opts?.json) {
      console.log(JSON.stringify(details, null, 2));
      return;
    }

    console.log(chalk.bold(`\n  🔥 pyre inspect — Process Deep Dive (PID ${details.pid})\n`));
    console.log(`  Process:     ${chalk.bold.hex('#ff6a39')(details.name)}`);
    console.log(`  User:        ${details.user}`);
    console.log(`  PPID:        ${details.ppid}`);
    console.log(`  CPU Usage:   ${details.cpuPct.toFixed(1)}%`);
    console.log(`  Memory RSS:  ${formatBytes(details.memRssBytes)}`);
    console.log(`  Nice Value:  ${details.nice} (Priority: ${details.nice < 0 ? 'High' : details.nice > 0 ? 'Low' : 'Normal'})`);
    console.log(chalk.dim('  ─────────────────────────────────────────────────────────────'));

    // Open sockets
    console.log(chalk.bold.cyan('\n  Active Network Sockets:'));
    if (details.sockets.length === 0) {
      console.log(chalk.dim('    No open sockets detected (or permission denied).'));
    } else {
      details.sockets.forEach((s) => console.log(`    • ${s}`));
    }

    // Open file descriptors
    console.log(chalk.bold.yellow('\n  Open File Descriptors:'));
    if (details.openFiles.length === 0) {
      console.log(chalk.dim('    No open file handles detected.'));
    } else {
      details.openFiles.forEach((f) => console.log(`    • ${chalk.dim(f)}`));
    }

    console.log(chalk.dim('\n  ─────────────────────────────────────────────────────────────'));
    console.log(chalk.dim(`  Adjust priority: pyre inspect ${pid} --nice <value -20 to 19>\n`));
  } catch (err: any) {
    console.error(chalk.red(`\n  ✖ ${err.message}\n`));
  }
}

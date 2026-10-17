/**
 * pyre zombies — Zombie (Z), Stuck I/O (U/D), CPU Spinlock & Stale Dev Orphan Hunter.
 *
 * Scans the process table for:
 *   1. Defunct Zombie processes (state 'Z') and resolves their Parent PID (PPID)
 *   2. Uninterruptible disk/kernel wait processes (state 'U' or 'D')
 *   3. Orphaned background developer/test workers (PPID=1 vitest, jest, playwright, etc.)
 *   4. Runaway CPU spinlocks (>= 90% CPU for >= 120s)
 *
 * Supports `--clean` to send SIGCHLD to zombie parents and terminate stale dev orphans.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export type AnomalyProcessCategory = 'ZOMBIE' | 'STUCK_IO' | 'DEV_ORPHAN' | 'CPU_SPINLOCK';

export interface ZombieOrphanEntry {
  pid: number;
  ppid: number;
  parentCommand: string;
  user: string;
  state: string;
  cpuPct: number;
  memPct: number;
  elapsedSec: number;
  command: string;
  category: AnomalyProcessCategory;
  remediationHint: string;
}

const DEV_ORPHAN_PATTERNS = [
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bplaywright\b/i,
  /\bchromedriver\b/i,
  /\bgeckodriver\b/i,
  /\bwebpack\b/i,
  /\bvite\b/i,
  /\bturbopack\b/i,
  /\bpytest\b/i,
  /\bcargo\s+(test|check|build)\b/i,
  /\btsx\s+--test\b/i,
];

/**
 * Parse `ps` elapsed time (`[[dd-]hh:]mm:ss`) into total seconds.
 */
export function parseElapsedToSeconds(etime: string): number {
  const clean = etime.trim();
  if (!clean) return 0;

  let days = 0;
  let timePart = clean;
  if (clean.includes('-')) {
    const [dStr, rest] = clean.split('-');
    days = parseInt(dStr, 10) || 0;
    timePart = rest || '00:00';
  }

  const segments = timePart.split(':').map(s => parseInt(s, 10) || 0);
  if (segments.length === 3) {
    return days * 86400 + segments[0] * 3600 + segments[1] * 60 + segments[2];
  }
  if (segments.length === 2) {
    return days * 86400 + segments[0] * 60 + segments[1];
  }
  return days * 86400 + (segments[0] || 0);
}

/**
 * Determine if a process with PPID=1 is an abandoned developer/test worker.
 */
export function isDevOrphanCandidate(command: string, ppid: number, elapsedSec: number): boolean {
  if (ppid !== 1 || elapsedSec < 60) return false;
  return DEV_ORPHAN_PATTERNS.some(re => re.test(command));
}

/**
 * Parse `ps -axo pid,ppid,user,stat,%cpu,%mem,etime,command` output and identify
 * zombies, stuck I/O processes, dev orphans, and CPU spinlocks.
 */
export function parseZombieScanPsOutput(psOutput: string): ZombieOrphanEntry[] {
  const rawRows: {
    pid: number;
    ppid: number;
    user: string;
    state: string;
    cpuPct: number;
    memPct: number;
    elapsedSec: number;
    command: string;
  }[] = [];

  const pidToCommand = new Map<number, string>();
  const lines = psOutput.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('PID')) continue;

    const m = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;

    const pid = parseInt(m[1], 10);
    const ppid = parseInt(m[2], 10);
    const user = m[3];
    const state = m[4];
    const cpuPct = parseFloat(m[5]) || 0;
    const memPct = parseFloat(m[6]) || 0;
    const elapsedSec = parseElapsedToSeconds(m[7]);
    const command = m[8].trim();

    if (isNaN(pid) || pid <= 0) continue;
    pidToCommand.set(pid, command);
    rawRows.push({ pid, ppid, user, state, cpuPct, memPct, elapsedSec, command });
  }

  const results: ZombieOrphanEntry[] = [];

  for (const r of rawRows) {
    if (r.pid === process.pid || r.pid === process.ppid) continue;
    const parentCommand = pidToCommand.get(r.ppid) || (r.ppid === 1 ? 'launchd/init' : `pid-${r.ppid}`);
    const primaryState = r.state.charAt(0).toUpperCase();

    if (primaryState === 'Z' || r.command.includes('<defunct>')) {
      results.push({
        ...r,
        parentCommand,
        category: 'ZOMBIE',
        remediationHint: r.ppid > 1
          ? `Send SIGCHLD to parent PID ${r.ppid} (${parentCommand})`
          : 'Awaiting init/launchd reap',
      });
      continue;
    }

    if (primaryState === 'U' || primaryState === 'D') {
      results.push({
        ...r,
        parentCommand,
        category: 'STUCK_IO',
        remediationHint: 'Stuck in uninterruptible kernel/disk wait; check mounted volumes or network shares',
      });
      continue;
    }

    if (isDevOrphanCandidate(r.command, r.ppid, r.elapsedSec)) {
      results.push({
        ...r,
        parentCommand,
        category: 'DEV_ORPHAN',
        remediationHint: `Detached dev/test worker (PPID=1); safe to terminate PID ${r.pid}`,
      });
      continue;
    }

    if (r.cpuPct >= 90 && r.elapsedSec >= 120) {
      results.push({
        ...r,
        parentCommand,
        category: 'CPU_SPINLOCK',
        remediationHint: `Sustained ${r.cpuPct.toFixed(1)}% CPU for ${Math.round(r.elapsedSec / 60)}m; inspect with pyre inspect ${r.pid}`,
      });
    }
  }

  return results;
}

export function collectZombieOrphanProcesses(): ZombieOrphanEntry[] {
  if (process.platform === 'win32') {
    return [];
  }
  try {
    const out = execSync('ps -axo pid,ppid,user,stat,%cpu,%mem,etime,command 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 3500,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseZombieScanPsOutput(out);
  } catch {
    return [];
  }
}

/**
 * Reap zombies by signaling SIGCHLD to their parent PIDs, and terminate
 * detached developer orphan processes.
 */
export function reapAndCleanProcesses(
  entries: ZombieOrphanEntry[],
  opts?: { dryRun?: boolean }
): { reapedParentPids: number[]; terminatedOrphanPids: number[]; errors: string[] } {
  const reapedParentPids: number[] = [];
  const terminatedOrphanPids: number[] = [];
  const errors: string[] = [];

  const zombieParents = new Set<number>();
  for (const e of entries) {
    if (e.category === 'ZOMBIE' && e.ppid > 1 && e.ppid !== process.pid) {
      zombieParents.add(e.ppid);
    }
  }

  for (const ppid of zombieParents) {
    if (opts?.dryRun) {
      reapedParentPids.push(ppid);
      continue;
    }
    try {
      process.kill(ppid, 'SIGCHLD');
      reapedParentPids.push(ppid);
    } catch (err: any) {
      errors.push(`Parent PID ${ppid}: ${err.message}`);
    }
  }

  for (const e of entries) {
    if (e.category === 'DEV_ORPHAN' && e.pid > 1 && e.pid !== process.pid) {
      if (opts?.dryRun) {
        terminatedOrphanPids.push(e.pid);
        continue;
      }
      try {
        process.kill(e.pid, 'SIGTERM');
        terminatedOrphanPids.push(e.pid);
      } catch (err: any) {
        errors.push(`Orphan PID ${e.pid}: ${err.message}`);
      }
    }
  }

  return { reapedParentPids, terminatedOrphanPids, errors };
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

export async function runZombiesCommand(opts?: {
  clean?: boolean;
  dryRun?: boolean;
  json?: boolean;
}): Promise<void> {
  const entries = collectZombieOrphanProcesses();
  const cleanResult = opts?.clean ? reapAndCleanProcesses(entries, { dryRun: opts?.dryRun }) : undefined;

  if (opts?.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      totalDetected: entries.length,
      zombiesCount: entries.filter(e => e.category === 'ZOMBIE').length,
      stuckIoCount: entries.filter(e => e.category === 'STUCK_IO').length,
      devOrphansCount: entries.filter(e => e.category === 'DEV_ORPHAN').length,
      spinlocksCount: entries.filter(e => e.category === 'CPU_SPINLOCK').length,
      entries,
      cleanResult,
    }, null, 2));
    return;
  }

  const zombies = entries.filter(e => e.category === 'ZOMBIE');
  const stuck = entries.filter(e => e.category === 'STUCK_IO');
  const orphans = entries.filter(e => e.category === 'DEV_ORPHAN');
  const spinlocks = entries.filter(e => e.category === 'CPU_SPINLOCK');

  console.log(chalk.bold('\n  🔥 pyre zombies — Zombie, Stuck I/O & Stale Dev Orphan Hunter\n'));
  console.log(
    `  Zombies (Z): ${zombies.length > 0 ? chalk.red.bold(String(zombies.length)) : chalk.green('0')}   ` +
    `Stuck I/O (U/D): ${stuck.length > 0 ? chalk.yellow.bold(String(stuck.length)) : chalk.green('0')}   ` +
    `Dev Orphans: ${orphans.length > 0 ? chalk.magenta.bold(String(orphans.length)) : chalk.green('0')}   ` +
    `CPU Spinlocks: ${spinlocks.length > 0 ? chalk.cyan.bold(String(spinlocks.length)) : chalk.green('0')}\n`
  );

  if (entries.length === 0) {
    console.log(chalk.green('  ✔ Clean process table — no defunct zombies, stuck I/O tasks, or abandoned dev workers found.\n'));
    return;
  }

  console.log(
    '  ' +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
      ' TYPE          PID      PPID     STATE   CPU%     COMMAND                  REMEDIATION HINT                    '
    )
  );
  console.log('  ' + chalk.dim('─'.repeat(108)));

  for (const e of entries) {
    const badge = e.category === 'ZOMBIE'
      ? chalk.bgHex('#7f1d1d').hex('#fecaca').bold(' ZOMBIE     ')
      : e.category === 'STUCK_IO'
        ? chalk.bgHex('#78350f').hex('#fcd34d').bold(' STUCK I/O  ')
        : e.category === 'DEV_ORPHAN'
          ? chalk.bgHex('#4c1d95').hex('#ddd6fe').bold(' DEV ORPHAN ')
          : chalk.bgHex('#831843').hex('#fbcfe8').bold(' SPINLOCK   ');

    console.log(
      `  ${badge}  ` +
      chalk.hex('#38bdf8')(String(e.pid).padEnd(9)) +
      chalk.hex('#94a3b8')(String(e.ppid).padEnd(9)) +
      chalk.dim(e.state.padEnd(8)) +
      chalk.hex('#10b981')(`${e.cpuPct.toFixed(1)}%`.padEnd(9)) +
      chalk.bold.hex('#f8fafc')(truncatePlain(e.command, 23).padEnd(25)) +
      chalk.dim(truncatePlain(e.remediationHint, 38))
    );
  }

  if (cleanResult) {
    const modeLabel = opts?.dryRun ? 'Dry-Run' : 'Reap & Clean';
    console.log(chalk.bold.cyan(`\n  ◆ ${modeLabel} Summary:`));
    console.log(`    • Signaled SIGCHLD to zombie parent PIDs: ${cleanResult.reapedParentPids.length ? cleanResult.reapedParentPids.join(', ') : 'none'}`);
    console.log(`    • Terminated stale dev orphan PIDs:       ${cleanResult.terminatedOrphanPids.length ? cleanResult.terminatedOrphanPids.join(', ') : 'none'}`);
    for (const err of cleanResult.errors) {
      console.log(chalk.red(`    ✖ ${err}`));
    }
  } else {
    console.log(chalk.dim('\n  Tip: Run `pyre zombies --clean` to signal SIGCHLD to zombie parents and clean stale dev orphans.'));
  }
  console.log();
}

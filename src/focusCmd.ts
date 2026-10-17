/**
 * pyre focus — Performance focus & background process QoS tamer.
 *
 * Temporarily throttles or suspends heavy background daemons and sync agents
 * (Spotlight indexing, cloud sync, Electron helpers) to maximize CPU & thermal
 * headroom for compilation, gaming, or heavy workloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { getConfigDir } from './state/config.js';
import { collectProcesses } from './monitors/collectors.js';

export interface ThrottledProcess {
  pid: number;
  name: string;
  originalNice: number;
  wasSuspended: boolean;
}

export interface FocusState {
  isActive: boolean;
  activatedAt: string;
  throttledProcesses: ThrottledProcess[];
}

export const CANDIDATE_PATTERNS = [
  /dropbox/i,
  /onedrive/i,
  /google drive/i,
  /nextcloud/i,
  /slack helper/i,
  /discord helper/i,
  /spotify helper/i,
  /teams helper/i,
  /photolibraryd/i,
  /photoanalysisd/i,
  /mds_stores/i,
  /bird/i,
  /cloudd/i,
];

export function getFocusStateFile(): string {
  const dir = getConfigDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'focus-state.json');
  } catch {
    return path.join(os.tmpdir(), 'pyre-focus-state.json');
  }
}

export function readFocusState(): FocusState {
  const file = getFocusStateFile();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return { isActive: false, activatedAt: '', throttledProcesses: [] };
}

export function writeFocusState(state: FocusState): void {
  const file = getFocusStateFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

export async function enableFocusMode(opts: { suspend?: boolean; json?: boolean } = {}): Promise<void> {
  const existing = readFocusState();
  if (existing.isActive) {
    if (!opts.json) {
      console.log(chalk.yellow(`\n  ⚠ Focus Mode is already active! (${existing.throttledProcesses.length} processes throttled).`));
      console.log(chalk.dim(`  Run 'pyre focus off' to restore normal priority.\n`));
    } else {
      console.log(JSON.stringify(existing));
    }
    return;
  }

  const procs = await collectProcesses(200);
  const throttled: ThrottledProcess[] = [];
  const platform = os.platform();

  for (const proc of procs) {
    const isCandidate = CANDIDATE_PATTERNS.some(re => re.test(proc.command));
    if (!isCandidate) continue;

    // Throttle priority
    try {
      if (platform === 'darwin') {
        // Apply background QoS policy
        execSync(`taskpolicy -b -p ${proc.pid}`, { stdio: 'ignore' });
        execSync(`renice +10 ${proc.pid}`, { stdio: 'ignore' });
      } else if (platform === 'linux') {
        execSync(`renice +10 ${proc.pid}`, { stdio: 'ignore' });
      }

      let suspended = false;
      if (opts.suspend) {
        process.kill(proc.pid, 'SIGSTOP');
        suspended = true;
      }

      throttled.push({
        pid: proc.pid,
        name: proc.command,
        originalNice: 0,
        wasSuspended: suspended,
      });
    } catch {
      // Ignore permission or transient process exits
    }
  }

  const newState: FocusState = {
    isActive: true,
    activatedAt: new Date().toISOString(),
    throttledProcesses: throttled,
  };
  writeFocusState(newState);

  if (opts.json) {
    console.log(JSON.stringify(newState, null, 2));
    return;
  }

  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 76;

  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // TURBO FOCUS & PROCESS QOS SHIELD') + ' '.repeat(W - 53) + chalk.bgGreen.black.bold(' [ACTIVE] ') + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + `  THROTTLED: ${chalk.bold(String(throttled.length) + ' processes')} to Background QoS / renice +10`.padEnd(W + 10) + border('│'));
  console.log(border('├─────┬────────────────────────────────────┬─────────────────────────────┤'));
  console.log(border('│') + ' PID ' + border('│') + ' PROCESS NAME                       ' + border('│') + ' ACTION TAKEN                ' + border('│'));
  console.log(border('├─────┼────────────────────────────────────┼─────────────────────────────┤'));

  for (const t of throttled) {
    const pidStr = String(t.pid).padEnd(4);
    const nameStr = (t.name.length > 34 ? t.name.slice(0, 33) + '…' : t.name).padEnd(34);
    const actStr = t.wasSuspended ? chalk.magenta('SIGSTOP (Suspended)        ') : chalk.yellow('taskpolicy -b (Background) ');
    console.log(border('│') + ` ${pidStr}` + border('│') + ` ${chalk.bold(nameStr)} ` + border('│') + ` ${actStr} ` + border('│'));
  }

  console.log(border('└─────┴────────────────────────────────────┴─────────────────────────────┘'));
  console.log(dim(`  Tip: Foreground tasks have boosted headroom. Run 'pyre focus off' when done.\n`));
}

export async function disableFocusMode(opts: { json?: boolean } = {}): Promise<void> {
  const state = readFocusState();
  if (!state.isActive) {
    if (!opts.json) {
      console.log(chalk.dim(`\n  ℹ Focus Mode is not currently active.\n`));
    } else {
      console.log(JSON.stringify({ isActive: false }));
    }
    return;
  }

  let restoredCount = 0;
  const platform = os.platform();

  for (const proc of state.throttledProcesses) {
    try {
      if (proc.wasSuspended) {
        process.kill(proc.pid, 'SIGCONT');
      }
      if (platform === 'darwin') {
        execSync(`taskpolicy -b 0 -p ${proc.pid}`, { stdio: 'ignore' });
        execSync(`renice 0 ${proc.pid}`, { stdio: 'ignore' });
      } else if (platform === 'linux') {
        execSync(`renice 0 ${proc.pid}`, { stdio: 'ignore' });
      }
      restoredCount++;
    } catch {
      // Process may have exited
    }
  }

  const resetState: FocusState = {
    isActive: false,
    activatedAt: '',
    throttledProcesses: [],
  };
  writeFocusState(resetState);

  if (opts.json) {
    console.log(JSON.stringify({ isActive: false, restoredCount }, null, 2));
    return;
  }

  const border = chalk.hex('#ff5f2e');
  const W = 76;
  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.green.bold(`  ✔ RESTORED: ${restoredCount} background processes returned to standard priority.`).padEnd(W + 9) + border('│'));
  console.log(border('└' + '─'.repeat(W) + '┘\n'));
}

export function printFocusStatus(opts: { json?: boolean } = {}): void {
  const state = readFocusState();

  if (opts.json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 76;

  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // TURBO FOCUS & PROCESS SHIELD STATUS') + ' '.repeat(W - 55) + (state.isActive ? chalk.bgGreen.black.bold(' [ACTIVE] ') : dim(' [INACTIVE] ')) + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));

  if (state.isActive) {
    console.log(border('│') + `  ACTIVATED: ${new Date(state.activatedAt).toLocaleTimeString().padEnd(16)}  THROTTLED: ${chalk.bold(String(state.throttledProcesses.length) + ' daemons')}`.padEnd(W + 10) + border('│'));
    console.log(border('├─────┬──────────────────────────────────────────────────────────────────┤'));
    console.log(border('│') + ' PID ' + border('│') + ' PROCESS NAME                                                     ' + border('│'));
    console.log(border('├─────┼──────────────────────────────────────────────────────────────────┤'));
    for (const t of state.throttledProcesses) {
      const pidStr = String(t.pid).padEnd(4);
      const nameStr = (t.name.length > 62 ? t.name.slice(0, 61) + '…' : t.name).padEnd(62);
      console.log(border('│') + ` ${pidStr}` + border('│') + ` ${chalk.cyan(nameStr)} ` + border('│'));
    }
    console.log(border('└─────┴──────────────────────────────────────────────────────────────────┘'));
    console.log(dim(`  Tip: Run 'pyre focus off' to restore normal priorities.\n`));
  } else {
    console.log(border('│') + '  STATUS: Standard OS scheduling (all apps running at default priority).  ' + border('│'));
    console.log(border('└' + '─'.repeat(W) + '┘'));
    console.log(dim(`  Tip: Run 'pyre focus on' to throttle background noise and boost speed.\n`));
  }
}

export async function runFocusCommand(action: string = 'status', opts: { suspend?: boolean; json?: boolean } = {}): Promise<void> {
  switch (action.toLowerCase()) {
    case 'on':
    case 'enable':
    case 'start':
      await enableFocusMode(opts);
      break;
    case 'off':
    case 'disable':
    case 'stop':
      await disableFocusMode(opts);
      break;
    case 'status':
    default:
      printFocusStatus(opts);
      break;
  }
}

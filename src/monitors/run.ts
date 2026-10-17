/**
 * Shared shell-execution helper for the monitors module.
 *
 * Wraps `child_process.exec` with a timeout and a
 * fallback return value so that a failing command never
 * crashes the entire collection pipeline.
 *
 * Automatically normalizes common Unix-isms (such as `2>/dev/null`)
 * when running on Windows (win32).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';

async function run(cmd: string, fallback: string = '', timeout = 3000): Promise<string> {
  try {
    let sanitizedCmd = cmd;
    if (isWindows) {
      sanitizedCmd = sanitizedCmd.replace(/2>\s*\/dev\/null/g, '2>nul');
      // On Windows cmd.exe, remove Unix-style /dev/null
      sanitizedCmd = sanitizedCmd.replace(/\/dev\/null/g, 'nul');
    } else {
      // On Unix shells, prevent creating a literal file named 'nul'
      sanitizedCmd = sanitizedCmd.replace(/2>\s*nul\b/g, '2>/dev/null');
      sanitizedCmd = sanitizedCmd.replace(/>\s*nul\b/g, '>/dev/null');
    }
    return (await execAsync(sanitizedCmd, { encoding: 'utf8', timeout, windowsHide: true })).stdout.trim();
  } catch (err: any) {
    if (err && typeof err.stdout === 'string' && err.stdout.trim().length > 0) {
      return err.stdout.trim();
    }
    return fallback;
  }
}

// ─── PowerShell execution (Windows) ──────────────────────────────────────────
// Every powershell.exe launch costs 0.3–1.5s of cold start. A single collection tick used to
// spawn ~15 of them at once; under that contention the 4s timeouts fired and results silently
// became empty (no battery, no GPU, ...). So we: (1) cap concurrent processes, (2) start the
// timeout when the process actually starts, (3) dedupe identical in-flight scripts and
// (4) allow stale-while-revalidate caching for data that does not change every tick.

const MAX_CONCURRENT_PS = 3;
let activePs = 0;
const psWaiters: Array<() => void> = [];

async function acquirePsSlot(): Promise<void> {
  if (activePs < MAX_CONCURRENT_PS) {
    activePs++;
    return;
  }
  await new Promise<void>(resolve => psWaiters.push(resolve));
}

function releasePsSlot(): void {
  const next = psWaiters.shift();
  if (next) next(); // hand the slot over directly
  else activePs--;
}

interface PsCacheEntry {
  value: string;
  ts: number;
  inflight?: Promise<string | null>;
}
const psCache = new Map<string, PsCacheEntry>();
const psInflight = new Map<string, Promise<string | null>>();

/** Returns stdout on success (possibly ''), or null when the process failed / timed out. */
async function execPowerShell(script: string, timeout: number): Promise<string | null> {
  const existing = psInflight.get(script);
  if (existing) return existing;

  const p = (async () => {
    await acquirePsSlot();
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const cmd = `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
      return (await execAsync(cmd, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
    } catch {
      return null;
    } finally {
      releasePsSlot();
    }
  })();
  psInflight.set(script, p);
  p.finally(() => psInflight.delete(script)).catch(() => {});
  return p;
}

/**
 * Execute a PowerShell snippet safely on Windows, returning trimmed stdout or fallback.
 *
 * @param cacheTtlMs when > 0 the result is cached; stale values are returned immediately while
 *                   a refresh runs in the background (failures never overwrite good data).
 */
async function runPowerShell(script: string, fallback: string = '', timeout = 10000, cacheTtlMs = 0): Promise<string> {
  if (!isWindows) return fallback;

  if (cacheTtlMs > 0) {
    const now = Date.now();
    const entry = psCache.get(script);
    if (entry) {
      if (now - entry.ts >= cacheTtlMs && !entry.inflight) {
        entry.inflight = execPowerShell(script, timeout).then(v => {
          if (v !== null) {
            entry.value = v;
            entry.ts = Date.now();
          }
          return v;
        }).finally(() => { entry.inflight = undefined; });
        entry.inflight.catch(() => {});
      }
      return entry.value;
    }
    const value = await execPowerShell(script, timeout);
    if (value === null) return fallback;
    psCache.set(script, { value, ts: Date.now() });
    return value;
  }

  const value = await execPowerShell(script, timeout);
  return value === null ? fallback : value;
}

export { run, runPowerShell };
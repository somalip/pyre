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
    }
    return (await execAsync(sanitizedCmd, { encoding: 'utf8', timeout, windowsHide: true })).stdout.trim();
  } catch {
    return fallback;
  }
}

/**
 * Execute a PowerShell snippet safely on Windows, returning trimmed stdout or fallback.
 */
async function runPowerShell(script: string, fallback: string = '', timeout = 4000): Promise<string> {
  if (!isWindows) return fallback;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    return (await execAsync(cmd, { encoding: 'utf8', timeout, windowsHide: true })).stdout.trim();
  } catch {
    return fallback;
  }
}

export { run, runPowerShell };
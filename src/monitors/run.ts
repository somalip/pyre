/**
 * Shared shell-execution helper for the monitors module.
 *
 * Wraps `child_process.execSync` with a timeout and a
 * fallback return value so that a failing command never
 * crashes the entire collection pipeline.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function run(cmd: string, fallback: string = '', timeout = 3000): Promise<string> {
  try {
    return (await execAsync(cmd, { encoding: 'utf8', timeout })).stdout.trim();
  } catch {
    return fallback;
  }
}

export { run };
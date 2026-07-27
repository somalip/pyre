/**
 * Shared shell-execution helper for the monitors module.
 *
 * Wraps `child_process.execSync` with a timeout and a
 * fallback return value so that a failing command never
 * crashes the entire collection pipeline.
 */

async function run(cmd: string, fallback: string = ''): Promise<string> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch {
    return fallback;
  }
}

export { run };
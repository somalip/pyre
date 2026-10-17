/**
 * pyre awake — Smart guardrailed keep-awake utility.
 *
 * Prevents system and display sleep with native OS power assertions,
 * while automatically enforcing safety guardrails: aborts on low battery
 * or excessive thermal pressure, and supports binding to commands, PIDs,
 * or active network throughput.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';
import { collectBattery, collectThermal, collectNetwork } from './monitors/collectors.js';
import { parseDurationToMs } from './sleepAuditCmd.js';
import { formatBytes } from './formatters/render.js';

export interface AwakeOptions {
  duration?: string;
  untilDone?: string;
  pid?: number;
  whileNetwork?: number; // bytes/sec threshold
  minBattery?: number;   // % threshold, default 15
  maxTemp?: number;      // Celsius threshold, default 85
  checkIntervalSec?: number;
}

export function parseByteRate(str?: string): number {
  if (!str) return 0;
  const match = str.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?(?:\/S)?$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2] || 'KB';
  switch (unit) {
    case 'GB': return val * 1024 * 1024 * 1024;
    case 'MB': return val * 1024 * 1024;
    case 'KB': return val * 1024;
    case 'B':
    default: return val;
  }
}

export function spawnInhibitor(): ChildProcess | null {
  const platform = os.platform();
  try {
    if (platform === 'darwin') {
      // caffeinate -d (display) -i (idle) -m (disk)
      return spawn('caffeinate', ['-d', '-i', '-m'], {
        stdio: 'ignore',
        detached: false,
      });
    } else if (platform === 'linux') {
      return spawn('systemd-inhibit', [
        '--what=idle:sleep',
        '--who=pyre',
        '--why=pyre awake guardrailed execution',
        'sleep',
        'infinity',
      ], { stdio: 'ignore', detached: false });
    }
  } catch {
    // ignore
  }
  return null;
}

export async function runAwakeCommand(opts: AwakeOptions = {}): Promise<void> {
  const minBattery = opts.minBattery ?? 15;
  const maxTemp = opts.maxTemp ?? 85;
  const checkIntervalMs = (opts.checkIntervalSec ?? 3) * 1000;
  const maxDurationMs = opts.duration ? parseDurationToMs(opts.duration) : 0;
  const networkThresholdBytes = opts.whileNetwork ?? 0;

  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 76;

  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // GUARDRAILED SLEEP INHIBITOR') + ' '.repeat(W - 48) + chalk.cyan('[KEEP-AWAKE ACTIVE]') + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + `  LIMITS: Min Batt = ${chalk.bold(minBattery + '%')} | Max Temp = ${chalk.bold(maxTemp + '°C')} | Check Every = ${chalk.bold((opts.checkIntervalSec ?? 3) + 's')}`.padEnd(W + 28) + border('│'));

  let bindMode = 'Interactive (Ctrl+C to release)';
  if (opts.untilDone) bindMode = `Command: "${opts.untilDone.slice(0, 36)}"`;
  else if (opts.pid) bindMode = `PID: ${opts.pid}`;
  else if (maxDurationMs > 0) bindMode = `Duration: ${opts.duration} (${Math.round(maxDurationMs / 1000)}s)`;
  else if (networkThresholdBytes > 0) bindMode = `Network >= ${formatBytes(networkThresholdBytes)}/s`;

  console.log(border('│') + `  TRIGGER: ${chalk.yellow(bindMode)}`.padEnd(W + 10) + border('│'));
  console.log(border('└' + '─'.repeat(W) + '┘'));
  console.log();

  const inhibitor = spawnInhibitor();
  const startTime = Date.now();
  let lowNetworkConsecutive = 0;
  let isCleanedUp = false;

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    if (inhibitor && inhibitor.pid) {
      try {
        process.kill(inhibitor.pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    console.log(border('\n┌' + '─'.repeat(W) + '┐'));
    console.log(border('│') + chalk.green.bold('  ✔ RELEASED: Sleep assertion cleared. System power management restored.').padEnd(W + 9) + border('│'));
    console.log(border('└' + '─'.repeat(W) + '┘\n'));
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // If bound to a command (--until-done)
  if (opts.untilDone) {
    const cmdChild = spawn(opts.untilDone, {
      shell: true,
      stdio: 'inherit',
    });

    return new Promise((resolve) => {
      const safetyInterval = setInterval(async () => {
        // Check battery
        const battery = await collectBattery();
        if (battery && typeof battery.level === 'number' && !battery.state.toLowerCase().includes('charg') && battery.level <= minBattery) {
          clearInterval(safetyInterval);
          cleanup();
          console.log(chalk.red(`\n  ⚠ [SAFETY ALERT] Battery dropped to ${battery.level}%. Releasing sleep assertion to preserve power!\n`));
          resolve();
          return;
        }

        // Check thermals
        const thermal = await collectThermal();
        if (thermal && thermal.cpuTempC && thermal.cpuTempC >= maxTemp) {
          clearInterval(safetyInterval);
          cleanup();
          console.log(chalk.red(`\n  ⚠ [SAFETY ALERT] CPU temp reached ${thermal.cpuTempC}°C. Releasing sleep assertion to allow thermal cooling!\n`));
          resolve();
          return;
        }
      }, checkIntervalMs);

      cmdChild.on('exit', (code) => {
        clearInterval(safetyInterval);
        cleanup();
        console.log(chalk.green(`\n  ✔ Command finished with exit code ${code ?? 0}. Released sleep assertion.\n`));
        resolve();
      });
    });
  }

  // Periodic safety & condition loop
  return new Promise<void>((resolve) => {
    const loopInterval = setInterval(async () => {
      const now = Date.now();

      // Check max duration
      if (maxDurationMs > 0 && now - startTime >= maxDurationMs) {
        clearInterval(loopInterval);
        cleanup();
        console.log(chalk.green(`  ✔ Reached requested duration of ${opts.duration}. Released sleep assertion.\n`));
        resolve();
        return;
      }

      // Check PID binding
      if (opts.pid) {
        try {
          process.kill(opts.pid, 0); // test if process exists
        } catch {
          clearInterval(loopInterval);
          cleanup();
          console.log(chalk.green(`  ✔ Monitored process (PID ${opts.pid}) has finished. Released sleep assertion.\n`));
          resolve();
          return;
        }
      }

      // Check Network throughput binding
      if (networkThresholdBytes > 0) {
        try {
          const net = await collectNetwork();
          const currentThroughput = (net.rxSec || 0) + (net.txSec || 0);
          if (currentThroughput < networkThresholdBytes) {
            lowNetworkConsecutive++;
            if (lowNetworkConsecutive >= 3) { // 3 consecutive ticks below threshold
              clearInterval(loopInterval);
              cleanup();
              console.log(chalk.green(`  ✔ Network throughput dropped below threshold (${formatBytes(currentThroughput)}/s). Released sleep assertion.\n`));
              resolve();
              return;
            }
          } else {
            lowNetworkConsecutive = 0;
          }
        } catch {
          // ignore
        }
      }

      // Safety check: Battery
      try {
        const battery = await collectBattery();
        if (battery && typeof battery.level === 'number' && !battery.state.toLowerCase().includes('charg') && battery.level <= minBattery) {
          clearInterval(loopInterval);
          cleanup();
          console.log(chalk.red(`\n  ⚠ [SAFETY ALERT] Battery dropped to ${battery.level}% (<= ${minBattery}%). Released sleep assertion to prevent emergency shutdown!\n`));
          resolve();
          return;
        }
      } catch {
        // ignore
      }

      // Safety check: Thermals
      try {
        const thermal = await collectThermal();
        if (thermal && thermal.cpuTempC && thermal.cpuTempC >= maxTemp) {
          clearInterval(loopInterval);
          cleanup();
          console.log(chalk.red(`\n  ⚠ [SAFETY ALERT] CPU temperature reached ${thermal.cpuTempC}°C (>= ${maxTemp}°C). Released sleep assertion to cool down!\n`));
          resolve();
          return;
        }
      } catch {
        // ignore
      }
    }, checkIntervalMs);
  });
}

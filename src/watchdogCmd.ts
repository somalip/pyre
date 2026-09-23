/**
 * pyre watchdog — Persistent Autonomous Rules Engine.
 *
 * Evaluates configurable metric threshold and process rules continuously,
 * executing remediation actions (kill, renice) and dispatching multi-channel alerts.
 *
 * Example watchdog configuration rule:
 * {
 *   "name": "Stop runaway background renderers",
 *   "metric": "cpu",
 *   "process": "photoanalysisd",
 *   "threshold": 80,
 *   "durationSec": 10,
 *   "action": "kill", // "kill" | "notify" | "alert"
 *   "cooldownSec": 60
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { collectAll } from './monitors/collectors.js';
import { sendAlert } from './alertChannels.js';
import { getConfigDir, readConfig } from './state/config.js';

export interface WatchdogRule {
  name: string;
  metric?: 'cpu' | 'mem' | 'temp' | 'process_cpu' | 'process_mem';
  process?: string;
  threshold: number;
  durationSec?: number;
  action: 'kill' | 'notify' | 'alert';
  cooldownSec?: number;
}

export interface WatchdogOptions {
  configFile?: string;
  dryRun?: boolean;
  interval?: number;
}

const DEFAULT_WATCHDOG_RULES: WatchdogRule[] = [
  {
    name: 'High CPU System Alert',
    metric: 'cpu',
    threshold: 92,
    durationSec: 5,
    action: 'alert',
    cooldownSec: 120,
  },
  {
    name: 'Critical Temperature Protection',
    metric: 'temp',
    threshold: 98,
    durationSec: 5,
    action: 'alert',
    cooldownSec: 180,
  },
];

export async function runWatchdogCommand(opts: WatchdogOptions = {}): Promise<void> {
  const configDir = getConfigDir();
  const defaultRulePath = path.join(configDir, 'watchdog.json');
  const rulePath = opts.configFile || defaultRulePath;
  const intervalSec = opts.interval || 2;
  const isDryRun = !!opts.dryRun;

  let rules: WatchdogRule[] = DEFAULT_WATCHDOG_RULES;

  if (fs.existsSync(rulePath)) {
    try {
      rules = JSON.parse(fs.readFileSync(rulePath, 'utf-8'));
    } catch (err: any) {
      console.error(chalk.yellow(`  ⚠ Could not parse watchdog config at ${rulePath}: ${err.message}. Using default rules.`));
    }
  } else if (!opts.configFile) {
    try {
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(defaultRulePath, JSON.stringify(DEFAULT_WATCHDOG_RULES, null, 2));
    } catch {
      // ignore
    }
  }

  console.log(chalk.bold('\n  🔥 pyre watchdog — Autonomous Monitoring Daemon\n'));
  console.log(`  ${chalk.green('✔')} Loaded ${chalk.bold(String(rules.length))} rule(s) from ${chalk.cyan(rulePath)}`);
  console.log(`  ${chalk.green('✔')} Refresh interval: ${intervalSec}s  |  Dry run mode: ${isDryRun ? chalk.yellow('ON') : chalk.dim('OFF')}`);
  console.log(`\n  ${chalk.dim('Active Rules:')}`);
  for (const r of rules) {
    const target = r.process ? `proc "${r.process}"` : r.metric || 'system';
    console.log(`    • ${chalk.bold(r.name)} [if ${target} > ${r.threshold} → ${chalk.cyan(r.action)}]`);
  }
  console.log(chalk.dim('\n  Watching... Press Ctrl+C to stop.\n'));

  // Track rule trigger history for cooldowns
  const lastTriggered = new Map<string, number>();

  const config = readConfig();
  const alertChannels = {
    slackUrl: config.slackAlertUrl,
    discordUrl: config.discordAlertUrl,
    pushoverToken: config.pushoverToken,
    pushoverUser: config.pushoverUser,
    ntfyUrl: config.ntfyUrl,
  };

  const evaluate = async () => {
    try {
      const data = await collectAll();
      const now = Date.now();

      for (const rule of rules) {
        const cooldown = (rule.cooldownSec || 60) * 1000;
        const last = lastTriggered.get(rule.name) || 0;
        if (now - last < cooldown) continue;

        let triggered = false;
        let detail = '';
        let targetPid: number | null = null;

        if (rule.process) {
          const match = data.processes.find(p => p.command.toLowerCase().includes(rule.process!.toLowerCase()));
          if (match) {
            const val = rule.metric === 'process_mem' ? match.mem : match.cpu;
            if (val >= rule.threshold) {
              triggered = true;
              targetPid = match.pid;
              detail = `Process "${match.command}" (PID ${match.pid}) at ${val.toFixed(1)}% (threshold ${rule.threshold}%)`;
            }
          }
        } else if (rule.metric === 'cpu') {
          if (data.cpu.usage >= rule.threshold) {
            triggered = true;
            detail = `System CPU usage at ${data.cpu.usage.toFixed(1)}% (threshold ${rule.threshold}%)`;
          }
        } else if (rule.metric === 'mem') {
          if (data.memory.usagePercent >= rule.threshold) {
            triggered = true;
            detail = `System Memory at ${data.memory.usagePercent.toFixed(1)}% (threshold ${rule.threshold}%)`;
          }
        } else if (rule.metric === 'temp') {
          const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die;
          if (temp !== undefined && temp >= rule.threshold) {
            triggered = true;
            detail = `System Temperature at ${temp.toFixed(1)}°C (threshold ${rule.threshold}°C)`;
          }
        }

        if (triggered) {
          lastTriggered.set(rule.name, now);
          const timeStr = new Date().toLocaleTimeString();
          console.log(`  [${chalk.dim(timeStr)}] ${chalk.red.bold('⚠ TRIGGERED:')} ${chalk.bold(rule.name)}: ${detail}`);

          if (isDryRun) {
            console.log(chalk.yellow(`    [DRY RUN] Would execute action: ${rule.action}`));
            continue;
          }

          if (rule.action === 'kill' && targetPid) {
            try {
              process.kill(targetPid, 'SIGTERM');
              console.log(chalk.green(`    ✔ Killed PID ${targetPid} with SIGTERM`));
            } catch (err: any) {
              console.log(chalk.red(`    ✖ Failed to kill PID ${targetPid}: ${err.message}`));
            }
          }

          if (rule.action === 'alert') {
            await sendAlert({
              metric: rule.name,
              value: rule.threshold,
              threshold: rule.threshold,
              unit: '%',
              host: data.header.hostname,
              timestamp: new Date().toISOString(),
              severity: 'critical',
            }, alertChannels).catch(() => {});
            console.log(chalk.green('    ✔ Multi-channel alert dispatched.'));
          }
        }
      }
    } catch {
      // ignore loop error
    }
  };

  await evaluate();
  const handle = setInterval(evaluate, intervalSec * 1000);

  // Keep alive until SIGINT
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      clearInterval(handle);
      console.log(chalk.dim('\n  Watchdog stopped.'));
      resolve();
      process.exit(0);
    });
  });
}

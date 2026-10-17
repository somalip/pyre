/**
 * pyre sleep-audit — Standby & sleep battery drain diagnostics.
 *
 * Inspects sleep and wake cycles, DarkWake frequency, battery drain rates
 * during standby, and active power assertions preventing sleep.
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';

export interface SleepInterval {
  sleepTime: Date;
  wakeTime: Date;
  durationMs: number;
  sleepBatteryPct?: number;
  wakeBatteryPct?: number;
  drainPct?: number;
  wakeReason?: string;
  isDarkWake?: boolean;
}

export interface PowerAssertion {
  pid: number;
  processName: string;
  type: string;
  details?: string;
}

export interface SleepAuditReport {
  platform: string;
  timeRange: string;
  totalSleepMs: number;
  sleepIntervalsCount: number;
  darkWakeCount: number;
  totalDrainPct: number;
  drainRatePctPerHour: number;
  sleepScore: 'Good' | 'Fair' | 'Poor';
  scoreExplanation: string;
  activeAssertions: PowerAssertion[];
  intervals: SleepInterval[];
}

export function parseDurationToMs(durStr?: string): number {
  if (!durStr) return 24 * 60 * 60 * 1000; // default 24h
  const trimmed = durStr.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(h|d|m|s)?$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const val = parseFloat(match[1]);
  const unit = match[2] || 'h';
  switch (unit) {
    case 'd': return val * 24 * 60 * 60 * 1000;
    case 'h': return val * 60 * 60 * 1000;
    case 'm': return val * 60 * 1000;
    case 's': return val * 1000;
    default: return val * 60 * 60 * 1000;
  }
}

export function parsePmsetAssertions(output: string): PowerAssertion[] {
  const assertions: PowerAssertion[] = [];
  const lines = output.split('\n');
  const regex = /pid\s+(\d+)\(([^)]+)\):\s*\[[^\]]+\]\s*\S+\s+([A-Za-z0-9]+)(?:\s+named:\s*"?([^"\n]+)"?)?/;
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      assertions.push({
        pid: parseInt(match[1], 10),
        processName: match[2],
        type: match[3],
        details: match[4] || undefined,
      });
    }
  }
  return assertions;
}

export function parsePmsetLog(output: string, sinceMs: number): { intervals: SleepInterval[]; darkWakeCount: number } {
  const intervals: SleepInterval[] = [];
  let darkWakeCount = 0;
  const cutoff = Date.now() - sinceMs;

  const lines = output.split('\n');
  let currentSleep: { time: Date; battery?: number } | null = null;

  for (const line of lines) {
    const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\s+[+-]\d{4})?)/);
    if (!dateMatch) continue;

    const eventTime = new Date(dateMatch[1]);
    if (isNaN(eventTime.getTime()) || eventTime.getTime() < cutoff) continue;

    const chargeMatch = line.match(/Charge:(\d+)%/);
    const charge = chargeMatch ? parseInt(chargeMatch[1], 10) : undefined;

    if (line.includes('Sleep') && line.includes('Entering Sleep')) {
      currentSleep = { time: eventTime, battery: charge };
    } else if (line.includes('DarkWake')) {
      darkWakeCount++;
      if (currentSleep) {
        const drain = (currentSleep.battery !== undefined && charge !== undefined)
          ? Math.max(0, currentSleep.battery - charge)
          : undefined;
        intervals.push({
          sleepTime: currentSleep.time,
          wakeTime: eventTime,
          durationMs: Math.max(0, eventTime.getTime() - currentSleep.time.getTime()),
          sleepBatteryPct: currentSleep.battery,
          wakeBatteryPct: charge,
          drainPct: drain,
          wakeReason: line.includes('due to') ? line.split('due to')[1].trim().replace(/^['"]|['"]$/g, '') : 'DarkWake Event',
          isDarkWake: true,
        });
        currentSleep = { time: eventTime, battery: charge };
      }
    } else if (line.includes('Wake') && (line.includes('Wake from') || line.includes('Full Wake'))) {
      if (currentSleep) {
        const drain = (currentSleep.battery !== undefined && charge !== undefined)
          ? Math.max(0, currentSleep.battery - charge)
          : undefined;
        intervals.push({
          sleepTime: currentSleep.time,
          wakeTime: eventTime,
          durationMs: Math.max(0, eventTime.getTime() - currentSleep.time.getTime()),
          sleepBatteryPct: currentSleep.battery,
          wakeBatteryPct: charge,
          drainPct: drain,
          wakeReason: line.includes('due to') ? line.split('due to')[1].trim().replace(/^['"]|['"]$/g, '') : 'User Wake',
          isDarkWake: false,
        });
        currentSleep = null;
      }
    }
  }

  return { intervals, darkWakeCount };
}

export function computeSleepAudit(opts: { since?: string } = {}): SleepAuditReport {
  const sinceMs = parseDurationToMs(opts.since);
  const platform = os.platform();

  let intervals: SleepInterval[] = [];
  let darkWakeCount = 0;
  let activeAssertions: PowerAssertion[] = [];

  if (platform === 'darwin') {
    try {
      const assertionsRaw = execSync('pmset -g assertions', { encoding: 'utf-8', timeout: 3000 });
      activeAssertions = parsePmsetAssertions(assertionsRaw);
    } catch {
      // ignore
    }

    try {
      const logRaw = execSync('pmset -g log', { encoding: 'utf-8', timeout: 5000 });
      const parsed = parsePmsetLog(logRaw, sinceMs);
      intervals = parsed.intervals;
      darkWakeCount = parsed.darkWakeCount;
    } catch {
      // Fallback
    }
  }

  let totalSleepMs = 0;
  let totalDrainPct = 0;

  for (const interval of intervals) {
    totalSleepMs += interval.durationMs;
    if (interval.drainPct !== undefined) {
      totalDrainPct += interval.drainPct;
    }
  }

  const totalSleepHours = totalSleepMs / (1000 * 60 * 60);
  const drainRatePctPerHour = totalSleepHours > 0 ? +(totalDrainPct / totalSleepHours).toFixed(2) : 0;

  let sleepScore: 'Good' | 'Fair' | 'Poor' = 'Good';
  let scoreExplanation = 'Standby battery drain is minimal (< 1%/hour) and wake cycles are normal.';

  if (drainRatePctPerHour >= 2.5 || darkWakeCount > 15) {
    sleepScore = 'Poor';
    scoreExplanation = `High standby drain (${drainRatePctPerHour}%/hr) or excessive DarkWakes (${darkWakeCount}).`;
  } else if (drainRatePctPerHour >= 1.0 || darkWakeCount > 6) {
    sleepScore = 'Fair';
    scoreExplanation = `Moderate standby drain (${drainRatePctPerHour}%/hr). Check power assertions and background daemons.`;
  }

  return {
    platform,
    timeRange: opts.since || '24h',
    totalSleepMs,
    sleepIntervalsCount: intervals.length,
    darkWakeCount,
    totalDrainPct,
    drainRatePctPerHour,
    sleepScore,
    scoreExplanation,
    activeAssertions,
    intervals,
  };
}

export async function runSleepAuditCommand(opts: { since?: string; json?: boolean } = {}): Promise<void> {
  const report = computeSleepAudit(opts);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const scoreBadge = report.sleepScore === 'Good'
    ? chalk.bgGreen.black.bold(` ${report.sleepScore} `)
    : report.sleepScore === 'Fair'
      ? chalk.bgYellow.black.bold(` ${report.sleepScore} `)
      : chalk.bgRed.white.bold(` ${report.sleepScore} `);

  const hoursStr = (report.totalSleepMs / (1000 * 60 * 60)).toFixed(1);
  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 76;

  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // STANDBY & SLEEP DIAGNOSTICS') + ' '.repeat(W - 48) + chalk.cyan('[TELEMETRY V11]') + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + `  WINDOW: ${chalk.bold(report.timeRange.padEnd(8))}  PLATFORM: ${chalk.bold(report.platform.padEnd(10))}  DRAIN RATE: ${chalk.bold((report.drainRatePctPerHour + '%/hr').padEnd(10))}`.padEnd(W + 18) + border('│'));
  console.log(border('│') + `  STANDBY: ${chalk.bold((hoursStr + ' hrs').padEnd(7))}  CYCLES: ${chalk.bold(String(report.sleepIntervalsCount).padEnd(6))}    TOTAL DRAIN: ${chalk.bold((report.totalDrainPct + '%').padEnd(9))}`.padEnd(W + 18) + border('│'));
  console.log(border('│') + `  SCORE:   ${scoreBadge}  DARKWAKES: ${chalk.cyan(String(report.darkWakeCount).padEnd(4))}  STATUS: ${dim(report.scoreExplanation.slice(0, 36))}`.padEnd(W + 28) + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + chalk.bold('  ACTIVE POWER ASSERTIONS PREVENTING SLEEP') + ' '.repeat(W - 42) + border('│'));
  console.log(border('├─────┬──────────────────────────┬─────────────────────────┬─────────────┤'));
  console.log(border('│') + ' PID ' + border('│') + ' PROCESS                  ' + border('│') + ' ASSERTION TYPE           ' + border('│') + ' DETAILS     ' + border('│'));
  console.log(border('├─────┼──────────────────────────┼─────────────────────────┼─────────────┤'));

  if (report.activeAssertions.length === 0) {
    console.log(border('│') + chalk.dim(' (none) No third-party assertions currently blocking system sleep.          ') + border('│'));
  } else {
    for (const a of report.activeAssertions.slice(0, 8)) {
      const pidStr = String(a.pid).padEnd(4);
      const nameStr = (a.processName.length > 24 ? a.processName.slice(0, 23) + '…' : a.processName).padEnd(24);
      const typeStr = (a.type.length > 23 ? a.type.slice(0, 22) + '…' : a.type).padEnd(23);
      const detStr = ((a.details || '-').length > 11 ? (a.details || '-').slice(0, 10) + '…' : (a.details || '-')).padEnd(11);
      console.log(border('│') + ` ${pidStr}` + border('│') + ` ${chalk.yellow(nameStr)} ` + border('│') + ` ${chalk.magenta(typeStr)} ` + border('│') + ` ${dim(detStr)} ` + border('│'));
    }
  }

  console.log(border('├─────┴──────────────────────────┴─────────────────────────┴─────────────┤'));

  if (report.intervals.length > 0) {
    console.log(border('│') + chalk.bold('  RECENT SLEEP / WAKE INTERVAL LOG') + ' '.repeat(W - 34) + border('│'));
    console.log(border('├────────────────────────────────────────────────────────────────────────┤'));
    for (const int of report.intervals.slice(-4).reverse()) {
      const durM = Math.round(int.durationMs / (60 * 1000));
      const drain = int.drainPct !== undefined ? ` (-${int.drainPct}%)` : '';
      const tag = int.isDarkWake ? chalk.magenta('[DarkWake]') : chalk.blue('[FullWake]');
      const timeSpan = `${int.sleepTime.toLocaleTimeString()} -> ${int.wakeTime.toLocaleTimeString()}`;
      const line = `  ${tag} ${timeSpan.padEnd(22)} ${durM}m ${drain.padEnd(8)} ${dim((int.wakeReason || 'Wake').slice(0, 26))}`;
      console.log(border('│') + line.padEnd(W + 18) + border('│'));
    }
    console.log(border('└' + '─'.repeat(W) + '┘'));
  } else {
    console.log(border('└' + '─'.repeat(W) + '┘'));
  }
  console.log();
}

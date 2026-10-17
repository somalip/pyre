/**
 * pyre leaks — Real-Time Process Memory Leak & Monotonic Growth Detector.
 *
 * Samples process Resident Set Size (RSS) across multiple intervals, computes
 * linear regression growth slope (KB/s & MB/min) and R² monotonicity score,
 * estimates Time-To-Exhaustion (OOM ETA), and renders RSS trajectory sparklines.
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';
import { sparkline } from './sparkline.js';
import { formatBytes } from './formatters/render.js';

export interface ProcessSample {
  timestampMs: number;
  pid: number;
  command: string;
  user: string;
  rssBytes: number;
}

export interface ProcessLeakAnalysis {
  pid: number;
  command: string;
  user: string;
  sampleCount: number;
  startRssBytes: number;
  endRssBytes: number;
  deltaBytes: number;
  slopeBytesPerSec: number;
  growthMbPerMin: number;
  rSquared: number;
  severity: 'CRITICAL' | 'SUSPECTED' | 'STABLE';
  estimatedOomMinutes: number | null;
  rssHistoryBytes: number[];
}

/**
 * Compute ordinary least-squares linear regression slope (bytes/sec) and R²
 * goodness-of-fit (0..1) for a series of (xSec, yBytes) observations.
 */
export function computeLinearRegression(
  points: { xSec: number; yBytes: number }[]
): { slopeBytesPerSec: number; rSquared: number } {
  const n = points.length;
  if (n < 2) return { slopeBytesPerSec: 0, rSquared: 0 };

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.xSec;
    sumY += p.yBytes;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (const p of points) {
    const dx = p.xSec - meanX;
    const dy = p.yBytes - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  if (ssXX === 0) return { slopeBytesPerSec: 0, rSquared: 0 };
  const slopeBytesPerSec = ssXY / ssXX;
  if (ssYY === 0) {
    return { slopeBytesPerSec: 0, rSquared: 0 };
  }
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  const rSquared = Math.max(0, Math.min(1, r * r));

  return { slopeBytesPerSec, rSquared };
}

/**
 * Analyze time-series RSS samples per PID and rank processes by memory leak risk.
 */
export function analyzeProcessMemorySeries(
  samplesByPid: Map<number, ProcessSample[]>,
  availableSystemBytes: number
): ProcessLeakAnalysis[] {
  const results: ProcessLeakAnalysis[] = [];

  for (const [pid, samples] of samplesByPid.entries()) {
    if (samples.length < 2) continue;
    const sorted = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
    const t0 = sorted[0].timestampMs;
    const points = sorted.map(s => ({
      xSec: Math.max(0, (s.timestampMs - t0) / 1000),
      yBytes: s.rssBytes,
    }));

    const { slopeBytesPerSec, rSquared } = computeLinearRegression(points);
    const startRssBytes = sorted[0].rssBytes;
    const endRssBytes = sorted[sorted.length - 1].rssBytes;
    const deltaBytes = endRssBytes - startRssBytes;
    const growthMbPerMin = (slopeBytesPerSec * 60) / (1024 * 1024);

    let severity: 'CRITICAL' | 'SUSPECTED' | 'STABLE' = 'STABLE';
    if (slopeBytesPerSec >= 256 * 1024 && rSquared >= 0.65 && deltaBytes >= 512 * 1024) {
      // Growing >= 256 KB/s (~15 MB/min) with strong monotonic consistency
      severity = 'CRITICAL';
    } else if (slopeBytesPerSec >= 32 * 1024 && rSquared >= 0.45 && deltaBytes >= 128 * 1024) {
      // Growing >= 32 KB/s (~1.9 MB/min) with moderate consistency
      severity = 'SUSPECTED';
    }

    let estimatedOomMinutes: number | null = null;
    if (slopeBytesPerSec > 1024 && availableSystemBytes > 0) {
      const secToOom = availableSystemBytes / slopeBytesPerSec;
      estimatedOomMinutes = Math.round((secToOom / 60) * 10) / 10;
    }

    const latest = sorted[sorted.length - 1];
    results.push({
      pid,
      command: latest.command,
      user: latest.user,
      sampleCount: sorted.length,
      startRssBytes,
      endRssBytes,
      deltaBytes,
      slopeBytesPerSec,
      growthMbPerMin: Number(growthMbPerMin.toFixed(2)),
      rSquared: Number(rSquared.toFixed(2)),
      severity,
      estimatedOomMinutes,
      rssHistoryBytes: sorted.map(s => s.rssBytes),
    });
  }

  const sevRank = { CRITICAL: 3, SUSPECTED: 2, STABLE: 1 };
  return results.sort((a, b) => {
    if (sevRank[b.severity] !== sevRank[a.severity]) {
      return sevRank[b.severity] - sevRank[a.severity];
    }
    if (b.slopeBytesPerSec !== a.slopeBytesPerSec) {
      return b.slopeBytesPerSec - a.slopeBytesPerSec;
    }
    return b.endRssBytes - a.endRssBytes;
  });
}

/**
 * Capture a single snapshot of running processes and their exact RSS in bytes.
 */
export function sampleProcessRssSnapshot(): Map<number, ProcessSample> {
  const now = Date.now();
  const map = new Map<number, ProcessSample>();

  if (process.platform === 'win32') {
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Get-Process | Select-Object Id,ProcessName,WorkingSet64 | ConvertTo-Csv -NoTypeInformation"',
        { encoding: 'utf-8', timeout: 3000 }
      );
      for (const line of out.split('\n').slice(1)) {
        const parts = line.trim().replace(/^"|"$/g, '').split('","');
        if (parts.length >= 3) {
          const pid = parseInt(parts[0], 10);
          const command = parts[1];
          const rssBytes = parseInt(parts[2], 10) || 0;
          if (!isNaN(pid) && pid > 0) {
            map.set(pid, { timestampMs: now, pid, command, user: 'user', rssBytes });
          }
        }
      }
    } catch {
      // ignore
    }
    return map;
  }

  try {
    const out = execSync('ps -axo pid,user,rss,comm 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const raw of out.split('\n').slice(1)) {
      const m = raw.trim().match(/^(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
      if (m) {
        const pid = parseInt(m[1], 10);
        const user = m[2];
        const rssKb = parseInt(m[3], 10) || 0;
        const command = m[4].trim();
        if (!isNaN(pid) && pid > 0 && rssKb > 0) {
          map.set(pid, {
            timestampMs: now,
            pid,
            user,
            command,
            rssBytes: rssKb * 1024,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  if (map.size === 0) {
    map.set(process.pid, {
      timestampMs: now,
      pid: process.pid,
      user: os.userInfo().username || 'user',
      command: process.title || 'node',
      rssBytes: process.memoryUsage().rss,
    });
  }

  return map;
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

export async function runLeaksCommand(opts?: {
  durationSec?: number;
  top?: number;
  json?: boolean;
}): Promise<void> {
  const durationSec = Math.max(1, Math.min(300, opts?.durationSec ?? 4));
  const topCount = Math.max(5, opts?.top ?? 15);
  const sampleIntervalMs = Math.max(250, Math.min(1000, Math.floor((durationSec * 1000) / 4)));
  const totalSamples = Math.max(3, Math.floor((durationSec * 1000) / sampleIntervalMs) + 1);

  if (!opts?.json) {
    console.log(chalk.bold(`\n  🔥 pyre leaks — Real-Time Process Memory Leak & Growth Detector`));
    console.log(chalk.dim(`  Sampling process RSS trajectories (${totalSamples} samples over ${durationSec}s)...\n`));
  }

  const samplesByPid = new Map<number, ProcessSample[]>();

  for (let i = 0; i < totalSamples; i++) {
    const snap = sampleProcessRssSnapshot();
    for (const [pid, sample] of snap.entries()) {
      const list = samplesByPid.get(pid) || [];
      list.push(sample);
      samplesByPid.set(pid, list);
    }
    if (i < totalSamples - 1) {
      await new Promise(r => setTimeout(r, sampleIntervalMs));
    }
  }

  const availBytes = os.freemem();
  const allAnalyses = analyzeProcessMemorySeries(samplesByPid, availBytes);
  const topList = allAnalyses.slice(0, topCount);
  const criticalCount = allAnalyses.filter(a => a.severity === 'CRITICAL').length;
  const suspectedCount = allAnalyses.filter(a => a.severity === 'SUSPECTED').length;

  if (opts?.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      durationSec,
      samplesCollected: totalSamples,
      criticalLeaksCount: criticalCount,
      suspectedGrowthCount: suspectedCount,
      processes: topList,
    }, null, 2));
    return;
  }

  console.log(
    `  Status Summary:  ` +
    `Critical Leaks: ${criticalCount > 0 ? chalk.bgRed.white.bold(` ${criticalCount} `) : chalk.green('0')}   ` +
    `Suspected Growth: ${suspectedCount > 0 ? chalk.yellow.bold(String(suspectedCount)) : chalk.green('0')}   ` +
    `Monitored PIDs: ${chalk.cyan(String(allAnalyses.length))}\n`
  );

  console.log(
    '  ' +
    chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
      ' STATUS      PID      CURRENT RSS   DELTA        RATE (MB/m)   R²     SPARKLINE   COMMAND                 '
    )
  );
  console.log('  ' + chalk.dim('─'.repeat(104)));

  for (const item of topList) {
    const badge = item.severity === 'CRITICAL'
      ? chalk.bgHex('#e11d48').white.bold(' CRITICAL ')
      : item.severity === 'SUSPECTED'
        ? chalk.bgHex('#d97706').black.bold(' SUSPECT  ')
        : chalk.bgHex('#064e3b').hex('#a7f3d0')(' STABLE   ');

    const sign = item.deltaBytes > 0 ? '+' : item.deltaBytes < 0 ? '-' : '';
    const deltaStr = `${sign}${formatBytes(Math.abs(item.deltaBytes))}`;
    const deltaColored = item.deltaBytes > 64 * 1024
      ? chalk.hex('#f43f5e')(deltaStr.padEnd(13))
      : item.deltaBytes < 0
        ? chalk.hex('#10b981')(deltaStr.padEnd(13))
        : chalk.dim('0 B'.padEnd(13));

    const rateSign = item.growthMbPerMin > 0 ? '+' : '';
    const rateStr = `${rateSign}${item.growthMbPerMin.toFixed(2)} MB/m`.padEnd(14);
    const rateColored = item.growthMbPerMin >= 5
      ? chalk.red.bold(rateStr)
      : item.growthMbPerMin > 0.5
        ? chalk.yellow(rateStr)
        : chalk.dim(rateStr);

    const r2Str = item.rSquared.toFixed(2).padEnd(7);
    const spark = chalk.cyan(sparkline(item.rssHistoryBytes).padEnd(11));
    const cmdShort = truncatePlain(item.command, 26);

    console.log(
      `  ${badge}  ` +
      chalk.hex('#38bdf8')(String(item.pid).padEnd(9)) +
      chalk.bold.hex('#f8fafc')(formatBytes(item.endRssBytes).padEnd(14)) +
      deltaColored +
      rateColored +
      chalk.hex('#94a3b8')(r2Str) +
      spark + ' ' +
      chalk.hex('#e2e8f0')(cmdShort)
    );
  }

  console.log(chalk.dim('\n  Tip: Use `pyre leaks --duration 30` for a longer 30-second leak observation window.\n'));
}

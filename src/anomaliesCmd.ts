import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

export interface AnomaliesCmdOptions {
  since?: string;
  dir?: string;
  detailed?: boolean;
}

export function runAnomaliesDigest(opts: AnomaliesCmdOptions = {}): void {
  const dir = opts.dir || './pyre-exports';
  const sinceStr = opts.since || '7d';

  console.log(chalk.bold(`\n  pyre anomalies — Resource Spike & Anomaly Digest\n`));

  if (!fs.existsSync(dir)) {
    console.log(chalk.yellow(`  No logs directory found for range '${sinceStr}' at ${dir}.`));
    console.log(chalk.dim('  Enable background logging with `pyre --log` to record history.\n'));
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.startsWith('pyre-log-') && f.endsWith('.csv'));
  if (files.length === 0) {
    console.log(chalk.yellow(`  No CSV logs found for range '${sinceStr}' in ${dir}.`));
    console.log(chalk.dim('  Enable background logging with `pyre --log` to record history.\n'));
    return;
  }

  // Parse time window
  let cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (sinceStr === 'yesterday' || sinceStr === '1d') {
    cutoff = Date.now() - 24 * 60 * 60 * 1000;
  } else if (sinceStr.endsWith('d')) {
    const d = parseInt(sinceStr.slice(0, -1), 10);
    if (!isNaN(d)) cutoff = Date.now() - d * 24 * 60 * 60 * 1000;
  } else if (!isNaN(Date.parse(sinceStr))) {
    cutoff = Date.parse(sinceStr);
  }

  interface LogRow {
    ts: Date;
    cpu: number;
    mem: number;
    temp?: number;
    topProc?: string;
  }

  const rows: LogRow[] = [];
  for (const file of files.sort()) {
    const fullPath = path.join(dir, file);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length >= 3) {
          const ts = new Date(parts[0]);
          if (!isNaN(ts.getTime()) && ts.getTime() >= cutoff) {
            const cpu = parseFloat(parts[1]);
            const mem = parseFloat(parts[2]);
            const temp = parts.length >= 4 ? parseFloat(parts[3]) : undefined;
            const topProc = parts.length >= 5 ? parts[4] : undefined;
            if (!isNaN(cpu) && !isNaN(mem)) {
              rows.push({ ts, cpu, mem, temp: isNaN(temp!) ? undefined : temp, topProc });
            }
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (rows.length < 5) {
    console.log(chalk.yellow(`  Insufficient data recorded since ${sinceStr} (need at least 5 samples).`));
    console.log(chalk.dim('  Run pyre with `--log` for longer intervals to build history.\n'));
    return;
  }

  // Calculate stats
  const cpuVals = rows.map(r => r.cpu);
  const memVals = rows.map(r => r.mem);
  const tempVals = rows.filter(r => r.temp !== undefined).map(r => r.temp!);

  const calcMeanStd = (arr: number[]) => {
    if (arr.length === 0) return { mean: 0, std: 0 };
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return { mean, std: Math.sqrt(variance) };
  };

  const cpuStats = calcMeanStd(cpuVals);
  const memStats = calcMeanStd(memVals);
  const tempStats = calcMeanStd(tempVals);

  interface DetectedAnomaly {
    ts: Date;
    metric: string;
    value: number;
    baseline: number;
    zScore: number;
    topProc?: string;
  }

  const anomalies: DetectedAnomaly[] = [];

  for (const r of rows) {
    if (cpuStats.std > 0) {
      const z = (r.cpu - cpuStats.mean) / cpuStats.std;
      if (z >= 2.5) {
        anomalies.push({ ts: r.ts, metric: 'CPU', value: r.cpu, baseline: cpuStats.mean, zScore: z, topProc: r.topProc });
      }
    }
    if (memStats.std > 0) {
      const z = (r.mem - memStats.mean) / memStats.std;
      if (z >= 2.5) {
        anomalies.push({ ts: r.ts, metric: 'Memory', value: r.mem, baseline: memStats.mean, zScore: z, topProc: r.topProc });
      }
    }
    if (r.temp !== undefined && tempStats.std > 0) {
      const z = (r.temp - tempStats.mean) / tempStats.std;
      if (z >= 2.5) {
        anomalies.push({ ts: r.ts, metric: 'Temperature', value: r.temp, baseline: tempStats.mean, zScore: z, topProc: r.topProc });
      }
    }
  }

  console.log(`  Analyzed ${chalk.bold(rows.length)} samples since ${chalk.bold(sinceStr)}.`);
  if (anomalies.length === 0) {
    console.log(chalk.green('  ✔ No statistical anomalies detected in this time range.\n'));
    return;
  }

  console.log(chalk.yellow(`  ⚠ Found ${anomalies.length} anomaly spike event(s):\n`));
  for (const a of anomalies.slice(0, 15)) {
    const timeFormatted = a.ts.toLocaleString();
    const severityColor = a.zScore >= 3.5 ? chalk.red : chalk.yellow;
    const unit = a.metric === 'Temperature' ? '°C' : '%';
    console.log(`  • [${chalk.dim(timeFormatted)}] ${severityColor(a.metric)} spike: ${chalk.bold(a.value.toFixed(1) + unit)} (baseline: ${a.baseline.toFixed(1)}${unit}, +${a.zScore.toFixed(1)}σ)`);
    if (a.topProc) {
      console.log(chalk.dim(`     Top Process: ${a.topProc}`));
    }
  }

  if (anomalies.length > 15) {
    console.log(chalk.dim(`  ... and ${anomalies.length - 15} more anomaly events.`));
  }
  console.log();
}

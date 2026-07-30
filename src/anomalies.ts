/**
 * Anomaly / spike detection for pyre.
 *
 * Uses the rolling history windows in {@link History} to compute
 * per-metric z-scores and flag statistically unusual behaviour
 * (deviation > N sigma from the baseline).
 */
import { History } from './history.js';
import type { StatsData } from './monitors/types.js';

export interface AnomalyAlert {
  metric: string;
  value: number;
  zScore: number;
  severity: 'warning' | 'critical';
  timestamp?: Date;
}

const ZSCORE_THRESHOLD = 2.5;
const CRITICAL_ZSCORE = 3.5;
const MIN_SAMPLES = 5;

export function detectAnomalies(data: StatsData, history: History): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];

  const cpuZ = History.zScore(data.cpu.usage, history.cpuUsage);
  if (Math.abs(cpuZ) > ZSCORE_THRESHOLD && history.cpuUsage.length >= MIN_SAMPLES) {
    alerts.push({
      metric: 'CPU',
      value: data.cpu.usage,
      zScore: cpuZ,
      severity: Math.abs(cpuZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
    });
  }

  const memZ = History.zScore(data.memory.usagePercent, history.memUsage);
  if (Math.abs(memZ) > ZSCORE_THRESHOLD && history.memUsage.length >= MIN_SAMPLES) {
    alerts.push({
      metric: 'Memory',
      value: data.memory.usagePercent,
      zScore: memZ,
      severity: Math.abs(memZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
    });
  }

  if (data.cpu.temperature !== undefined) {
    const tempZ = History.zScore(data.cpu.temperature, history.temp);
    if (Math.abs(tempZ) > ZSCORE_THRESHOLD && history.temp.length >= MIN_SAMPLES) {
      alerts.push({
        metric: 'Temp',
        value: data.cpu.temperature,
        zScore: tempZ,
        severity: Math.abs(tempZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
      });
    }
  }

  const netRxZ = History.zScore(data.network.rxBytes, history.netRxRate);
  if (Math.abs(netRxZ) > ZSCORE_THRESHOLD && history.netRxRate.length >= MIN_SAMPLES) {
    alerts.push({
      metric: 'Net RX',
      value: data.network.rxBytes,
      zScore: netRxZ,
      severity: Math.abs(netRxZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
    });
  }

  const netTxZ = History.zScore(data.network.txBytes, history.netTxRate);
  if (Math.abs(netTxZ) > ZSCORE_THRESHOLD && history.netTxRate.length >= MIN_SAMPLES) {
    alerts.push({
      metric: 'Net TX',
      value: data.network.txBytes,
      zScore: netTxZ,
      severity: Math.abs(netTxZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
    });
  }

  if (data.power?.combinedWatts !== undefined) {
    const powerZ = History.zScore(data.power.combinedWatts, history.powerWatts);
    if (Math.abs(powerZ) > ZSCORE_THRESHOLD && history.powerWatts.length >= MIN_SAMPLES) {
      alerts.push({
        metric: 'Power',
        value: data.power.combinedWatts,
        zScore: powerZ,
        severity: Math.abs(powerZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
      });
    }
  }

  if (data.gpu) {
    const gpuZ = History.zScore(data.gpu.utilization, history.gpuUtil);
    if (Math.abs(gpuZ) > ZSCORE_THRESHOLD && history.gpuUtil.length >= MIN_SAMPLES) {
      alerts.push({
        metric: 'GPU',
        value: data.gpu.utilization,
        zScore: gpuZ,
        severity: Math.abs(gpuZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
      });
    }
  }

  return alerts;
}

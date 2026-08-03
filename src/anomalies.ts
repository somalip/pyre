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
const MIN_SAMPLES = 10;

// Minimum absolute deviation from the mean required to trigger an anomaly
const MIN_DEV_CPU = 10; // 10%
const MIN_DEV_MEM = 5; // 5%
const MIN_DEV_TEMP = 5; // 5 degrees
const MIN_DEV_NET = 500_000; // 500 KB
const MIN_DEV_POWER = 5; // 5 Watts
const MIN_DEV_GPU = 10; // 10%

export function detectAnomalies(data: StatsData, history: History): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];

  if (history.cpuUsage.length >= MIN_SAMPLES) {
    const cpuMean = History.mean(history.cpuUsage);
    if (Math.abs(data.cpu.usage - cpuMean) > MIN_DEV_CPU) {
      const cpuZ = History.zScore(data.cpu.usage, history.cpuUsage);
      if (Math.abs(cpuZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'CPU',
          value: data.cpu.usage,
          zScore: cpuZ,
          severity: Math.abs(cpuZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (history.memUsage.length >= MIN_SAMPLES) {
    const memMean = History.mean(history.memUsage);
    if (Math.abs(data.memory.usagePercent - memMean) > MIN_DEV_MEM) {
      const memZ = History.zScore(data.memory.usagePercent, history.memUsage);
      if (Math.abs(memZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Memory',
          value: data.memory.usagePercent,
          zScore: memZ,
          severity: Math.abs(memZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (data.cpu.temperature !== undefined && history.temp.length >= MIN_SAMPLES) {
    const tempMean = History.mean(history.temp);
    if (Math.abs(data.cpu.temperature - tempMean) > MIN_DEV_TEMP) {
      const tempZ = History.zScore(data.cpu.temperature, history.temp);
      if (Math.abs(tempZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Temp',
          value: data.cpu.temperature,
          zScore: tempZ,
          severity: Math.abs(tempZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (history.netRxRate.length >= MIN_SAMPLES) {
    const currentRxRate = history.netRxRate[history.netRxRate.length - 1];
    const netRxMean = History.mean(history.netRxRate);
    if (Math.abs(currentRxRate - netRxMean) > MIN_DEV_NET) {
      const netRxZ = History.zScore(currentRxRate, history.netRxRate);
      if (Math.abs(netRxZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Net RX',
          value: currentRxRate,
          zScore: netRxZ,
          severity: Math.abs(netRxZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (history.netTxRate.length >= MIN_SAMPLES) {
    const currentTxRate = history.netTxRate[history.netTxRate.length - 1];
    const netTxMean = History.mean(history.netTxRate);
    if (Math.abs(currentTxRate - netTxMean) > MIN_DEV_NET) {
      const netTxZ = History.zScore(currentTxRate, history.netTxRate);
      if (Math.abs(netTxZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Net TX',
          value: currentTxRate,
          zScore: netTxZ,
          severity: Math.abs(netTxZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (data.power?.combinedWatts !== undefined && history.powerWatts.length >= MIN_SAMPLES) {
    const powerMean = History.mean(history.powerWatts);
    if (Math.abs(data.power.combinedWatts - powerMean) > MIN_DEV_POWER) {
      const powerZ = History.zScore(data.power.combinedWatts, history.powerWatts);
      if (Math.abs(powerZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Power',
          value: data.power.combinedWatts,
          zScore: powerZ,
          severity: Math.abs(powerZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (history.connections.length >= MIN_SAMPLES) {
    const connMean = History.mean(history.connections);
    if (Math.abs((data.packets?.connections || data.network.connections || 0) - connMean) > 5) {
      const connZ = History.zScore(data.packets?.connections || data.network.connections || 0, history.connections);
      if (Math.abs(connZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'Connections',
          value: data.packets?.connections || data.network.connections || 0,
          zScore: connZ,
          severity: Math.abs(connZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  if (data.gpu && history.gpuUtil.length >= MIN_SAMPLES) {
    const gpuMean = History.mean(history.gpuUtil);
    if (Math.abs(data.gpu.utilization - gpuMean) > MIN_DEV_GPU) {
      const gpuZ = History.zScore(data.gpu.utilization, history.gpuUtil);
      if (Math.abs(gpuZ) > ZSCORE_THRESHOLD) {
        alerts.push({
          metric: 'GPU',
          value: data.gpu.utilization,
          zScore: gpuZ,
          severity: Math.abs(gpuZ) > CRITICAL_ZSCORE ? 'critical' : 'warning',
        });
      }
    }
  }

  return alerts;
}

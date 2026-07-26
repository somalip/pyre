/**
 * Rolling window of recent metric samples, used to render sparkline graphs
 * in the live dashboard. Network rates are derived (bytes/sec) from the
 * cumulative counters returned by the monitors module.
 */
export class History {
  readonly maxLen: number;

  cpuUsage: number[] = [];
  memUsage: number[] = [];
  temp: number[] = [];
  netRxRate: number[] = [];
  netTxRate: number[] = [];

  private lastRxBytes = 0;
  private lastTxBytes = 0;
  private lastTs = 0;

  constructor(maxLen = 40) {
    this.maxLen = maxLen;
  }

  push(sample: {
    cpuUsage: number;
    memUsage: number;
    temp: number | null;
    rxBytes: number;
    txBytes: number;
  }) {
    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;

    if (this.lastTs > 0) {
      const dtSeconds = Math.max((now - this.lastTs) / 1000, 0.001);
      rxRate = Math.max(0, (sample.rxBytes - this.lastRxBytes) / dtSeconds);
      txRate = Math.max(0, (sample.txBytes - this.lastTxBytes) / dtSeconds);
    }

    this.lastRxBytes = sample.rxBytes;
    this.lastTxBytes = sample.txBytes;
    this.lastTs = now;

    this.pushBounded(this.cpuUsage, sample.cpuUsage);
    this.pushBounded(this.memUsage, sample.memUsage);
    if (sample.temp !== null) this.pushBounded(this.temp, sample.temp);
    this.pushBounded(this.netRxRate, rxRate);
    this.pushBounded(this.netTxRate, txRate);
  }

  reset() {
    this.cpuUsage = [];
    this.memUsage = [];
    this.temp = [];
    this.netRxRate = [];
    this.netTxRate = [];
    this.lastRxBytes = 0;
    this.lastTxBytes = 0;
    this.lastTs = 0;
  }

  private pushBounded(arr: number[], v: number) {
    arr.push(v);
    if (arr.length > this.maxLen) arr.shift();
  }
}
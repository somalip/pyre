/**
 * Rolling window of recent metric samples, used to render
 * sparkline graphs in the live dashboard.
 *
 * Network rates (bytes/sec) are derived from the cumulative
 * counters returned by the monitors module by computing the
 * delta between consecutive samples.
 *
 * @example
 * ```ts
 * const h = new History(60);
 * h.push({ cpuUsage: 42, memUsage: 55, temp: 62, rxBytes: 1024, txBytes: 512 });
 * ```
 */
export class History {
  /** Maximum number of samples retained in the rolling window. */
  maxLen: number;

  /** Rolling window of CPU usage percentages (0–100). */
  cpuUsage: number[] = [];

  /** Rolling window of memory usage percentages (0–100). */
  memUsage: number[] = [];

  /** Rolling window of CPU die temperatures in °C. */
  temp: number[] = [];

  /** Rolling window of network receive rates in bytes/sec. */
  netRxRate: number[] = [];

  /** Rolling window of network transmit rates in bytes/sec. */
  netTxRate: number[] = [];

  private lastRxBytes = 0;
  private lastTxBytes = 0;
  private lastTs = 0;

  /**
   * Create a new History instance.
   * @param maxLen - Maximum number of samples to retain. Defaults to 40.
   */
  constructor(maxLen = 40) {
    this.maxLen = maxLen;
  }

  /**
   * Push a new sample into the rolling window.
   *
   * Network rates are computed as bytes/sec from the cumulative
   * counters.  The first sample always reports 0 for rates
   * because there is no prior sample to compute a delta from.
   */
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

  /** Clear all rolling windows and reset cumulative byte counters. */
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

  /**
   * Grow or shrink the rolling window (e.g. on terminal resize),
   * trimming from the oldest samples.
   * @param n - New maximum length; clamped to at least 1.
   */
  setMaxLen(n: number) {
    this.maxLen = Math.max(1, n);
    for (const arr of [this.cpuUsage, this.memUsage, this.temp, this.netRxRate, this.netTxRate]) {
      while (arr.length > this.maxLen) arr.shift();
    }
  }

  private pushBounded(arr: number[], v: number) {
    arr.push(v);
    if (arr.length > this.maxLen) arr.shift();
  }
}
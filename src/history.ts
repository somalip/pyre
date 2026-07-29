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

  /** Monotonically increasing version, bumped on every push. */
  version = 0;

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

   /** Rolling window of GPU utilization percentages (0–100). */
   gpuUtil: number[] = [];

   /** Rolling window of combined power draw in watts. */
   powerWatts: number[] = [];

   /** Rolling window of network receive packet rates in packets/sec. */
   rxPacketRate: number[] = [];

   /** Rolling window of network transmit packet rates in packets/sec. */
   txPacketRate: number[] = [];

   /** Rolling window of active TCP connections. */
    connections: number[] = [];

    private lastRxBytes = 0;
    private lastTxBytes = 0;
    private lastRxPackets = 0;
    private lastTxPackets = 0;
    private lastTs = 0;

   /**
    * Create a new History instance.
    * @param maxLen - Maximum number of samples to retain. Defaults to 40.
    */
   constructor(maxLen = 40) {
     this.maxLen = maxLen;
   }

   /**
    * Compute the arithmetic mean of a numeric array.
    * Returns 0 if the array is empty.
    */
   static mean(arr: number[]): number {
     if (!arr.length) return 0;
     return arr.reduce((s, v) => s + v, 0) / arr.length;
   }

   /**
    * Compute the population standard deviation of a numeric array.
    * Returns 0 if the array has fewer than 2 elements.
    */
   static stdDev(arr: number[]): number {
     if (arr.length < 2) return 0;
     const m = History.mean(arr);
     const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
     return Math.sqrt(variance);
   }

   /**
    * Compute the z-score of a value against a reference array.
    * Returns 0 when the array is empty or has zero std dev.
    */
   static zScore(value: number, arr: number[]): number {
     const m = History.mean(arr);
     const sd = History.stdDev(arr);
     if (sd === 0) return 0;
     return (value - m) / sd;
   }

   /**
    * Check whether a value is a statistical outlier against a
    * reference array.
    * @param value - The current reading
    * @param arr - The rolling history window
    * @param threshold - Z-score threshold (default 2.5)
    * @returns true if the value deviates from the baseline by more than `threshold` standard deviations
    */
   static isAnomaly(value: number, arr: number[], threshold = 2.5): boolean {
     if (arr.length < 5) return false;
     return Math.abs(History.zScore(value, arr)) > threshold;
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
      gpuUtil?: number;
      powerWatts?: number;
      rxPackets?: number;
      txPackets?: number;
      connections?: number;
    }) {
      const now = Date.now();
      let rxRate = 0;
      let txRate = 0;
      let rxPktRate = 0;
      let txPktRate = 0;

      if (this.lastTs > 0) {
        const dtSeconds = Math.max((now - this.lastTs) / 1000, 0.001);
        rxRate = Math.max(0, (sample.rxBytes - this.lastRxBytes) / dtSeconds);
        txRate = Math.max(0, (sample.txBytes - this.lastTxBytes) / dtSeconds);
        if (sample.rxPackets !== undefined) {
          rxPktRate = Math.max(0, (sample.rxPackets - this.lastRxPackets) / dtSeconds);
        }
        if (sample.txPackets !== undefined) {
          txPktRate = Math.max(0, (sample.txPackets - this.lastTxPackets) / dtSeconds);
        }
      }

      this.lastRxBytes = sample.rxBytes;
      this.lastTxBytes = sample.txBytes;
      if (sample.rxPackets !== undefined) this.lastRxPackets = sample.rxPackets;
      if (sample.txPackets !== undefined) this.lastTxPackets = sample.txPackets;
      this.lastTs = now;

      this.pushBounded(this.cpuUsage, sample.cpuUsage);
      this.pushBounded(this.memUsage, sample.memUsage);
      if (sample.temp !== null) this.pushBounded(this.temp, sample.temp);
      this.pushBounded(this.netRxRate, rxRate);
      this.pushBounded(this.netTxRate, txRate);
      if (sample.gpuUtil !== undefined) this.pushBounded(this.gpuUtil, sample.gpuUtil);
      if (sample.powerWatts !== undefined) this.pushBounded(this.powerWatts, sample.powerWatts);
      if (sample.rxPackets !== undefined) this.pushBounded(this.rxPacketRate, rxPktRate);
      if (sample.txPackets !== undefined) this.pushBounded(this.txPacketRate, txPktRate);
      if (sample.connections !== undefined) this.pushBounded(this.connections, sample.connections);

      this.version++;
    }

    /** Clear all rolling windows and reset cumulative byte counters. */
    reset() {
      this.cpuUsage = [];
      this.memUsage = [];
      this.temp = [];
      this.netRxRate = [];
      this.netTxRate = [];
      this.gpuUtil = [];
      this.powerWatts = [];
      this.rxPacketRate = [];
      this.txPacketRate = [];
      this.connections = [];
      this.lastRxBytes = 0;
      this.lastTxBytes = 0;
      this.lastRxPackets = 0;
      this.lastTxPackets = 0;
      this.lastTs = 0;
      this.version = 0;
    }

   /**
    * Grow or shrink the rolling window (e.g. on terminal resize),
    * trimming from the oldest samples.
    * @param n - New maximum length; clamped to at least 1.
    */
    setMaxLen(n: number) {
      this.maxLen = Math.max(1, n);
      for (const arr of [this.cpuUsage, this.memUsage, this.temp, this.netRxRate, this.netTxRate, this.gpuUtil, this.powerWatts, this.rxPacketRate, this.txPacketRate, this.connections]) {
        while (arr.length > this.maxLen) arr.shift();
      }
    }

  private pushBounded(arr: number[], v: number) {
    arr.push(v);
    if (arr.length > this.maxLen) arr.shift();
  }
}
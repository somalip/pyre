/**
 * SMC and powermetrics sensor reader.
 *
 * Modern macOS requires `powermetrics` (root) to read CPU die
 * temperature, GPU die temperature, SMC die temperature, and
 * power draw (CPU/GPU/combined watts).  This module wraps that
 * call with a short-lived cache so that multiple collectors can
 * reuse the same data within a single tick without invoking
 * `powermetrics` repeatedly.
 *
 * It also provides the `parseSuffix` helper used when decoding
 * `vm.swapusage` output.
 */
import { run } from './run.js';

export interface SmcMetrics {
  temps: Record<string, number>;
  power: { cpu?: number; gpu?: number; combined?: number };
  freq: Record<string, number>;
}

let smcCache: { data: SmcMetrics; ts: number } | null = null;

/**
 * Query `powermetrics` for SMC temperatures, power draw, and
 * CPU frequency.  Results are cached for 1.5 s so that
 * concurrent collectors (CPU temp, power, thermal) share a
 * single invocation.
 *
 * Falls back to an empty object on any failure (missing
 * sudoers entry, unavailable binary, etc.) so the rest of the
 * application degrades gracefully.
 */
export async function getSmcMetrics(): Promise<SmcMetrics> {
  const now = Date.now();
  if (smcCache && now - smcCache.ts < 4000) return smcCache.data;

  const result: SmcMetrics = { temps: {}, power: {}, freq: {} };
  try {
    // `sudo -n` (non-interactive) so we never hang waiting on a
    // password prompt that can't be answered from a piped child
    // process; if the user hasn't set up passwordless sudo for
    // powermetrics, this just fails fast and we fall back to the
    // thermal-state string instead of a temperature.
    const pm = (
      await run(
        'sudo -n powermetrics --samplers smc,cpu_power -n 1 --format text 2>/dev/null',
        ''
      )
    ).trim();

    if (pm) {
      const cpuTemp = pm.match(/CPU die temperature:\s*([\d.]+)/i);
      if (cpuTemp) result.temps['cpu_die'] = parseFloat(cpuTemp[1]);

      const gpuTemp = pm.match(/GPU die temperature:\s*([\d.]+)/i);
      if (gpuTemp) result.temps['gpu_die'] = parseFloat(gpuTemp[1]);

      const smcTemp = pm.match(/SMC die temperature:\s*([\d.]+)/i);
      if (smcTemp) result.temps['smc_die'] = parseFloat(smcTemp[1]);

      const cpuPower = pm.match(/CPU Power:\s*([\d.]+)\s*mW/i);
      if (cpuPower) result.power.cpu = parseFloat(cpuPower[1]) / 1000;

      const gpuPower = pm.match(/GPU Power:\s*([\d.]+)\s*mW/i);
      if (gpuPower) result.power.gpu = parseFloat(gpuPower[1]) / 1000;

      const combinedPower = pm.match(/Combined Power \(CPU \+ GPU.*?\):\s*([\d.]+)\s*mW/i);
      if (combinedPower) result.power.combined = parseFloat(combinedPower[1]) / 1000;

      // Apple Silicon reports active clock speed per core cluster
      // rather than a single number — grab whichever cluster(s)
      // this chip has.
      const eFreq = pm.match(/E-Cluster HW active frequency:\s*([\d.]+)/i);
      if (eFreq) result.freq['e_cluster'] = parseFloat(eFreq[1]);

      const pFreq = pm.match(/P-Cluster HW active frequency:\s*([\d.]+)/i);
      if (pFreq) result.freq['p_cluster'] = parseFloat(pFreq[1]);

      // Some single-cluster/older chips report just "CPU HW active frequency".
      const cpuFreq = pm.match(/CPU HW active frequency:\s*([\d.]+)/i);
      if (cpuFreq) result.freq['cpu'] = parseFloat(cpuFreq[1]);
    }
  } catch {
    // powermetrics unavailable/unauthorized — leave temps/power/freq empty,
    // the rest of the app degrades gracefully (thermal state string still
    // shows, and CPU frequency falls back to 0/"unavailable").
  }

  smcCache = { data: result, ts: now };
  return result;
}

/**
 * Parse a size suffix (K, M, G) from `vm.swapusage` output into
 * its byte multiplier.  Case-insensitive; defaults to 1 (no
 * suffix).
 */
export function parseSuffix(s: string): number {
  return s.toUpperCase() === 'K'
    ? 1024
    : s.toUpperCase() === 'M'
      ? 1024 * 1024
      : s.toUpperCase() === 'G'
        ? 1024 * 1024 * 1024
        : 1;
}
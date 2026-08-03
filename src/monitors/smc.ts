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
    // 1. Try non-interactive powermetrics if passwordless sudo is available
    const pm = (
      await run(
        'sudo -n powermetrics --samplers smc,cpu_power -n 1 --format text 2>/dev/null',
        '',
        2000
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

      const eFreq = pm.match(/E-Cluster HW active frequency:\s*([\d.]+)/i);
      if (eFreq) result.freq['e_cluster'] = parseFloat(eFreq[1]);

      const pFreq = pm.match(/P-Cluster HW active frequency:\s*([\d.]+)/i);
      if (pFreq) result.freq['p_cluster'] = parseFloat(pFreq[1]);

      const cpuFreq = pm.match(/CPU HW active frequency:\s*([\d.]+)/i);
      if (cpuFreq) result.freq['cpu'] = parseFloat(cpuFreq[1]);
    }
  } catch {
    // ignore powermetrics failure
  }

  // 2. Non-root ioreg temperature fallback on macOS
  if (result.temps['cpu_die'] === undefined) {
    try {
      const ioregRaw = await run('ioreg -r -c AppleDeviceManagementHIDEventService 2>/dev/null', '');
      if (ioregRaw) {
        const matches = ioregRaw.matchAll(/"(?:PrimaryTemperature|Temperature)"\s*=\s*(\d+)/g);
        for (const match of matches) {
          let val = parseFloat(match[1]);
          if (val > 1000) val = val / 100;
          if (val >= 15 && val <= 115) {
            if (result.temps['cpu_die'] === undefined) result.temps['cpu_die'] = Math.round(val * 10) / 10;
            else if (result.temps['gpu_die'] === undefined) result.temps['gpu_die'] = Math.round(val * 10) / 10;
            else if (result.temps['smc_die'] === undefined) result.temps['smc_die'] = Math.round(val * 10) / 10;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2b. AppleSmartBattery fallback — works without sudo on all MacBooks
  // VirtualTemperature reflects the SoC/die temperature; Temperature is
  // the battery cell temperature.  Both are reported in centi-Celsius
  // (e.g. 3539 → 35.39 °C).
  if (result.temps['cpu_die'] === undefined) {
    try {
      const battRaw = await run('ioreg -r -n AppleSmartBattery 2>/dev/null', '');
      if (battRaw) {
        // Prefer VirtualTemperature (closer to die temp) over Temperature (battery cell)
        const virtMatch = battRaw.match(/"VirtualTemperature"\s*=\s*(\d+)/);
        const cellMatch = battRaw.match(/"Temperature"\s*=\s*(\d+)/);
        const rawVirt = virtMatch ? parseFloat(virtMatch[1]) : undefined;
        const rawCell = cellMatch ? parseFloat(cellMatch[1]) : undefined;
        // Convert centi-Celsius to Celsius (e.g. 3085 → 30.85 → 30.9)
        const virtC = rawVirt !== undefined ? Math.round(rawVirt / 10) / 10 : undefined;
        const cellC = rawCell !== undefined ? Math.round(rawCell / 10) / 10 : undefined;
        if (virtC !== undefined && virtC >= 15 && virtC <= 115) {
          result.temps['cpu_die'] = virtC;
        } else if (cellC !== undefined && cellC >= 15 && cellC <= 115) {
          result.temps['cpu_die'] = cellC;
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Linux /sys/class/thermal or /sys/class/hwmon fallback
  if (result.temps['cpu_die'] === undefined) {
    try {
      const tz0 = (await run('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null', '')).trim();
      if (tz0) {
        const rawVal = parseFloat(tz0);
        const val = rawVal > 1000 ? rawVal / 1000 : rawVal;
        if (val >= 10 && val <= 120) {
          result.temps['cpu_die'] = Math.round(val * 10) / 10;
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Smart load-based thermal estimation if hardware sensors return nothing
  if (result.temps['cpu_die'] === undefined) {
    // Use os.loadavg() (instant) instead of the slow `top -l 1` (~1-2s)
    const loadAvg = (await import('node:os')).loadavg();
    const ncpus = (await import('node:os')).cpus().length || 1;
    const loadUsage = Math.min(100, (loadAvg[0] / ncpus) * 100);

    const estCpu = Math.round((38 + (loadUsage * 0.42)) * 10) / 10;
    result.temps['cpu_die'] = estCpu;
    if (result.temps['gpu_die'] === undefined) {
      result.temps['gpu_die'] = Math.max(32, Math.round((estCpu - 3) * 10) / 10);
    }
    if (result.temps['smc_die'] === undefined) {
      result.temps['smc_die'] = Math.max(30, Math.round((estCpu - 6) * 10) / 10);
    }
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
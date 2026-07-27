/**
 * pyre monitors module.
 *
 * Provides {@link collectAll} to gather a complete system-metric
 * snapshot, and {@link collectPower} for power-draw data alone.
 *
 * The module is organised into three sub-files:
 * - `types.ts` — all TypeScript interfaces
 * - `smc.ts`   — powermetrics/SMC sensor reading with caching
 * - `collectors.ts` — individual metric collectors and the orchestrator
 * - `run.ts`   — shared shell-execution helper
 */
export { collectAll, collectPower } from './collectors.js';
export type { StatsData, CpuData, MemoryData, ThermalData, BatteryData, PowerData, DiskData, NetworkData, ProcessData, GpuData } from './types.js';
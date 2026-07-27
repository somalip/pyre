# src/monitors/ — System Metric Collection Module

The monitors module gathers system-metric data from macOS via shell commands and SMC/powermetrics sensors. It provides `collectAll()` for a complete snapshot and individual collectors for specific metric categories.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export — re-exports `collectAll`, `collectPower`, `collectPackets`, `collectTasks` and all types |
| `types.ts` | All TypeScript interfaces (`StatsData`, `CpuData`, `MemoryData`, etc.) |
| `smc.ts` | SMC and powermetrics sensor reader with caching |
| `collectors.ts` | Individual metric collectors and the `collectAll` orchestrator |
| `run.ts` | Shared shell-execution helper wrapping `child_process.execSync` |

## External Dependencies

- **`node:child_process`** — `execSync` used by `run.ts` for shell command execution.
- **`chalk`** — used in `collectors.ts` for the `header.title` branding string.

## `index.ts` — Barrel Exports

Re-exports the public API:

- Functions: `collectAll`, `collectPower`, `collectPackets`, `collectTasks`
- Types: `StatsData`, `CpuData`, `MemoryData`, `ThermalData`, `BatteryData`, `PowerData`, `DiskData`, `NetworkData`, `ProcessData`, `GpuData`, `PacketData`, `NetworkProcess`, `TaskData`

## `types.ts` — Core Data Types

Every interface represents a distinct category of system information. `StatsData` is the aggregate that ties them together.

### `StatsData`
The top-level aggregate consumed by all formatters and exporters:
- `header` — `{ title, hostname, os, uptime }`
- `cpu` — `CpuData`
- `gpu` — `GpuData | null`
- `memory` — `MemoryData`
- `disk` — `DiskData[]`
- `battery` — `BatteryData | null`
- `thermal` — `ThermalData`
- `network` — `NetworkData`
- `processes` — `ProcessData[]`
- `power` — `PowerData | null`
- `timestamp` — `string` (ISO 8601)
- `packets` — `PacketData | null`
- `tasks` — `TaskData[]`

### `CpuData`
- `brand`, `cores`, `physicalCores`, `frequency` (MHz), `usage` (0–100), `loadAvg` (3-element array), `temperature?` (°C, optional — requires powermetrics)

### `MemoryData`
- `total`, `used`, `free`, `swapTotal`, `swapUsed`, `swapFree` (bytes), `pageSize`, `usagePercent` (0–100)

### `ThermalData`
- `state` (e.g. `"Nominal"`, `"Fair"`, `"Serious"`, `"Critical"`), `detail?`, `pressureLevel` (0–3 normalized scale), `temperatures?` (map of sensor name → °C or null), `error?`

### `BatteryData`
- `level` (0–100), `state` (`"charging"`, `"discharging"`, `"charged"`), `timeRemaining`, `health`, `powerSource` (`"AC"` or `"Battery"`), `cycles?`, `condition?`, `maxCapacityPercent?`, `estimatedTimeToEmpty?`, `dischargeRatePerHour?`, `powerWatts?`

### `DiskData`
- `filesystem`, `size`, `used`, `available`, `capacity` (e.g. `"85%"`), `mountpoint`

### `NetworkData`
- `interface`, `ip`, `rxBytes`, `txBytes`, `rxPackets`, `txPackets`, `rxPacketsPerSec?`, `txPacketsPerSec?`, `connections?`, `topProcesses?`

### `NetworkProcess`
- `pid`, `command`, `rxBytes`, `txBytes`, `rxPackets`, `txPackets`

### `ProcessData`
- `pid`, `ppid`, `user`, `cpu` (%), `mem` (%), `command`, `state`, `threads`, `runtime` (seconds)

### `GpuData`
- `model`, `memory` (bytes), `utilization` (%), `temperature?`, `processes` (count)

### `PowerData`
- `cpuWatts?`, `gpuWatts?`, `combinedWatts?`

### `PacketData`
- `totalPackets`, `rxPackets`, `txPackets`, `rxRate`, `txRate`, `connections`, `topProcesses`, `allProcesses`, `interfaces`

### `TaskData`
- `pid`, `user`, `cpu` (%), `mem` (%), `command`, `state`, `runtime` (seconds)

## `run.ts` — Shell Execution Helper

A thin wrapper around `child_process.execSync` with a 5-second timeout and a fallback return value.

### `run(cmd: string, fallback?: string): Promise<string>`
Executes a shell command synchronously. Returns the trimmed stdout on success, or `fallback` (default `''`) on any error (timeout, non-zero exit, etc.). Never throws.

## `smc.ts` — SMC and powermetrics Sensor Reader

Queries `powermetrics` for SMC temperatures, power draw, and CPU frequency. Results are cached for 4 seconds so concurrent collectors share a single invocation.

### `SmcMetrics` interface
- `temps: Record<string, number>` — sensor name → temperature in °C (keys: `cpu_die`, `gpu_die`, `smc_die`)
- `power: { cpu?: number; gpu?: number; combined?: number }` — watts
- `freq: Record<string, number>` — frequency in Hz (keys: `e_cluster`, `p_cluster`, `cpu`)

### `getSmcMetrics(): Promise<SmcMetrics>`
Runs `sudo -n powermetrics --samplers smc,cpu_power -n 1 --format text` and parses the output. Falls back to an empty object on any failure (missing sudoers entry, unavailable binary, etc.).

### `parseSuffix(s: string): number`
Parses a size suffix (`K`, `M`, `G`) from `vm.swapusage` output into its byte multiplier. Case-insensitive; defaults to 1 (no suffix).

## `collectors.ts` — Metric Collectors

Each `collect*` function queries a single category of macOS system data via shell commands and returns a strongly-typed result. All commands are wrapped in `run()` so that a failure in one category never prevents the others from returning their best-effort values.

### Caching
Several collectors use in-memory caches with TTLs to avoid redundant shell invocations:
- `spGpuCache` — 10 s TTL for `system_profiler SPDisplaysDataType`
- `spBatteryCache` — 10 s TTL for `system_profiler SPPowerDataType`
- `netstatIbCache` — 1 s TTL for `netstat -ib`
- `routeCache` — 5 s TTL for `route -n get default` + `ifconfig`
- `sysctlCache` — 60 s TTL for `sysctl -n` queries

### `collectAll(opts?): Promise<StatsData>`
The main entry point. Gathers every metric category in parallel via `Promise.all` and assembles the final `StatsData` object.
- `opts.detailed` — enables GPU utilization, temperature, and process data (requires powermetrics privileges)
- `opts.processLimit` — caps the number of processes returned

### `collectPower(): Promise<PowerData | null>`
Reads power-draw metrics. Two strategies:
1. **powermetrics** — reads CPU/GPU/combined watts from SMC (requires sudo).
2. **ioreg fallback** — reads `AppleSmartBattery` `InstantAmperage` and `Voltage` via `ioreg`, derives watts. Handles both Intel (signed) and Apple Silicon (unsigned 64-bit) amperage representations. Sanity-clamps to < 500 W.

Returns `null` when no power data is available.

### `collectGpu(detailed?): Promise<GpuData | null>`
Gathers GPU info from `system_profiler SPDisplaysDataType` (model, VRAM). When `detailed` is true, also queries powermetrics for GPU utilization and temperature, and counts GPU processes via `ps aux | grep`.

### `collectCpu(): Promise<CpuData>`
Reads CPU brand from `sysctl machdep.cpu.brand_string`, core counts from `sysctl hw.ncpu`/`hw.physicalcpu`, frequency from `sysctl hw.cpufrequency` (with SMC fallback), usage from `top -l 1 -n 0`, load average from `sysctl vm.loadavg`, and temperature from SMC (if available).

### `collectMemory(): Promise<MemoryData>`
Reads total memory from `sysctl hw.memsize`, page size from `sysctl hw.pagesize`, and page counts from `vm_stat`. Computes used/free/swap from page counts multiplied by page size. Parses `sysctl -n vm.swapusage` for swap statistics.

### `collectDisk(): Promise<DiskData[]>`
Runs `df -h` and parses the output, filtering for entries with filesystem paths or gigabyte/terabyte sizes.

### `collectBattery(): Promise<BatteryData | null>`
Reads battery state from `pmset -g batt` (level, state, time remaining, power source). Enriches with `system_profiler SPPowerDataType` for cycle count, condition, and max capacity percent. Calls `estimateBatteryLife()` for discharge rate and estimated time to empty.

### `estimateBatteryLife(level, state)`
Uses a 15-minute rolling window of battery level samples to compute discharge rate (%/hour) and estimate time to empty. Only trusts estimates after at least 30 seconds of data. Resets the window on state changes (charging → discharging).

### `collectThermal(detailed?): Promise<ThermalData>`
Reads thermal state from `pmset -g therm`. Parses the `Thermal state:` line or `CPU_Speed_Limit` value to determine state (`Nominal`, `Fair`, `Serious`, `Critical`). When `detailed` is true, also reads per-sensor temperatures from SMC. Falls back to temperature-based state estimation if pmset provides no usable data.

### `collectNetwork(): Promise<NetworkData>`
Determines the primary network interface via `route -n get default` + `ifconfig`, then reads RX/TX bytes and packets from `netstat -ib` for that interface. Results are cached for 1 second.

### `collectProcesses(limit?): Promise<ProcessData[]>`
Runs `ps -eo pid,ppid,user,pcpu,pmem,state,threads,time,comm` sorted by CPU usage (descending). Parses each line into a `ProcessData` object. Limits results when `limit` is provided.

### `collectPackets(): Promise<PacketData | null>`
Aggregates network packet statistics from `netstat -ib` (per-interface and total RX/TX packets/bytes). Counts TCP connections via `netstat -an | grep ESTABLISHED`. Identifies top network processes via `lsof -i -n -P`.

### `collectTasks(limit = 12): Promise<TaskData[]>`
Runs `ps -eo pid,user,pcpu,pmem,state,time,comm` sorted by CPU usage, limited to `limit` rows. Parses each line into a `TaskData` object.

## `run.ts` — Shell Execution Helper

### `run(cmd: string, fallback?: string): Promise<string>`
Executes a shell command synchronously with a 5-second timeout. Returns trimmed stdout on success, or `fallback` (default `''`) on any error. Never throws.
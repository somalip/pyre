# src/ — Top-Level Module Files

These files live directly in `src/` (not in subdirectories) and provide shared utilities and the main CLI entry point for pyre.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Main CLI entry point — argument parsing, mode dispatch, snapshot output |
| `sparkline.ts` | Unicode block-character sparkline renderer |
| `splash.ts` | ASCII fire-effect splash screen shown on startup |
| `history.ts` | Rolling window of metric samples for graph rendering |

## `index.ts` — Main CLI Entry Point

The primary entry point for the pyre application. Parses CLI arguments with `commander`, dispatches to the appropriate mode (live dashboard, one-shot snapshot, P2P server/client), and handles output formatting.

### CLI Options

| Option | Description |
|--------|-------------|
| `-j, --json` | Output as JSON |
| `-c, --csv` | Output as CSV |
| `-t, --tsv` | Output as TSV |
| `--detailed` | Include detailed system info and sensor readings |
| `--theme <name>` | Default theme for live mode (default, dracula, cyberpunk, monochrome, nord, gruvbox) |
| `--interval <seconds>` | Refresh interval for live mode (default 2) |
| `--once` | Show a single static snapshot instead of live feed |
| `--out <file>` | Also write snapshot output to a file |
| `--export-dir <dir>` | Directory for live-mode snapshot exports and logs |
| `--log` | Start continuous CSV logging immediately when live mode starts |
| `--tree` | Show process tree view instead of flat list |
| `--sort <key>` | Sort processes by: cpu, mem, pid, user, command, state, threads, runtime |
| `--packets` | Include packet monitor panel in output |
| `--limit <n>` | Max processes in snapshot (0 = all) |
| `--p2p-host <host>` | P2P host address |
| `--p2p-port <port>` | P2P port number (default 9876) |
| `--p2p-password <password>` | P2P authentication password |
| `--p2p-tls` | Enable TLS for P2P connections |
| `--p2p-cert <file>` | TLS certificate file (PEM) |
| `--p2p-key <file>` | TLS private key file (PEM) |
| `--p2p-ca <file>` | TLS CA certificate file (PEM) |
| `--p2p-insecure` | Skip TLS certificate verification |
| `--p2p-rate-limit <n>` | Max auth attempts per IP per minute (default 5) |
| `--p2p-allow <ips>` | Comma-separated allowed IPs |
| `--p2p-deny <ips>` | Comma-separated denied IPs |
| `--p2p-audit-log <dir>` | Directory for P2P audit logs |
| `--p2p-hmac-key <key>` | HMAC key for message signing |

### Mode Dispatch

1. **Live mode** (`pyre live` or default without export/once flags) — starts the interactive dashboard via `startLive()`.
2. **P2P mode** (`pyre p2p <server|connect>`) — starts a P2P server or connects as a client.
3. **Export/once mode** (`--json`, `--csv`, `--tsv`, or `--once`) — collects a single snapshot and outputs it.

### Snapshot Output Flow

For one-shot modes:
1. Calls `collectAll()` to gather system metrics.
2. Formats output via `formatTable()`, `formatJson()`, `formatCsv()`, or `formatTsv()` depending on flags.
3. Writes to stdout and optionally to a file (`--out`).

### Imports

- `collectAll` from `./monitors/index.js`
- `formatTable`, `formatJson`, `formatCsv`, `formatTsv` from `./formatters/index.js`
- `startLive`, `stopLive` from `./live/index.js`
- `showSplash` from `./splash.js`
- `P2PServer`, `P2PClient` from `./p2p/index.js`

## `sparkline.ts` — Sparkline Renderer

Renders a series of numbers as a compact Unicode block-character sparkline suitable for inline terminal graphs.

### `sparkline(values, opts?): string`

- `values: number[]` — numeric series to render
- `opts.min?: number` — minimum value for normalisation (auto-computed if omitted)
- `opts.max?: number` — maximum value for normalisation (auto-computed if omitted)
- Returns a string of block characters (`▁▂▃▄▅▆█`) whose length equals `values.length`

Uses 8 Unicode block characters to represent the range. Values are normalised against `min`/`max` (auto-computed from the data if not supplied). Returns an empty string for an empty input array.

## `splash.ts` — ASCII Splash Screen

Displays an animated ASCII fire-effect splash screen on startup, based on the Doom fire effect algorithm.

### `showSplash(): Promise<void>`

Renders a 60×15 fire animation using:
- A `Uint8Array` heat grid with random ignition at the bottom row
- Fire propagation with decay and horizontal drift
- A 36-level colour palette mapping heat values to RGB colours
- Unicode character ramp (` ` → `.` → `` ` `` → `,` → `:` → `;` → `+` → `*` → `?` → `%` → `#` → `@`) for intensity representation
- Centered "🔥 pyre — system monitor (warming up sensors...)" text
- Auto-exits after 5 seconds or on any keypress

Uses ANSI escape sequences to clear the screen and position the output. Returns a Promise that resolves when the splash is dismissed.

## `history.ts` — Rolling Metric Window

Maintains a rolling window of recent metric samples used to render sparkline graphs in the live dashboard. Network rates (bytes/sec) are derived from cumulative counters by computing deltas between consecutive samples.

### `History` Class

#### Constructor
`new History(maxLen?)` — creates a rolling window retaining up to `maxLen` samples (default 40).

#### Properties
- `maxLen: number` — maximum samples retained
- `cpuUsage: number[]` — rolling window of CPU usage percentages (0–100)
- `memUsage: number[]` — rolling window of memory usage percentages (0–100)
- `temp: number[]` — rolling window of CPU die temperatures in °C
- `netRxRate: number[]` — rolling window of network receive rates in bytes/sec
- `netTxRate: number[]` — rolling window of network transmit rates in bytes/sec
- `gpuUtil: number[]` — rolling window of GPU utilization percentages (0–100)
- `powerWatts: number[]` — rolling window of combined power draw in watts
- `rxPacketRate: number[]` — rolling window of network receive packet rates in packets/sec
- `txPacketRate: number[]` — rolling window of network transmit packet rates in packets/sec
- `connections: number[]` — rolling window of active TCP connections

#### Methods

- `push(sample)` — pushes a new sample into the rolling window. Computes network rates as bytes/sec from cumulative counters. The first sample always reports 0 for rates.
  - `sample` fields: `cpuUsage`, `memUsage`, `temp` (nullable), `rxBytes`, `txBytes`, `gpuUtil?`, `powerWatts?`, `rxPackets?`, `txPackets?`, `connections?`

- `reset()` — clears all rolling windows and resets cumulative byte counters.

- `setMaxLen(n)` — grows or shrinks the rolling window, trimming oldest samples. `n` is clamped to at least 1.
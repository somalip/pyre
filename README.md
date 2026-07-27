# pyre

Mac system monitoring CLI: temps, CPU, memory, disk, battery, live dashboard, packet monitor, battery predictor, and export.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![macOS](https://img.shields.io/badge/macos-14%2B-lightgrey)
![Node](https://img.shields.io/badge/node-18%2B-green)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Real-time system stats** — CPU brand, cores, frequency, load, and usage
- **Memory monitoring** — usage, swap, and total/available
- **Disk space** — mounted volume usage
- **Battery & power** — level, power source, condition, charge cycles, max capacity, estimated time to empty, discharge rate, power draw in watts
- **Packet monitor** — network packet counts, packet rates, active TCP connections, top network processes
- **Task list** — running tasks/applications sorted by CPU with PID, user, memory, state, and runtime
- **Thermal state** — CPU temperature via `pmset` and `powermetrics` (sudo for detailed readings)
- **Network** — RX/TX bytes and per-second rates
- **Top processes** — sorted by CPU, memory, or PID with live filtering
- **Interactive live dashboard** — full-screen TUI with keyboard-driven controls
- **Snapshot export** — JSON, CSV, or TSV output formats
- **Continuous CSV logging** — automatic per-tick data logging to timestamped files
- **Visual themes** — four built-in colour themes for the dashboard

## Installation

### npm

```bash
npm install -g pyre-cli
```

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/somalip/pyre/main/install.sh | bash
```

### Homebrew

```bash
brew tap somalip/tap
brew install pyre
```

## Usage

### Static snapshot

```bash
pyre                      # Show all system stats in a formatted table
pyre --detailed           # Include sensor / powermetrics detail
pyre --json               # JSON output
pyre --csv                # CSV export
pyre --tsv                # TSV export
pyre --once               # Single static snapshot (same as default without live)
pyre --out report.json    # Also write output to a file
pyre --packets            # Include packet monitor panel
```

### Live dashboard

```bash
pyre live                      # Start the interactive live dashboard
pyre live --interval 3         # Refresh every 3 seconds
pyre live --detailed           # Live mode with detailed sensor readings
pyre live --export-dir ./my-exports   # Custom directory for snapshot exports and logs
pyre live --log                # Start continuous CSV logging immediately
pyre live --interval 5 --log   # Custom interval with auto-logging
```

### Options

| Option | Description |
|---|---|
| `-j, --json` | Output as JSON |
| `-c, --csv` | Output as CSV |
| `-t, --tsv` | Output as TSV |
| `--detailed` | Include detailed system info and sensor readings |
| `--interval <seconds>` | Refresh interval for live mode (default: `2`) |
| `--once` | Show a single static snapshot instead of live feed |
| `--out <file>` | Write snapshot output to a file |
| `--export-dir <dir>` | Directory for live-mode snapshot exports and logs (default: `./pyre-exports`) |
| `--log` | Start continuous CSV logging immediately when live mode starts |
| `--packets` | Include packet monitor panel in static output |

## Live Dashboard Controls

When running `pyre live`, use these keyboard shortcuts:

| Key | Action |
|---|---|
| `q` | Quit the dashboard |
| `p` | Pause / resume the refresh cycle |
| `d` | Toggle detailed sensor mode |
| `g` | Show / hide sparkline graphs |
| `s` | Cycle sort order (CPU → memory → PID) |
| `f` | Cycle export format (JSON → CSV → TSV) |
| `e` | Export a snapshot to the export directory |
| `l` | Toggle continuous CSV logging |
| `c` | Open the UI customizer |
| `/` | Open process filter |
| `k` | Open process kill (enter PID, then Enter to confirm) |
| `+` | Increase refresh interval by 1 second |
| `-` | Decrease refresh interval by 1 second |
| `↑` / `k` | Navigate customizer options |
| `↓` / `j` | Navigate customizer options |
| `Enter` / `Space` | Toggle visibility or select theme in customizer |
| `Esc` | Close customizer or clear filter/kill input |

### UI Customizer

Press `c` to open the customizer overlay. From there you can:

- Cycle through six built-in themes (Default, Dracula, Cyberpunk, Monochrome, Nord, Gruvbox)
- Toggle individual panels (CPU, Memory, GPU, Power, Battery, Thermal, Network, Packets, Tasks, Disk, Processes) on or off

## Themes

Six built-in visual themes are available in the live dashboard:

| Theme | Description |
|---|---|
| **default** | Muted greys and cyan accents; safe for any terminal |
| **dracula** | The popular Dracula dark palette |
| **cyberpunk** | High-contrast neon on black |
| **monochrome** | White-only; useful for colour-blind users or terminals without 256-colour support |
| **nord** | Arctic-inspired cool tones |
| **gruvbox** | Retro warm palette |

Themes are cycled with `c` in the customizer overlay.

## Export Formats

### Snapshot export (`e` key in live mode, or `--out` flag)

Snapshots are written to the export directory (`./pyre-exports` by default) with filenames like:

```
pyre-2026-07-26T10-54-47-191Z.json
pyre-2026-07-26T10-54-52-306Z.csv
```

The format is determined by the current export format (cycle with `f` in live mode, or set via `--json`, `--csv`, `--tsv` in static mode).

### Continuous CSV logging (`l` key in live mode, or `--log` flag)

When logging is active, each tick appends a row to a timestamped CSV file:

```
pyre-log-2026-07-26T10-54-47-191Z.csv
```

Each row contains:

```
timestamp,cpu_usage,mem_usage_percent,temp_c,net_rx_bytes,net_tx_bytes,net_rx_packets,net_tx_packets,connections,thermal_state
```

## Requirements

- **macOS 14+** (Sonoma or later)
- **Node.js 18+**
- **Optional:** `sudo` for `powermetrics` detailed temperatures in `--detailed` mode

## Project Structure

```
pyre/
├── src/
│   ├── index.ts            # CLI entry point (commander definitions, main())
│   ├── monitors/           # System metric collection (CPU, memory, disk, battery, thermal, network, packets, power, tasks)
│   │   ├── index.ts        # Public API: collectAll, collectPower, collectPackets, collectTasks
│   │   ├── types.ts        # TypeScript interfaces for all metric types
│   │   ├── smc.ts          # SMC sensor reading with caching
│   │   ├── collectors.ts   # Individual metric collectors and orchestrator
│   │   └── run.ts          # Shared shell-execution helper
│   ├── formatters/         # Output formatting and rendering
│   │   ├── index.ts        # Public API: formatTable, formatJson, formatCsv, formatTsv, formatGraphs
│   │   ├── output.ts       # JSON/CSV/TSV serialisation and sparkline graphs
│   │   ├── render.ts       # Dashboard table layout, cards, and panels
│   │   ├── themes.ts       # Six built-in colour themes
│   │   ├── types.ts        # TableOptions, VisibleItems, ThemeName
│   │   └── types.ts        # Public-facing type definitions
│   ├── live/               # Interactive live dashboard
│   │   ├── index.ts        # Public API: startLive, stopLive
│   │   ├── state.ts        # Shared mutable session state
│   │   ├── input.ts        # Keypress handling and session lifecycle
│   │   ├── render.ts       # Screen rendering and alert checking
│   │   ├── export.ts       # Snapshot export and CSV logging
│   │   └── types.ts        # LiveOptions, ExportFormat, InputMode, SortMode
│   ├── history.ts          # Rolling history buffer for sparkline data
│   ├── sparkline.ts        # ASCII sparkline rendering
│   └── utils/              # Shared utility functions
├── dist/                   # Built output (esm)
├── pyre-exports/           # Default directory for snapshot exports and logs
├── Formula/                # Homebrew formula
├── install.sh              # curl installation script
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Setup

```bash
git clone https://github.com/somalip/pyre.git
cd pyre
npm install
```

### Build

```bash
npm run build
```

This uses `tsup` to compile TypeScript to ESM in `dist/`.

### Run in dev mode

```bash
npm run dev
```

Runs the CLI directly via `tsx` without a build step.

### Test

```bash
npm test
```

Verifies the built binary runs and responds to `--help`.

### Scripts

| Script | Description |
|---|---|
| `build` | Compile TypeScript to ESM via tsup |
| `start` | Run the built binary from `dist/` |
| `dev` | Run directly via tsx (no build step) |
| `test` | Verify the built binary responds to `--help` |

## License

MIT

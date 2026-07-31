# pyre

Mac system monitoring CLI: temps, CPU, memory, disk, battery, GPU, power draw, live dashboard, packet monitor, process management, export, alerts, P2P live data streaming, web dashboard, SSH monitoring, and micro-benchmarking.

![Version](https://img.shields.io/badge/version-5.0.0-blue)
![macOS](https://img.shields.io/badge/macos-14%2B-lightgrey)
![Node](https://img.shields.io/badge/node-18%2B-green)
![License](https://img.shields.io/badge/license-MIT-green)

> **Note:** things may not work as intended if your firewall settings do not allow inbound connections for this program.
>
> You can skip init with Enter, but you may encounter some UI bugs. This is being worked on.

## Features

- **P2P live data streaming** — send live system stats to another system over TCP with password authentication, TLS encryption, rate limiting, IP allow/deny lists, audit logging, and HMAC message signing
- **Real-time system stats & per-core CPU** — CPU brand, cores, frequency, load, per-core utilization mini-bars, and overall usage
- **GPU monitoring** — GPU model, VRAM, utilization, temperature, and process count (detailed mode)
- **Power draw monitoring** — CPU watts, GPU watts, and combined power draw via SMC/ioreg
- **Memory monitoring & pressure** — usage, swap, wired, compressed, purgeable, swapins/outs, and kernel VM pressure level
- **Disk I/O throughput & space** — read/write speed per volume and mounted volume space usage
- **Battery & power health** — level, power source, condition, charge cycles, max capacity, health trends, estimated time to empty, discharge rate, power draw in watts
- **Packet monitor** — network packet counts, packet rates, active TCP connections, top network processes
- **Task list** — running tasks/applications sorted by CPU with PID, user, memory, state, and runtime
- **Thermal state** — CPU temperature via `pmset` and `powermetrics` (sudo for detailed readings)
- **Network** — RX/TX bytes and per-second rates
- **Top processes & search-as-you-type** — live filtering, tree view, sorting by CPU/memory/PID, and process kill with protected PID confirmation guard
- **Interactive live dashboard** — full-screen TUI with keyboard-driven controls, mouse support, configurable panel layout, and tab-based panel navigation
- **Snapshot export** — JSON, CSV, TSV, HTML, or Markdown output formats
- **Continuous CSV logging & Anomaly Digest** — automatic per-tick logging and statistical spike analysis (`pyre anomalies`)
- **Visual themes & custom themes** — six built-in color themes plus user-defined JSON theme support in `~/.config/pyre/themes/`
- **Persistent configuration & Profiles** — save themes and thresholds in `~/.config/pyre/config.json`, plus atomic profile management (`pyre profile`)
- **Alert system & webhooks** — configurable threshold alerts with terminal bell, desktop notifications, webhook POST payload execution (`--webhook-url`), and custom shell command execution (`--alert-cmd`)
- **System diagnostic tool (`pyre doctor`)** — check permissions, SMC access, Gatekeeper, SIP status, XProtect definitions, and P2P reachability
- **Security & Ecosystem inspectors** — System Extensions inspector (`pyre extensions`), Homebrew health (`pyre brew`), and Time Machine backup status
- **Accessible plain-text mode** — `--plain`/`--a11y` mode for screen readers and ANSI-free logging
- **Grafana Integration** — ready-to-import Grafana dashboard template (`grafana/pyre-dashboard.json`)
- **History & Snapshot Diff** — query historical CSV log trends (`pyre history`) and compare snapshot files side-by-side (`pyre diff`)
- **Multi-host fleet dashboard** — stream and tile stats from multiple remote Macs (`pyre fleet`)
- **Menu Bar & xbar integration** — generate menu bar plugin script (`pyre xbar`) for continuous background status display
- **Graph mode toggle** — switch between sparkline and bar graph rendering in the live dashboard
- **P2P dashboard panel** — monitor P2P server status and peer events directly from the live dashboard
- **Temperature unit toggle** — switch between Celsius and Fahrenheit display in live mode
- **Hardware & Displays overview** — `pyre info` prints hardware, connected displays, and Time Machine status
- **Remote SSH monitoring** — `pyre ssh <host>` streams a remote Mac's live dashboard locally
- **Web dashboard** — `pyre web` serves an auto-refreshing HTML dashboard with real-time SSE stream on a local port
- **Micro-benchmarking & Energy Cost** — `pyre bench <cmd>` logs resource usage and estimates energy consumption/cost (kWh)
- **Update checker** — `pyre update` checks npm registry for new pyre-cli releases

## Installation

### npm

```bash
npm install -g pyre-cli
```

### curl

```bash
curl -fsSL https://raw.githubusercontent.com/somalip/pyre/main/install.sh | bash
```

## Quick Start

```bash
pyre                           # Static snapshot, all system stats
pyre --detailed                # Include sensor / powermetrics detail
pyre --json                    # JSON output (also --csv, --tsv, --html, --md)
pyre --plain                   # Plain-text accessible output without ANSI noise

pyre live                      # Interactive live dashboard
pyre live --interval 3 --log   # Custom refresh interval + auto-logging
pyre live --alert-cpu 80 --alert-temp 85 --temp-unit f

pyre anomalies --since 7d      # Statistical resource spike digest from past CSV logs
pyre doctor                    # System diagnostics (Gatekeeper, SIP, XProtect, powermetrics)
pyre extensions                # System extensions inspector (systemextensionsctl)
pyre brew                      # Homebrew health summary & cellar size
pyre update                    # Check for pyre-cli updates
pyre profile save dev          # Save active configuration profile
pyre profile load dev          # Load configuration profile
pyre info                      # Concise hardware, display & Time Machine overview
pyre bench "make build"        # Benchmark command & estimate kWh energy cost
```

## Options Reference

These options apply to both static snapshots and `pyre live`, except where noted.

| Option | Description |
|---|---|
| `-j, --json` | Output as JSON |
| `--html` | Output as self-contained HTML |
| `--md` | Output as Markdown |
| `-c, --csv` | Output as CSV |
| `-t, --tsv` | Output as TSV |
| `--plain` / `--a11y` | Plain text output mode without ANSI colors or line-drawing characters |
| `--detailed` | Include detailed system info and sensor readings |
| `--since <range>` | Time range for anomaly digest (e.g. `1d`, `7d`, `yesterday`) |
| `--theme <name>` | Theme for live mode (`default`, `dracula`, `cyberpunk`, `monochrome`, `nord`, `gruvbox`) |
| `--interval <seconds>` | Refresh interval for live mode (default: `2`) |
| `--once` | Show a single static snapshot instead of live feed |
| `--out <file>` | Write snapshot output to a file |
| `--export-dir <dir>` | Directory for live-mode snapshot exports and logs (default: `./pyre-exports`) |
| `--log` | Start continuous CSV logging immediately when live mode starts |
| `--tree` | Show process tree view instead of flat list |
| `--sort <key>` | Sort processes by: `cpu`, `mem`, `pid`, `user`, `command`, `state`, `threads`, `runtime` |
| `--limit <n>` | Max processes in snapshot (`0` = all, default: `10`) |
| `--alert-cpu <pct>` | CPU usage alert threshold (default: `90`) |
| `--alert-temp <c>` | CPU temperature alert threshold in Celsius (default: `95`) |
| `--temp-unit <unit>` | Temperature display unit: `c` or `f` (default: `c`) |
| `--webhook-url <url>` | URL to POST payload to when an alert threshold is triggered |
| `--alert-cmd <cmd>` | Shell command to execute when an alert threshold is triggered |
| `--port <port>` | Port number for web server mode (default: `3000`) |

## Commands

### Static snapshot & diagnostics

| Command | Description |
|---|---|
| `pyre` | Show all system stats in a formatted table |
| `pyre --once` | Show a single static snapshot (same as default without live) |
| `pyre --json` | JSON output |
| `pyre --html` | Self-contained HTML report |
| `pyre --md` | Markdown tables |
| `pyre doctor` | Run system diagnostics (permissions, Gatekeeper, SIP, XProtect, P2P network) |
| `pyre extensions` | System Extensions inspector (`systemextensionsctl list`) |
| `pyre brew` | Homebrew health panel (installed formulae, outdated count, Cellar disk size, doctor summary) |
| `pyre update` | Check npm registry for latest `pyre-cli` release |
| `pyre profile <save\|load\|list> [name]` | Atomic configuration profile management (`~/.config/pyre/profiles/`) |
| `pyre config <show\|reset>` | View or reset persistent configuration file (`~/.config/pyre/config.json`) |
| `pyre completions <zsh\|bash\|fish>` | Generate shell auto-completion scripts |

### Hardware overview & history

| Command | Description |
|---|---|
| `pyre info` | Concise hardware summary (CPU, memory pressure, GPU, battery, displays, Time Machine) |
| `pyre anomalies [--since N]` | Compute z-score anomalies and print plain-language resource spike digest |
| `pyre history [--days N]` | Graph historical resource trends from CSV logs over past N days |
| `pyre diff <file1.json> <file2.json>` | Compare two saved snapshot files side-by-side |

### Benchmarking & Menu Bar

| Command | Description |
|---|---|
| `pyre bench <cmd>` | Log CPU, memory, network, power draw, and estimate kWh energy cost during command execution |
| `pyre xbar` | Generate an xbar / SwiftBar menu bar plugin script for stats display |

### Remote & Multi-host monitoring

| Command | Description |
|---|---|
| `pyre ssh <host>` | Stream live stats from a remote Mac over SSH |
| `pyre fleet <host1> [host2]...` | Multi-host live dashboard monitoring multiple Macs simultaneously |

### Live dashboard

| Command | Description |
|---|---|
| `pyre live` | Start the interactive live dashboard |

### Web dashboard

| Command | Description |
|---|---|
| `pyre web` | Serve an auto-refreshing live web portal with real-time SSE stats streaming on localhost (`--port <port>`) |

### P2P

| Command | Description |
|---|---|
| `pyre server` | Detect the local IP and print ready-to-paste commands for starting a P2P server and connecting a client on the same LAN (default port `9876`, default password `mysecret`) |
| `pyre p2p server` | Start a P2P server that streams live stats to authenticated peers |
| `pyre p2p connect` | Connect to a P2P server and display live stats |

See [P2P Live Data Streaming](#p2p-live-data-streaming) below for the full option set.

---

## P2P Live Data Streaming

Send live system stats to another system over a TCP connection with password authentication. The server streams `StatsData` snapshots to authenticated peers at the configured interval. You can also start or stop the P2P server from the live dashboard by pressing `r`.

### Server options

```bash
pyre p2p server --p2p-host 0.0.0.0 --p2p-port 9876 --p2p-password mysecret
```

| Option | Description |
|---|---|
| `--p2p-host <host>` | Bind address (default: `0.0.0.0`) |
| `--p2p-port <port>` | Port number (default: `9876`) |
| `--p2p-password <password>` | Password for authentication (required) |
| `--interval <seconds>` | Data refresh interval (default: `2`) |
| `--detailed` | Include detailed sensor readings |
| `--p2p-cert <file>` | TLS certificate file (PEM) for encrypted connections |
| `--p2p-key <file>` | TLS private key file (PEM) for the server |
| `--p2p-ca <file>` | TLS CA certificate file (PEM) — required by clients using `--p2p-tls` |
| `--p2p-rate-limit <n>` | Max auth attempts per IP per minute (default: `5`) |
| `--p2p-allow <ips>` | Comma-separated list of allowed IPs (empty = all) |
| `--p2p-deny <ips>` | Comma-separated list of denied IPs |
| `--p2p-audit-log <dir>` | Directory for P2P audit logs |
| `--p2p-hmac-key <key>` | HMAC key for message signing (default: derived from password) |

### Client options

```bash
pyre p2p connect --p2p-host <server-ip> --p2p-port 9876 --p2p-password mysecret
```

| Option | Description |
|---|---|
| `--p2p-host <host>` | Server address (default: `127.0.0.1`) |
| `--p2p-port <port>` | Server port (default: `9876`) |
| `--p2p-password <password>` | Password for authentication (required) |
| `--p2p-tls` | Enable TLS encryption for the connection |
| `--p2p-ca <file>` | TLS CA certificate file (PEM) — required when using `--p2p-tls` |
| `--p2p-insecure` | Skip TLS certificate verification (client only) |
| `--p2p-audit-log <dir>` | Directory for P2P client audit logs |
| `--p2p-hmac-key <key>` | HMAC key for message signing (must match server) |

### Security features

- **TLS encryption** — pass `--p2p-cert`/`--p2p-key`/`--p2p-ca` on the server and `--p2p-tls --p2p-ca` on the client for encrypted connections.
- **Rate limiting** — `--p2p-rate-limit <n>` caps authentication attempts per IP per minute to deter brute-force attacks.
- **IP allow/deny lists** — `--p2p-allow` restricts connections to specific IPs; `--p2p-deny` blocks specific IPs while allowing all others.
- **Audit logging** — `--p2p-audit-log <dir>` logs connects, auth successes/failures, disconnects, rate-limit hits, and IP blocks.
- **HMAC message signing** — every message is signed with HMAC-SHA256. The key derives from the password by default, or set `--p2p-hmac-key` explicitly for rotation or interoperability (must match on both sides).

### Same local network (LAN) setup

Both machines must be on the same local network (same Wi-Fi or wired subnet). The server listens on `0.0.0.0` (all interfaces) by default, so any device on the LAN can reach it as long as the port is open.

On the **server machine**, find its local IP address:

```bash
hostname -I
# or
ifconfig | grep "inet " | grep -v 127.0.0
```

Use that IP (e.g. `192.168.1.25`) in the client command:

```bash
pyre p2p connect --p2p-host 192.168.1.25 --p2p-port 9876 --p2p-password mysecret
```

**Troubleshooting**

- If the client can't reach the server, confirm both machines are on the same subnet (ping the server IP from the client).
- Verify the port is open (no local firewall blocking TCP `9876`).
- Never expose the server directly to the public internet; it's designed for LAN use only.

### Protocol

Length-prefixed JSON over TCP, with HMAC-SHA256 signing on every message:

1. Client connects to the server.
2. Server sends a `challenge` message with a random nonce.
3. Client responds with an `auth` message containing the SHA-256 hash of `password:nonce`.
4. Server validates the hash and responds with `auth-ok` or `auth-fail`.
5. Once authenticated, the server streams `data` messages containing `StatsData` snapshots at the configured interval.
6. Both sides exchange `ping`/`pong` keepalives every 15 seconds.
7. Either side can send a `disconnect` message to close gracefully.

### Server controls

While the server is running, type these on its stdin (or press `Ctrl+C`):

| Command | Action |
|---|---|
| `status` | Print the number of currently connected peers |
| `q` / `quit` / `exit` | Shut down the server gracefully |

### Client controls

While connected, the client displays live stats in a formatted table. Press `Ctrl+C` to disconnect. It reconnects automatically after 3 seconds if the connection drops.

---

## Live Dashboard

Run with `pyre live`.

| Key | Action |
|---|---|
| `q` | Quit the dashboard |
| `p` | Pause / resume the refresh cycle |
| `d` | Toggle detailed sensor mode |
| `g` | Show / hide sparkline graphs |
| `b` | Cycle graph mode (sparkline ↔ bar) |
| `s` | Cycle sort order (CPU → memory → PID → user → command → state → threads → runtime) |
| `f` | Cycle export format (JSON → CSV → TSV → HTML → Markdown) |
| `T` | Cycle temperature unit (Celsius ↔ Fahrenheit) |
| `e` | Export a snapshot to the export directory |
| `l` | Toggle continuous CSV logging |
| `c` | Open the UI customizer |
| `/` | Open process filter |
| `k` | Open process kill (enter PID, then Enter to confirm) |
| `S` | Open signal picker for kill (cycle SIGTERM → SIGKILL → SIGINT → SIGHUP → SIGSTOP → SIGCONT) |
| `t` | Toggle process tree view |
| `r` | Toggle P2P server (or enter P2P password input) |
| `+` / `-` | Increase / decrease refresh interval by 1 second |
| `←` / `→` / `Tab` | Cycle to previous / next panel tab |
| `1`–`9`, `0` | Jump to panel by number (cpu, mem, gpu, power, battery, thermal, network, packets, tasks, disk) |
| `P` | Toggle process panel |
| `Esc` | Close customizer or clear filter/kill input |

### UI Customizer

Press `c` to open the customizer overlay. From there:

- Cycle through six built-in themes (Default, Dracula, Cyberpunk, Monochrome, Nord, Gruvbox) — `↑`/`↓` or `j`/`k` to navigate, `Enter`/`Space` to select
- Toggle individual panels (CPU, Memory, GPU, Power, Battery, Thermal, Network, Packets, Tasks, Disk, Processes) on or off
- Switch graph mode between sparkline and bar charts
- Toggle process tree view
- Toggle temperature unit between Celsius and Fahrenheit
- Toggle notifications on or off

### Mouse support

- **Click tab bar** — click a panel tab (row 4) to jump directly to that panel
- **Scroll** — scroll through process lists in panels with many entries
- Enabled by default; disable with `mouseEnabled = false` in the customizer

---

## Process Management

Available in the live dashboard (and partially in static snapshots via flags).

### Sorting

Press `s` to cycle through sort modes, or use `--sort <key>` in static snapshot mode (default: `cpu`):

| Sort key | Description |
|---|---|
| `cpu` | Sort by CPU usage (descending) |
| `mem` | Sort by memory usage (descending) |
| `pid` | Sort by process ID |
| `user` | Sort by username |
| `command` | Sort by command name |
| `state` | Sort by process state |
| `threads` | Sort by thread count |
| `runtime` | Sort by total runtime |

### Filtering

Press `/` to open a process filter and type a substring to narrow the list. Press `Esc` to clear it.

### Tree view

Press `t` to toggle between a flat process list and a tree view showing parent/child relationships. In static snapshot mode, use `--tree`.

### Killing processes

Press `k` to enter kill mode: type the PID, then press `Enter` to send `SIGTERM` (default), or `Esc` to cancel.

### Signal picker

Press `S` to open the signal picker. Cycle with `↑`/`↓` or `j`/`k`, then `Enter` to send the selected signal to the PID entered in kill mode:

| Signal | Description |
|---|---|
| `SIGTERM` | Graceful termination (default) |
| `SIGKILL` | Force kill |
| `SIGINT` | Interrupt (Ctrl+C equivalent) |
| `SIGHUP` | Hangup |
| `SIGSTOP` | Stop (pause) the process |
| `SIGCONT` | Continue a stopped process |

---

## Alerts & Notifications

The live dashboard monitors critical metrics and notifies you when thresholds are exceeded:

| Metric | Default threshold | Alert behavior |
|---|---|---|
| CPU usage | 90% | Terminal bell (`\x07`) + red status message for 5 seconds + desktop notification |
| CPU temperature | 95°C | Terminal bell + red status message for 5 seconds + desktop notification |

Alerts fire once when a threshold is first crossed and reset when conditions clear. Thresholds are configurable via `--alert-cpu` and `--alert-temp`, or in the config file (`cpuAlertPct` and `tempAlertC` in `~/.config/pyre/config.json`).

## Themes

| Theme | Description |
|---|---|
| **default** | Muted greys and cyan accents; safe for any terminal |
| **dracula** | The popular Dracula dark palette |
| **cyberpunk** | High-contrast neon on black |
| **monochrome** | White-only; useful for colour-blind users or terminals without 256-colour support |
| **nord** | Arctic-inspired cool tones |
| **gruvbox** | Retro warm palette |

Cycle themes with `c` in the customizer overlay, or set a default with `--theme <name>`.

## Export Formats

### Snapshot export

Triggered by the `e` key in live mode, or the `--out` flag. Written to the export directory (`./pyre-exports` by default):

```
pyre-2026-07-26T10-54-47-191Z.json
pyre-2026-07-26T10-54-52-306Z.csv
pyre-2026-07-26T10-54-52-306Z.html
pyre-2026-07-26T10-54-52-306Z.md
```

Format follows the current export format — cycle with `f` in live mode, or set via `--json`, `--csv`, `--tsv`, `--html`, `--md` in static mode.

### Continuous CSV logging

Triggered by the `l` key in live mode, or the `--log` flag. Each tick appends a row to a timestamped file. Old logs are automatically rotated (max 20 files or 50 MB, files older than 7 days are pruned):

```
pyre-log-2026-07-26T10-54-47-191Z.csv
```

Row format:

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
│   ├── anomaliesCmd.ts     # Resource spike & anomaly digest generator
│   ├── brewHealth.ts       # Homebrew health & cellar usage inspector
│   ├── doctor.ts           # System diagnostics (permissions, Gatekeeper, SIP, XProtect)
│   ├── extensions.ts       # System Extensions inspector (systemextensionsctl list)
│   ├── updateCheck.ts      # Passive and on-demand npm registry version check
│   ├── monitors/           # System metric collection (CPU, memory, disk, battery, thermal, network, packets, power, tasks)
│   │   ├── index.ts        # Public API: collectAll, collectPower, collectPackets, collectTasks
│   │   ├── types.ts        # TypeScript interfaces for all metric types
│   │   ├── smc.ts          # SMC sensor reading with caching
│   │   ├── collectors.ts   # Individual metric collectors, displays, Time Machine, and orchestrator
│   │   └── run.ts          # Shared shell-execution helper
│   ├── formatters/         # Output formatting and rendering
│   │   ├── index.ts        # Public API: formatTable, formatJson, formatCsv, formatTsv, formatGraphs
│   │   ├── output.ts       # JSON/CSV/TSV serialisation and sparkline graphs
│   │   ├── render.ts       # Dashboard table layout, cards, and panels
│   │   ├── themes.ts       # Six built-in colour themes
│   │   └── types.ts        # TableOptions, VisibleItems, ThemeName, and other public-facing type definitions
│   ├── live/               # Interactive live dashboard
│   │   ├── index.ts        # Public API: startLive, stopLive
│   │   ├── state.ts        # Shared mutable session state
│   │   ├── input.ts        # Keypress handling, signal picker, protected PID kill guards
│   │   ├── render.ts       # Screen rendering and alert checking
│   │   ├── export.ts       # Snapshot export and CSV logging
│   │   └── types.ts        # LiveOptions, ExportFormat, InputMode, SortMode
│   ├── p2p/                # P2P live data streaming (server + client)
│   │   ├── index.ts        # Public API: P2PServer, P2PClient
│   │   ├── types.ts        # P2P protocol type definitions
│   │   ├── protocol.ts     # Length-prefixed JSON message framing
│   │   ├── server.ts       # TCP server: auth, TLS, rate limiting, IP filtering, audit logging, HMAC signing, data streaming
│   │   └── client.ts       # TCP client that connects and displays live data
│   ├── state/              # Config & profile state management
│   │   └── config.ts       # Config file I/O & atomic profile save/load
│   ├── history.ts          # Rolling history buffer for sparkline data
│   ├── sparkline.ts        # ASCII sparkline rendering & plain-text mode
│   └── utils/              # Shared utility functions
├── dist/                   # Built output (esm)
├── grafana/                # Grafana dashboard JSON template
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

### Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript to ESM via tsup, output to `dist/` |
| `npm start` | Run the built binary from `dist/` |
| `npm run dev` | Run directly via `tsx` (no build step) |
| `npm test` | Verify the built binary responds to `--help` |

## License

MIT

# pyre

> Cross-platform system monitoring CLI & telemetry suite for **macOS**, **Linux**, and **Windows**.

[![Version](https://img.shields.io/badge/version-10.1.0-blue)](package.json)
[![macOS](https://img.shields.io/badge/macOS-14%2B-lightgrey)](#requirements)
[![Linux](https://img.shields.io/badge/Linux-x86__64%20%7C%20arm64-orange)](#requirements)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011%20%7C%20Server-blue)](#requirements)
[![Node](https://img.shields.io/badge/node-18%2B-green)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## ⚡ Quick Install

```bash
# macOS / Linux (curl)
curl -fsSL https://raw.githubusercontent.com/somalip/pyre/main/install.sh | bash

# Homebrew (macOS)
brew install somalip/pyre/pyre

# Windows (PowerShell)
irm https://raw.githubusercontent.com/somalip/pyre/main/install.ps1 | iex

# npm (Cross-platform)
npm install -g pyre-cli
```

---

## 🚀 Quick Start

```bash
pyre                           # One-shot system stats snapshot
pyre live                      # Interactive live TUI dashboard
pyre live --interval 1 --log   # 1s refresh interval with continuous CSV logging
pyre web                       # Launch local browser portal with real-time SSE stream
pyre fleet host1 host2         # Multi-host live dashboard aggregated over SSH/mesh
pyre anomalies --since 7d      # Plain-language statistical z-score spike digest
pyre doctor                    # Audit permissions, SIP, Gatekeeper & sensors
pyre bench "npm run build"     # Benchmark command execution with energy cost (kWh)
```

---

## ✨ Highlights

| Capability | Description |
|---|---|
| **Interactive TUI** | Real-time sparklines, bar graphs, process trees, mouse support, and 6 built-in themes (`q` quit, `c` customize, `/` filter, `k` kill). |
| **Encrypted P2P** | Stream telemetry directly between machines over TCP with TLS encryption, HMAC message signing, and rate limiting. |
| **Fleet & SSH Aggregation** | Monitor remote nodes over SSH (`pyre ssh <host>`) or stream multiple servers into a unified tiled dashboard (`pyre fleet`). |
| **Web & Native Dashboards** | Auto-refreshing browser portal powered by Server-Sent Events (`pyre web`) plus native macOS app mode (`pyre ui`). |
| **Deep Hardware Probes** | Apple Silicon P/E cluster utilization, SMC thermals, per-core CPU, GPU VRAM, battery health trends, and power draw (watts). |
| **Packet Forensics** | Non-intrusive socket state tracking (`ESTABLISHED`, `LISTENING`, etc.), top hosts, and per-process network I/O. |
| **Diagnostics & Auditing** | Diagnose platform security with `pyre doctor` and audit package managers with `pyre brew`. |
| **Multi-Format Export** | Export instant snapshots to JSON, CSV, TSV, HTML, or Markdown, plus a ready-to-use Grafana template. |

---

## ⚔️ Comparison

| Feature | **Pyre** | **btop** | **htop** | **Glances** |
|---|:---:|:---:|:---:|:---:|
| **Interactive TUI & Themes** | ✔ *(6 themes + JSON)* | ✔ | Limited | ✔ |
| **Encrypted P2P Streaming** | ✔ *(TLS + HMAC)* | ✖ | ✖ | Partial *(Plain)* |
| **Multi-Host Fleet View** | ✔ | ✖ | ✖ | ✔ *(Web)* |
| **Web Dashboard (SSE)** | ✔ | ✖ | ✖ | ✔ |
| **Apple Silicon & Power Draw** | ✔ *(Watts + P/E)* | Partial | Partial | Partial |
| **Socket & Packet Forensics** | ✔ | Partial | ✖ | Partial |
| **Statistical Anomaly Digest** | ✔ *(Z-score)* | ✖ | ✖ | ✖ |
| **Command Energy Profiler** | ✔ *(kWh / Joules)* | ✖ | ✖ | ✖ |
| **Platform Doctor (`pyre doctor`)** | ✔ | ✖ | ✖ | ✖ |
| **Export Formats** | JSON, CSV, TSV, HTML, MD | ✖ | ✖ | InfluxDB, CSV |

---

## 🎮 Live TUI Keybindings

Launch with `pyre live`:

| Key | Action | Key | Action |
|:---:|---|:---:|---|
| `q` | Quit dashboard | `/` | Filter processes (search-as-you-type) |
| `p` | Pause / resume refresh | `k` | Enter process kill mode (type PID) |
| `d` | Toggle sensor detail | `S` | Select kill signal (`SIGTERM`, `SIGKILL`, etc.) |
| `g` / `b` | Toggle graphs / cycle sparkline ↔ bar | `t` | Toggle process tree view |
| `s` | Cycle sort (CPU, Mem, PID, User, Runtime) | `1`–`0` | Jump to panel (CPU, Mem, Disk, Net, etc.) |
| `c` | Open visual theme & panel customizer | `←` / `→` | Next / previous panel tab |
| `e` | Export snapshot (`.json`/`.csv`/`.html`/`.md`) | `+` / `-` | Increase / decrease refresh interval |
| `l` | Toggle continuous CSV logging | `r` | Start / stop P2P live stream server |

*Mouse support is enabled by default: click panel tabs to switch views or scroll to browse processes.*

---

## 💻 CLI Commands

### Monitoring & Dashboards

```bash
pyre                            # Formatted terminal snapshot
pyre --json                     # Structured JSON (also --csv, --tsv, --html, --md)
pyre --plain                    # Clean accessible output (no ANSI / box-drawing)
pyre live                       # Interactive full-screen TUI
pyre web [--port 3000]          # Browser dashboard with live SSE streaming
pyre ui                         # Native macOS dashboard window
pyre ssh <user@host>            # Stream live stats from a remote host via SSH
pyre fleet <host1> <host2>...   # Multi-host live aggregated fleet dashboard
```

### Telemetry, Diagnostics & Benchmarks

```bash
pyre anomalies [--since 7d]     # Statistical z-score spike digest from CSV logs
pyre doctor                     # Run diagnostic checks (permissions, SIP, Gatekeeper, sensors)
pyre info                       # Hardware summary (CPU clusters, RAM, GPU, battery, displays)
pyre brew                       # Package manager health check & disk cache report
pyre bench "<command>"          # Profile command CPU/memory and calculate kWh energy cost
pyre benchmark                  # 1-minute CPU benchmark scoring digits of PI
pyre blender                    # Track running background Blender render processes
```

### Profiles & Configuration

```bash
pyre profile save <name>        # Save active config profile
pyre profile load <name>        # Load saved profile
pyre config show                # View current settings (~/.config/pyre/config.json)
pyre completions <zsh|bash>     # Generate shell completion script
```

---

## 🌐 Encrypted P2P Streaming

Stream live system stats directly over LAN without brokers:

```bash
# 1. On the host machine (server)
pyre p2p server --p2p-password "secret" --p2p-port 9876

# 2. On the client machine
pyre p2p connect --p2p-host <server-ip> --p2p-password "secret" --p2p-port 9876
```

**Security Features:**
- **TLS Encryption:** `--p2p-tls --p2p-cert <file> --p2p-key <file>`
- **Authentication:** SHA-256 challenge-response verification
- **Integrity:** HMAC-SHA256 message signing on every payload
- **Access Control:** `--p2p-allow <ips>` and `--p2p-rate-limit <n>`

---

## ⚙️ Options Reference

| Flag | Description |
|---|---|
| `-j, --json` | Snapshot output formatted as JSON |
| `--html`, `--md` | Snapshot output formatted as HTML or Markdown report |
| `-c, --csv`, `-t, --tsv` | Snapshot output formatted as CSV or TSV |
| `--detailed` | Include sensor thermals and per-cluster detail |
| `--theme <name>` | Theme: `default`, `dracula`, `cyberpunk`, `monochrome`, `nord`, `gruvbox` |
| `--interval <sec>` | Polling frequency in seconds (default: `2`) |
| `--log` | Start continuous CSV logging immediately |
| `--tree` | Render process tree view instead of flat list |
| `--sort <key>` | Sort processes by: `cpu`, `mem`, `pid`, `user`, `command`, `runtime` |
| `--alert-cpu <pct>` | Trigger alert when CPU exceeds percentage (default: `90`) |
| `--alert-temp <c>` | Trigger alert when CPU temp exceeds Celsius (default: `95`) |
| `--webhook-url <url>` | POST alert payload to custom endpoint when thresholds trigger |
| `--plain`, `--a11y` | Strip ANSI escape sequences and box borders for screen readers |

---

## 📋 Requirements

- **Node.js**: 18.0.0 or later
- **macOS**: 14+ (Sonoma or later recommended). *Optional: passwordless `powermetrics` for granular Apple Silicon power draw.*
- **Linux**: Kernel 4.x+ (`/proc` and `/sys` support).
- **Windows**: Windows 10, 11, or Server 2016+ with PowerShell 5.1+.

---

## 🛠️ Development

```bash
git clone https://github.com/somalip/pyre.git
cd pyre
npm install
npm run dev     # Run directly via tsx
npm run build   # Compile TypeScript to ESM via tsup
npm test        # Run CLI test suite
```

---

## 📄 License

[MIT](LICENSE) © [somalip](https://github.com/somalip)

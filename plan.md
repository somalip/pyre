# Feature Brainstorm: pyre — Go-to Mac System Monitor

## Current State (Observations from Code)

- **Architecture**: Modular `monitors/`, `formatters/`, `live/`, `p2p/` layers. Clean `StatsData` aggregate type. Already has history buffer (`History` class) and sparkline renderer.
- **Differentiators**: P2P streaming, battery life estimator, signal-picker process kill, tree view, packet monitor.
- **Gaps vs. btop parity**: btop has per-core CPU bars, I/O throughput, buffer/cache memory breakdown. Pyre does not.
- **Mac-specific gaps**: Little use of macOS-exclusive APIs beyond `powermetrics`/SMC. No LaunchAgents inspection, no disk SMART data, no sound input, no app energy impact equivalents.

---

## 1. Intelligence & Analytics

### A. Anomaly / Spike Detector
- **What**: Instead of static thresholds (e.g., "CPU > 90%"), detect statistically unusual behavior. Track rolling percentiles and flag when a metric deviates from its baseline by > N sigma.
- **Use case**: Catches a process that normally uses 2% CPU but jumps to 15%, without needing manual threshold tuning.
- **Implementation**: Extend `History` to compute rolling mean/std-dev. Add a new `anomalies` panel or overlay badges.

### B. System Health Score
- **What**: Aggregate thermal pressure, CPU usage, memory pressure, disk fullness, battery health, and network saturation into a single 0-100 score with a tier label (Healthy / Fair / Warning / Critical).
- **Use case**: One-glance status for at-a-glance monitoring or scripting.
- **Implementation**: New `SystemHealth` type in `StatsData`, rendered as a large gauge or top-right badge.

### C. Bottleneck Analyzer
- **What**: Auto-diagnose *why* the system is slow. If thermal throttling is active, say "CPU is thermally throttled". If RAM is full and swap is high, say "Memory pressure". If IO is saturated, say "Disk I/O bottleneck".
- **Use case**: Users don't need to manually correlate four charts; the tool tells them the culprit.
- **Implementation**: Deterministic rules engine in a new `monitors/analysis.ts` module.

### D. Power / Performance Profile
- **What**: Detect current power source and suggest the active profile (Low Power / High Performance). Show estimated battery life in hours at current discharge rate, and how long to full charge if plugged in.
- **Use case**: Battery life prediction is already rough; make it actionable.
- **Implementation**: Enrich `BatteryData` with `chargeRate` and `timeToFull`.

### E. Resource Regression Timeline
- **What**: Compare current snapshot to the same time yesterday/last week across CPU, memory, and disk trends.
- **Use case**: "Why is my Mac slower today?" — pyre answers with a trend line.
- **Implementation**: If CSV logs exist for previous days, cross-compare averages and render a `>`/`<` directional cue.

---

## 2. Deep macOS Integration

### A. macOS Energy Impact (Process Card)
- **What**: Use `ps -o energy_policy` or `sysctl kern.energy` data (or parse `top -l 1` energy columns) to show per-process energy impact, similar to Activity Monitor.
- **Use case**: Identify which apps drain battery without manual kill/checking.
- **Implementation**: Extend `ProcessData` with `energyImpact` column and sort mode.

### B. LaunchAgents / LaunchDaemons Inspector
- **What**: List user LaunchAgents and system LaunchDaemons, show whether they are enabled, their last exit status, and current PID. Issue a warning if an unknown agent runs a suspicious command.
- **Use case**: Debug login items, malware, or excessive background agents.
- **Implementation**: New `monitors/launchd.ts` + new "Launch" panel/tab.

### C. Disk SMART / Health Status
- **What**: Read S.M.A.R.T. status via `diskutil info /dev/diskX` or `system_profiler SPStorageDataType` to surface disk health, SSD wear level, and remaining lifespan.
- **Use case**: Anticipate disk failures before data loss.
- **Implementation**: Parse `diskutil` output; add `smartStatus` and `wearLevelPct` to `DiskData`.

### D. Per-Core GPU Utilization (Apple Silicon)
- **What**: On M-series chips, `powermetrics` reports per-core cluster GPU utilization. Show E-Core vs P-Core breakdown in the GPU card.
- **Use case**: Identify whether background or foreground workloads are stressing the GPU.
- **Implementation**: Extend `collectGpu`/`getSmcMetrics` to parse cluster breakdown; extend `gpuCard` to render clustered bars.

### E. Sound / Microphone Activity
- **What**: Query `coreaudiod`/`auditd` or use `ioreg -l | grep -i audio` to detect active audio output and input. Show if a process is recording the microphone.
- **Use case**: Privacy indicator: "Is my Mac silently recording?"
- **Implementation**: New `collectAudio()` monitor; render "Mic Active" / "Audio Output" statuses.

### F. Touch Bar / Display Hardware
- **What**: Read brightness level (via `brightness` command or ioreg), external display status, and refresh rate.
- **Use case**: Display diagnostics for users with multiple monitors.
- **Implementation**: New `monitors/display.ts`.

### G. Network Interface Detail
- **What**: Per-interface stats (en0, en1, p2p0, bridge0, utun) with link speed and duplex. Detect inactive vs. active Wi-Fi networks.
- **Use case**: Multihome users and VPN diagnostics.
- **Implementation**: Extend `collectPackets` to expose full `interfaces[]` in `PacketData`; add an interface selector key.

---

## 3. Developer / Power-User Workflows

### A. `pyre watch` (Change Notification Mode)
- **What**: Block until a metric exceeds a threshold or *changes significantly* from baseline, then print a one-shot alert and exit. Useful in CI or scripts.
- **Use case**: `pyre watch --alert-temp 95 --exec "osascript -e 'display notification ..."'`
- **Implementation**: Reuse existing alert checker but add `--exec "<command>"` hook.

### B. `pyre bench` (Micro-Benchmarking)
- **What**: Record a short, high-frequency CSV log during a command. Wrapper: `pyre bench --interval 0.5 -- <your command>`.
- **Use case**: Capture resource usage during a build, render, or test.
- **Implementation**: Spawn child process in `index.ts`, log until completion, write CSV.

### C. Resource-Limited Sandbox Run
- **What**: Launch a command and optionally throttle or constrain it. Use `cpulimit` or `renice` ideas. `pyre run --cpu-max 30 --mem-warn 80% -- <cmd>`.
- **Use case**: Run a known-heavy task without freezing the system.
- **Implementation**: Integrate `nice`/`renice` and cgroup-like constraints where possible.

### D. Process Inspector (Press Enter on a PID)
- **What**: In the live dashboard, pressing Enter on a selected process opens a detail view: open files, parent tree, recent CPU history for that PID.
- **Use case**: Fast triage without leaving pyre.
- **Implementation**: Extend input mode to `inspect`, use `lsof -p <pid>` and `ps -o` to build detail panel.

### E. `pyre ssh <host>`
- **What**: Run pyre over SSH transparently. Stream a remote Mac's live dashboard locally without needing the P2P server setup.
- **Use case**: Admins monitoring build servers or homelab Macs.
- **Implementation**: Wrap `ssh -o LogLevel=QUIET <host> pyre --json --once` and render locally.

### F. Snapshot Diff
- **What**: `pyre diff export1.json export2.json` — show what changed (CPU went from 5% to 80%, new PID 1234, battery dropped 2%).
- **Use case**: Diagnose a regression or resource spike after an action.
- **Implementation**: New `formatters/diff.ts` that walks two `StatsData` objects.

### G. Scripting / Automation Hooks
- **What**: `--on-alert "<script>"`, `--on-export "<script>"`, `--on-p2p-connect "<script>"`. Run arbitrary shell commands when lifecycle events fire.
- **Use case**: Send a Slack/Telegram message on high temp; sync exports to Dropbox.
- **Implementation**: `child_process.exec` in `live/input.ts` and `p2p/`.

---

## 4. UX & Dashboard Enhancements

### A. Config File (`~/.config/pyre/config.json`)
- **What**: Remember theme, default interval, export directory, panel visibility, alert thresholds, P2P defaults, sort mode, and tree view across sessions.
- **Use case**: Stop typing the same flags.
- **Implementation**: Read in `state.ts` at startup; write on customizer exit or `pyre config save`.

### B. Per-Core CPU Bars
- **What**: Render a row of tiny per-core utilization bars inside the CPU card.
- **Use case**: Immediate visual feedback on hyper-threaded workload.
- **Implementation**: Extend `CpuData` to include per-core usage; parse `ps -eo pcpu` split, or `sysctl hw.ncpu` + `top` per-core parsing.

### C. Disk I/O Throughput
- **What**: Track `ioreg` or `diskutil` IO bytes/sec per mount. Show read/write throughput in the Disk panel.
- **Use case**: Spot runaway Spotlight indexing, Time Machine backups, or file copies.
- **Implementation**: Delta-based IO rate in `collectDisk` or new `collectDiskIO`.

### D. Interactive Graph Zoom / History Window
- **What**: Allow cycling through graph time windows (e.g., last 20s / 1m / 5m / 15m) instead of a fixed rolling buffer. Press `G` to cycle window sizes.
- **Use case**: See a longer trend without changing terminal height.
- **Implementation**: Backing `History` already supports push/pop; adapt `maxLen` dynamically.

### E. App-Centric View
- **What**: Aggregate all child processes under their app bundle name (from `ps -o comm` or `lsof -Fn`). Show one row per app with combined CPU/mem/network.
- **Use case**: "How bad is Chrome *as a whole*?" rather than 30 individual renderer rows.
- **Implementation**: Post-process `processes[]` to group by bundle/command prefix.

### F. Focus Mode / Panel Bookmarks
- **What**: Press `F1`..`F12` to snap to specific panels; save a "bookmark" layout of panel visibility and order.
- **Use case**: Power users who always start by checking CPU then Network.
- **Implementation**: Persist bookmarks in config; map F-keys to `state.activePanel` switch.

### G. macOS Notifications
- **What**: Desktop notifications (macOS `osascript` or `terminal-notifier`) when alert thresholds are crossed, even when the dashboard is not in focus.
- **Use case**: Don't have to watch the terminal to know the system is overheating.
- **Implementation**: Call `osascript -e 'display notification'` from `checkAlerts` when `state.alerted` flips true.

### H. Compact / Mini Mode
- **What**: Single-line or two-line mode for the menu bar / status bar concept: `CPU 42% | MEM 61% | TEMP 72°C | NET ⬆12 ⬇45`.
- **Use case**: Pipeable snippet: `pyre mini` prints the one-liner, suitable for Übersicht / SwiftBar / xbar widgets.
- **Implementation**: New `pyre mini` subcommand; no TUI, just stdout.

### I. Vim-Style Navigation
- **What**: `j`/`k` already exist in customizer; extend to process list scrolling, panel jumping (`H`/`L` for prev/next tab), `/` for filter.
- **Use case**: Native feel for terminal power users.

---

## 5. Data & Export

### A. HTML Export
- **What**: Self-contained HTML report with tables, CSS styling, and embedded sparkline SVGs. Shareable via email or Slack.
- **Implementation**: New `formatHtml(data)` in `formatters/output.ts`. Already listed in README planned features; pair with snapshot.

### B. Markdown Export
- **What**: Markdown tables suitable for notes/docs.
- **Implementation**: Already listed in planned features.

### C. Snapshot Diff JSON
- **What**: `pyre diff --json a.json b.json` emits machine-readable diff for downstream tooling.
- **Implementation**: Extend `formatJson` to accept two `StatsData` objects and emit `{ changes: [...] }`.

### D. Log Rotation
- **What**: Cap CSV log files by age and size (e.g., keep 7 days or 50 MB). Rotate and compress old logs with `gzip`.
- **Implementation**: Already planned. Execute in `startLogging` by checking existing files.

### E. Prometheus / OpenMetrics Exporter
- **What**: `pyre export --metrics` prints Prometheus text-format metrics on `localhost:PORT`. Replaces manual CSV scraping for monitoring stacks.
- **Use case**: Grafana dashboards for your Mac.
- **Implementation**: Lightweight HTTP server with `/metrics` endpoint using Node's `http` module.

### F. JSON Lines (NDJSON) Logging
- **What**: Instead of CSV, allow `--log-format ndjson` so every tick is a self-contained JSON line.
- **Use case**: Easy streaming into `jq`, Elasticsearch, or Splunk.
- **Implementation**: New branch in `writeLogRow`.

### G. SQLite Database Logging
- **What**: `pyre live --log-sqlite pyre.db` stores every tick in a local SQLite DB with `cpu_usage`, `mem_usage`, `temp_c`, `timestamp` columns.
- **Use case**: Long-term history and SQL trend queries.
- **Implementation**: Optional `better-sqlite3` dependency or raw SQLite CLI fallback.

---

## 6. Ecosystem & Cross-Platform

### A. Swift / Objective-C Helper Binary
- **What**: Drop a tiny Swift CLI helper next to `pyre` that reads SMC and powermetrics and outputs JSON. pyre calls it instead of shelling out to `sudo powermetrics`.
- **Use case**: More reliable, less privilege friction.
- **Caveat**: Requires a build step / separate binary distribution.

### B. Homebrew Tap with Cask / Daemon
- **What**: Provide a `brew tap somalip/pyre` and optional `pyre` launchd plist that starts the dashboard on login for a specific user.
- **Use case**: Persistent background monitoring without manual startup.
- **Implementation**: Add `Formula/pyre.plist` and a `--install-launchd` flag.

### C. Raycast / Alfred / Spotlight Extension
- **What**: A small script that launches pyre in a terminal emulator, or copies a formatted snapshot to clipboard.
- **Use case**: Raycast is huge in the Mac community; a Raycast extension drives adoption.
- **Implementation**: Standalone repo / script, not core pyre, but worth mentioning.

### D. Virtualization / Container Aware
- **What**: Detect if running inside Docker, Lima, Podman, or UTM. Show host OS vs guest OS stats. Optionally report container IDs.
- **Use case**: Cloud-native teams.
- **Implementation**: Check `/.dockerenv`, `proc/1/cgroup`, or `hypervisor` sysctl.

### E. Status Bar Menu App (SwiftUI companion)
- **What**: A tiny menubar app that reads pyre's P2P stream or SQLite log and renders a compact popover. Not the TUI itself, but a sibling.
- **Use case**: At-a-glance status when not in terminal.
- **Implementation**: Separate repo; use P2P protocol or local socket.

---

## Prioritized Roadmap Suggestion

| Priority | Feature | Effort | Impact |
|---|---|---|---|
| **P0** | Config file (`~/.config/pyre/config.json`) | Medium | High (retention) |
| **P0** | Per-core CPU bars | Low | High (parity with btop) |
| **P0** | macOS notifications (`osascript`) | Low | High |
| **P1** | Mini / one-line mode | Low | Medium (automation) |
| **P1** | Bottleneck analyzer | Medium | High (diagnostic) |
| **P1** | Energy Impact per-process | Medium | High (Mac-only UX) |
| **P1** | HTML export | Low | Medium |
| **P1** | `pyre bench <cmd>` wrapper | Medium | Medium (devs) |
| **P2** | LaunchAgents inspector | Medium | High (power users) |
| **P2** | Snapshot diff | Low | Medium |
| **P2** | Prometheus exporter | Medium | Medium (infra) |
| **P2** | Disk I/O throughput | Medium | Medium |
| **P2** | Scripting hooks (`--on-alert`) | Low | Medium |
| **P3** | App aggregation | Medium | Medium |
| **P3** | SMART disk health | Medium | Low |
| **P3** | Anomaly detector | High | Medium |
| **P3** | Swift helper binary | High | Low |

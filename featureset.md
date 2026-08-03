# Pyre Feature Ideas Brainstorming

Here is a list of potential new features that could be added to **Pyre** to make it an even more powerful and comprehensive macOS system monitoring tool:

## 1. Advanced Network Metrics
- **Per-Process Bandwidth**: Show real-time upload and download speeds per process (potentially leveraging `nettop` under the hood).
- **Latency / Ping Panel**: A panel to continuously ping predefined endpoints (like 8.8.8.8, 1.1.1.1, or a custom gateway) to show network latency trends.

## 2. Automation & Active Management
- **Process Auto-Kill (Watchdog)**: Allow users to configure rules to automatically terminate processes if they exceed a certain CPU or Memory threshold for a sustained period.
- **Auto-Sleep / Wake on LAN**: Trigger macOS sleep or wake actions based on certain conditions (e.g., idle time, network activity, thermal thresholds).

## 3. Hardware & Sensor Deep Dive
- **S.M.A.R.T Disk Health**: Display detailed disk health metrics, such as wear level percentage, read/write errors, and remaining lifespan for SSDs.
- **Fan Speed Monitoring**: Show current fan speeds (RPM) using SMC readings.
- **Thermal Throttling Indicator**: Explicitly display an alert or status indicator when the CPU or GPU is actively being thermally throttled.

## 4. Integrations & Export Upgrades
- **Prometheus Exporter**: Add a `pyre prometheus` mode that exposes a `/metrics` endpoint for Prometheus to scrape, making it easy to integrate into larger enterprise monitoring stacks.
- **Direct Cloud Integration**: Send alerts or metrics directly to Slack, Discord webhooks, Datadog, AWS CloudWatch, or New Relic.

## 5. Dashboard & UX Enhancements
- **Log Playback (Replay Mode)**: The ability to load a historical CSV log file and "play it back" within the interactive TUI, allowing users to visually review past anomalies.
- **Plugin System**: Allow users to write custom metric collectors using simple JavaScript/TypeScript snippets or shell scripts, which can then be rendered as custom panels in the dashboard.
- **Customizable Layouts**: Allow users to define the exact grid layout, sizing, and position of dashboard panels in `~/.config/pyre/config.json`.

## 6. Intelligent Analysis
- **Smart Battery Predictions**: Use local historical power drain data to provide a more accurate, heuristic-based estimate of battery time remaining, rather than relying solely on the built-in macOS estimate.
- **Process Profiling**: When a process is flagged in an anomaly digest, automatically capture a brief CPU profile (via `sample` or `spindump`) for deeper post-mortem analysis.

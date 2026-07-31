btop is a **resource monitor and process manager** designed as a modern, interactive replacement for tools like `top` and `htop`. It combines a rich terminal UI with system telemetry, process control, graphs, and customization.

Below is a comprehensive feature list.

# btop Feature List

## 1. User Interface (TUI) Features

### Modern Terminal Dashboard

* Full-screen terminal interface
* Multi-panel dashboard layout
* Real-time animated graphs
* Color-coded status indicators
* Smooth transitions and updates
* Mouse interaction support
* Keyboard-driven navigation
* Responsive layout scaling
* Unicode/ASCII rendering support
* True-color terminal support

### Main Dashboard Panels

#### CPU Panel

Displays:

* Total CPU utilization
* Per-core utilization
* Core frequency
* CPU temperature (when available)
* CPU load averages
* Process activity
* CPU graph history

Visualizations:

* Per-core bar graphs
* Historical usage graphs
* Frequency indicators

---

#### Memory Panel

Shows:

* Total RAM
* Used RAM
* Available RAM
* Cached memory
* Buffers
* Memory percentage
* Swap usage

Visualizations:

* RAM usage bars
* Swap graphs
* Memory history

---

#### Disk Panel

Displays:

* Disk usage
* Mounted drives
* Used/free space
* Read/write activity
* I/O speed
* Storage utilization

Metrics:

* Read throughput
* Write throughput
* Disk activity graphs

---

#### Network Panel

Shows:

* Upload speed
* Download speed
* Total transferred data
* Network interface activity

Metrics:

* RX bandwidth
* TX bandwidth
* Packet activity
* Network history graphs

---

#### Process Panel

Displays:

* Running processes
* Process IDs
* CPU usage
* Memory usage
* User
* Command name
* Process state
* Threads

---

# 2. Process Management Features

## Process Viewer

Supports:

* Real-time process list
* Sorting processes
* Searching processes
* Filtering processes
* Process tree view
* Parent/child relationships
* Process details

---

## Process Sorting

Sort by:

* CPU usage
* Memory usage
* PID
* User
* Command
* Process state
* Threads
* Runtime

---

## Process Actions

Can:

* Kill processes
* Send signals
* Terminate applications
* Force kill stuck processes

Supported signals include:

* SIGTERM
* SIGKILL
* SIGINT
* SIGHUP
* SIGSTOP
* SIGCONT

---

# 3. Real-Time Monitoring

## Live Updates

Configurable:

* Update interval
* Graph refresh speed
* Process refresh rate
* Animation speed

Default behavior:

* Continuous monitoring
* Low latency updates
* Minimal CPU overhead

---

## Historical Graphs

Provides:

* CPU history
* RAM history
* Network history
* Disk I/O history
* Temperature history

Graph features:

* Scrolling history
* Adjustable time window
* Smooth rendering

---

# 4. Hardware Monitoring

## CPU Monitoring

Tracks:

* CPU load
* Per-thread activity
* Core utilization
* Frequency scaling
* Load averages
* CPU temperature (hardware dependent)

---

## Temperature Monitoring

Supports:

* CPU temperatures
* Sensor readings
* Thermal states

Availability depends on:

* OS
* Hardware sensors
* Permissions

---

## Battery Monitoring (Laptop)

Displays:

* Battery percentage
* Charging state
* Battery time remaining
* Power consumption

---

# 5. macOS-Specific Features

On macOS, btop can display:

* Apple Silicon CPU information
* Intel CPU information
* Memory pressure data
* Battery state
* Disk statistics
* Network statistics
* Process information

Supports:

* Intel Macs
* Apple Silicon Macs (M1/M2/M3/M4)

---

# 6. GPU Monitoring

GPU support:

Displays (when available):

* GPU utilization
* GPU memory usage
* GPU temperature
* GPU processes

Support depends on:

* Operating system APIs
* GPU vendor
* Drivers

---

# 7. Configuration Features

## Fully Configurable UI

Customize:

* Colors
* Themes
* Layout
* Display order
* Graph styles
* Update speed
* Background style

Configuration file:

```
~/.config/btop/btop.conf
```

---

## Theme System

Supports:

* Built-in themes
* Custom themes
* User-created color schemes

Theme file:

```
~/.config/btop/themes/
```

Examples:

* Dracula style
* Nord style
* Monokai style
* Solarized style

---

## Layout Customization

Adjust:

* Panel sizes
* Visible modules
* Graph types
* Information density

---

# 8. Keyboard Controls

Common shortcuts:

| Key   | Action           |
| ----- | ---------------- |
| `Esc` | Close menu       |
| `m`   | Main menu        |
| `p`   | Process menu     |
| `f`   | Filter processes |
| `k`   | Kill process     |
| `r`   | Reverse sorting  |
| `c`   | Sort by CPU      |
| `m`   | Sort by memory   |
| `q`   | Quit             |

Navigation:

* Arrow keys
* Page Up/Down
* Mouse clicks

---

# 9. Technical Features

## Cross Platform

Supported:

* macOS
* Linux
* FreeBSD

---

## Implementation

Written in:

* C++

Uses:

* Native OS APIs
* Terminal rendering
* Low-level system calls

---

## Performance

Designed for:

* Low CPU usage
* Low memory usage
* Fast startup
* Efficient polling

Typical resource usage:

* Small RAM footprint
* Minimal background overhead

---

# 10. Terminal Compatibility

Works with:

* Terminal.app
* iTerm2
* Ghostty
* Alacritty
* Kitty
* WezTerm
* tmux
* SSH sessions

Supports:

* ANSI colors
* Unicode
* True color
* 256-color terminals

---

# 11. Accessibility Features

Includes:

* High contrast themes
* Adjustable colors
* Keyboard-only operation
* Configurable information density

---

# 12. Advanced Features

## Mouse Support

Allows:

* Clicking panels
* Selecting processes
* Opening menus
* Changing sorting

---

## Vim-Like Navigation

Supports:

* Keyboard navigation
* Fast movement
* Terminal workflow

---

## Process Tree

Shows:

```
launchd
 ├── Terminal
 │    └── btop
 └── Chrome
      ├── Renderer
      └── GPU Process
```

---

## Secure Operation

Features:

* Does not require root for normal usage
* Uses read-only system metrics by default
* Only requires elevated privileges for certain actions

---

# 13. Developer / Sysadmin Features

Useful for:

### Debugging

* CPU spikes
* Memory leaks
* Zombie processes
* Runaway applications

### Servers

* SSH monitoring
* Lightweight dashboards
* Resource tracking

### Development

* Compiler monitoring
* Docker workload observation
* Build performance tracking

---

# 14. What btop Does NOT Do

---

# 15. Exclusive pyre Features (Not Available in btop)

pyre provides Mac-native security, diagnostics, and ecosystem capabilities that btop structurally cannot offer:

* **Security & Posture Audit** — Gatekeeper enforcement (`spctl`), System Integrity Protection (`csrutil`), XProtect definition update checks in `pyre doctor`, and System Extensions inspector (`pyre extensions`).
* **Statistical Anomaly Digest** — `pyre anomalies --since <range>` analyzes historical CSV telemetry and highlights z-score metric spikes (+2.5σ/3.5σ).
* **Mac Ecosystem Inspectors** — Homebrew health summary (`pyre brew`), Time Machine backup status (`pyre info`), and connected display resolution/type details (`pyre info`).
* **Memory Pressure & Pressure Level** — Wired, compressed, purgeable memory, swapins/outs, and kernel VM pressure level (`Normal`, `Warning`, `Critical`).
* **Micro-benchmarking Energy Estimator** — `pyre bench <cmd>` calculates Watt-seconds, total kWh energy consumption, and dollar cost estimation.
* **Grafana Infrastructure Export** — Shipped `grafana/pyre-dashboard.json` dashboard template mapping pyre's metric schema.
* **Atomic Config Profiles** — `pyre profile save/load/list` for rapid context switching (dev, gaming, monitoring).
* **Kill Confirmation Guard Rails** — Hard confirmation safety check when attempting to terminate protected system PIDs (`launchd`, pyre PID, parent PID).
* **Accessible Plain-Text Mode** — `--plain`/`--a11y` mode for screen reader compatibility and clean file logging without ANSI noise.
* **P2P Live Data Streaming & Fleet** — Multi-Mac live streaming with password/TLS auth, HMAC signing, rate-limiting, and IP filtering.

---

# Feature Summary

| Category      | Features                            |
| ------------- | ----------------------------------- |
| UI            | Animated TUI, graphs, colors, mouse |
| CPU           | Cores, load, frequency, temperature |
| Memory        | RAM, cache, swap                    |
| Disk          | Usage, I/O, throughput              |
| Network       | RX/TX monitoring                    |
| Processes     | Search, sort, kill, tree            |
| Hardware      | Sensors, battery, temperature       |
| Customization | Themes, layouts, configs            |
| Platforms     | macOS/Linux/FreeBSD                 |
| Performance   | Lightweight, real-time              |
| Terminal      | Ghostty/iTerm/Kitty compatible      |

**In short:** btop is essentially a **terminal-native Activity Monitor** with a dashboard-first design, closer to a "cyberpunk system HUD" than the classic `top` experience.

# src/formatters/ — Dashboard Formatting Module

The formatters module is responsible for turning raw system-metric data (`StatsData`) into styled terminal output. It provides three categories of functionality:

1. **Dashboard rendering** — `formatTable` draws the full terminal dashboard with panels, cards, tables, and tab navigation.
2. **Data export** — `formatJson`, `formatCsv`, `formatTsv` serialise a `StatsData` snapshot to structured text formats.
3. **Graph rendering** — `formatGraphs` draws sparkline/bar graphs of historical metrics.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export — re-exports all public functions and types |
| `types.ts` | Public-facing type definitions (`StatsData`, `VisibleItems`, `TableOptions`, `ThemeColors`, `ThemeName`) |
| `themes.ts` | Six built-in colour themes (`THEMES` record) mapping UI roles to chalk colour functions |
| `render.ts` | Core dashboard rendering: panels, cards, tables, tab bar, process tree, and the `formatTable` orchestrator |
| `output.ts` | JSON/CSV/TSV serialisation and sparkline/bar graph rendering |

## External Dependencies

The formatters module imports from two sibling modules:

- **`src/monitors/types.ts`** — defines `StatsData`, the aggregate data structure that every formatter consumes.
- **`src/history.ts`** — defines the `History` class, a rolling window of metric samples used by `formatGraphs`.
- **`src/sparkline.ts`** — exports the `sparkline()` function that renders Unicode block-character sparklines.

## `index.ts` — Barrel Exports

Re-exports everything public from the sub-modules:

- From `render.ts`: `formatTable`, `clampWidth`, `gridColumns`, `thermalColor`, `capacityColor`, `getTabHitboxes`, `TAB_BAR_ROW`, `TAB_DEFS`, `panel`
- From `output.ts`: `formatJson`, `formatCsv`, `formatTsv`, `formatGraphs`
- From `types.ts`: `ThemeName`, `ThemeColors`, `VisibleItems`, `TableOptions` (types only)
- From `themes.ts`: `THEMES`

## `types.ts` — Public Type Definitions

Defines the interfaces that control dashboard layout and visibility. All types are re-exported from `index.ts`.

### `ThemeName`
Union type re-exported from `themes.ts`: `'default' | 'dracula' | 'cyberpunk' | 'monochrome' | 'nord' | 'gruvbox'`.

### `ThemeColors`
Interface mapping 11 UI element roles to chalk colour functions: `border`, `cpu`, `mem`, `gpu`, `power`, `battery`, `thermal`, `network`, `disk`, `graphs`, `process`.

### `VisibleItems`
Optional boolean flags controlling which dashboard cards are shown. All default to visible when `undefined`:
- `cpu`, `mem`, `gpu`, `power`, `battery`, `thermal`, `network`, `packets`, `tasks`, `disk`, `process`, `tree`

### `TableOptions`
Options object for `formatTable`:
- `width?` — terminal width in columns (default 80, clamped to 60–240)
- `sortBy?` — process sort key: `'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime'`
- `filter?` — case-insensitive substring filter on process command
- `processLimit?` — max process rows to display
- `theme?` — visual theme name
- `visible?` — `VisibleItems` override
- `treeView?` — show process tree instead of flat table
- `activePanel?` — detail panel to show: `'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process'`

### `StatsData` (re-exported from `monitors/types.ts`)
The aggregate data structure consumed by all formatters. Contains: `header`, `cpu`, `gpu`, `memory`, `disk`, `battery`, `thermal`, `network`, `processes`, `power`, `timestamp`, `packets`, `tasks`.

## `themes.ts` — Colour Themes

Exports `THEMES`, a `Record<ThemeName, ThemeColors>` containing six built-in themes. Each theme maps the 11 UI roles to a chalk colour function.

### Built-in Themes

| Theme | Description |
|-------|-------------|
| `default` | Muted greys and cyan accents; safe for any terminal |
| `dracula` | Popular Dracula dark palette |
| `cyberpunk` | High-contrast neon on black |
| `monochrome` | White-only; useful for colour-blind users or terminals without 256-colour support |
| `nord` | Nord colour palette |
| `gruvbox` | Gruvbox retro colour palette |

Each theme's `ThemeColors` object has keys: `border`, `cpu`, `mem`, `gpu`, `power`, `battery`, `thermal`, `network`, `disk`, `graphs`, `process`.

## `render.ts` — Dashboard Rendering

The largest file in the module (660 lines). Contains every function that turns a `StatsData` snapshot into styled terminal output.

### Low-Level Utilities

- `visLen(s: string): number` — computes the visible length of a string by stripping ANSI escape codes.
- `padVisible(s: string, width: number): string` — pads a string with spaces to a target visible width.
- `truncatePlain(s: string, width: number): string` — truncates a plain string with `…` if it exceeds `width`.

### Panel & Layout

- `panel(title, lines, width, accent, borderAccent, height?): string[]` — draws a rounded panel box of exactly `width` columns. Returns an array of strings (one per line).
- `hstack(blocks, gap?): string[]` — joins equal-or-uneven-height panel blocks side by side with a gap.
- `statRow(label, value, width?): string` — renders a label/value pair with dim label.
- `gaugeRow(label, percent, contentWidth): string` — renders a horizontal bar gauge.
- `bar(percent, width?): string` — renders a filled/empty block bar coloured by threshold.

### Colour Helpers

- `thermalColor(pressureLevel: number): Chalk` — maps 0–3 pressure level to green/yellow/yellowBright/red.
- `capacityColor(percent: number): Chalk` — maps battery capacity to red (<80%)/yellow (<90%)/green.
- `formatBytes(bytes: number): string` — converts bytes to human-readable `B`/`KB`/`MB`/`GB`.
- `celsiusToFahrenheit(c: number): number` — converts °C to °F.
- `formatTemp(c: number): string` — renders `"62.0°C / 143.6°F"`.

### Card Renderers (each returns `string[] | null`)

- `cpuCard(data, contentWidth)` — brand, cores, frequency, usage gauge, load avg, optional temp.
- `memCard(data, contentWidth)` — total, used, cached, free, usage gauge, swap.
- `gpuCard(data, contentWidth)` — model, memory, utilization, optional temp, process count. Returns `null` if no GPU data.
- `powerCard(data)` — CPU/GPU/combined watts, battery watts if discharging. Returns `null` if no power data.
- `batteryCard(data, contentWidth)` — level/state, time remaining, cycles, condition, capacity, source, estimated empty, discharge rate. Returns `null` if no battery data.
- `thermalCard(data, contentWidth)` — state (coloured by pressure), per-sensor temps, optional error.
- `networkCard(data, contentWidth)` — interface name/IP, RX/TX bytes and packets.
- `packetCard(data, contentWidth)` — total/rx/tx packets, connections, top process, interface count. Returns `null` if no packet data.
- `tasksCard(data, contentWidth)` — up to 6 tasks with pid, user, cpu%, mem%, state, command. Returns `null` if no tasks.

### Table Renderers

- `processTableLines(processes, contentWidth, borderAccent?): string[]` — renders a fixed-column process table with PID, PPID, USER, CPU%, MEM%, STATE, THREADS, RUNTIME, COMMAND columns. Colour-codes CPU% and MEM% by threshold.
- `diskTableLines(disks, contentWidth, borderAccent?): string[]` — renders a filesystem table with FILESYSTEM, SIZE, USED, AVAIL, CAP, MOUNT columns. Colour-codes capacity by threshold.
- `buildProcessTree(processes): string[]` — renders a tree view of processes using Unicode box-drawing characters, sorted by CPU usage within each subtree.

### Tab Bar

- `TAB_DEFS` — canonical array of 12 tab definitions: `{ id, label, key }` mapping panel IDs to display labels and keyboard shortcuts (1–9, 0, P, R).
- `TAB_BAR_ROW` — constant `4` (1-indexed terminal row where the tab bar renders).
- `getTabHitboxes(): { id, start, end }[]` — computes column ranges for each tab so mouse clicks can be mapped back to panel IDs.
- `tabBar(activePanel, width, theme): string` — renders the tab bar line with active tab bold and inactive tabs dim.

### Header

- `header(data, width, badges?, borderAccent?): string[]` — renders the top header line with PYRE branding, hostname, OS, uptime, current time, and optional badges.

### Main Orchestrator

- `formatTable(data, opts?): string` — the primary entry point for dashboard rendering.
  1. Clamps width via `clampWidth`.
  2. If `activePanel !== 'grid'`, renders a single detail panel for that tab.
  3. If `activePanel === 'grid'`, lays out visible cards in a grid (1–3 columns depending on width via `gridColumns`), then optionally appends Disk and Process panels.
  4. Process panel supports `filter`, `sortBy`, `processLimit`, and `treeView` options.

### Exported Helpers

- `clampWidth(width?): number` — clamps terminal width to 60–240, defaulting to 80.
- `gridColumns(width: number): number` — returns 1/2/3 cards per row based on width thresholds (≥150→3, ≥96→2, else 1).

## `output.ts` — Data Export & Graphs

### Export Functions

- `formatJson(data: StatsData): string` — serialises `StatsData` to pretty-printed JSON (2-space indent).
- `formatCsv(data: StatsData): string` — serialises `StatsData` to CSV with a `property,key,value` header row. Includes all fields from cpu, memory, thermal, network, battery, power, system, packets (if present), gpu (if present), and every process (pid, ppid, user, cpu, mem, state, threads, runtime, command). String values are double-quote-escaped.
- `formatTsv(data: StatsData): string` — converts CSV output to TSV by replacing commas with tabs.

### Graph Rendering

- `formatGraphs(history, width?, themeName?, graphMode?): string` — renders a panel of sparkline/bar graphs for CPU, memory, temperature, network RX/TX, power, and packet rates. Uses `panel()` for the border and `graphRow()` for each metric line.

### Internal Helpers

- `graphRow(label, values, bounds, fmt, sparkWidth?, emptyMessage?, mode?): string` — renders a single graph line with label, sparkline/bar, and current value. Colour-codes by percentage of the bounds range.
- `barGraph(values, bounds, width): string` — renders a bar-graph using Unicode block characters (`█` `▇` `▆` `▄` ` `).
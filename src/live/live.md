# src/live/ — Live Dashboard Module

The live module provides the interactive dashboard mode for pyre. It handles real-time data collection, keyboard/mouse input, screen rendering, snapshot export, and continuous CSV logging.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export — re-exports `startLive`, `stopLive`, and `LiveOptions` type |
| `types.ts` | Type definitions for `LiveOptions`, `ExportFormat`, `InputMode`, `SortMode`, `GraphMode` |
| `state.ts` | Shared mutable session state consumed by all sub-modules |
| `render.ts` | Screen rendering: main `render` loop, footer key-bindings, UI customizer overlay, thermal/CPU alert checker |
| `input.ts` | Keypress handling, mouse click handling, session lifecycle (`startLive`, `stopLive`), ticker management |
| `export.ts` | Snapshot export (JSON/CSV/TSV), continuous CSV logging, file-system utilities |

## External Dependencies

- **`src/monitors/index.ts`** — `collectAll()` and `StatsData` for data collection each tick.
- **`src/formatters/index.ts`** — `formatTable`, `formatGraphs`, `gridColumns`, `THEMES`, `getTabHitboxes`, `TAB_BAR_ROW`, `panel` for rendering.
- **`src/formatters/types.ts`** — `ThemeName`, `VisibleItems` for type safety.
- **`src/history.ts`** — `History` class for rolling-window metric storage used by graph rendering.
- **`src/p2p/index.ts`** — `startP2PServer` for P2P server lifecycle from the TUI.

## `index.ts` — Barrel Exports

Re-exports the public API of the live module:

- `startLive(opts, splashPromise?)` — starts the interactive dashboard
- `stopLive()` — tears down the live session and restores the terminal
- `LiveOptions` type — options passed to `startLive`

## `types.ts` — Type Definitions

### `LiveOptions`
Options passed to `startLive`:
- `interval: number` — refresh interval in seconds
- `detailed?: boolean` — include detailed sensor readings
- `exportDir?: string` — directory for snapshot exports and logs
- `autoLog?: boolean` — start continuous CSV logging immediately
- `theme?: ThemeName` — default visual theme

### `ExportFormat`
Union type: `'json' | 'csv' | 'tsv'` — controls snapshot export format.

### `InputMode`
Union type: `null | 'filter' | 'kill' | 'signal' | 'customizer' | 'p2p'` — tracks the current interactive input sub-mode.

### `SortMode`
Union type: `'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime'` — process sort key.

### `GraphMode`
Union type: `'spark' | 'bar'` — graph rendering style.

## `state.ts` — Shared Session State

All mutable state for the live dashboard is defined here so that `render`, `input`, and `export` sub-modules can share it without circular dependencies.

### State Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `intervalHandle` | `NodeJS.Timeout \| null` | `null` | Active ticker interval |
| `running` | `boolean` | `false` | Whether the live session is active |
| `paused` | `boolean` | `false` | Whether data collection is paused |
| `detailed` | `boolean` | `false` | Detailed sensor mode |
| `interval` | `number` | `2` | Refresh interval in seconds |
| `showGraphs` | `boolean` | `true` | Whether graphs are displayed |
| `graphMode` | `GraphMode` | `'spark'` | Graph rendering style |
| `exportFormat` | `ExportFormat` | `'json'` | Snapshot export format |
| `exportDir` | `string` | `'./pyre-exports'` | Directory for exports/logs |
| `currentTheme` | `ThemeName` | `'default'` | Active visual theme |
| `visiblePanels` | `VisibleItems` | All `true` | Which dashboard cards are shown |
| `logging` | `boolean` | `false` | Whether continuous CSV logging is active |
| `logStream` | `fs.WriteStream \| null` | `null` | Write stream for CSV log |
| `statusMessage` | `string` | `''` | Transient status message |
| `statusTimer` | `NodeJS.Timeout \| null` | `null` | Timer for auto-clearing status |
| `lastData` | `StatsData \| null` | `null` | Most recently collected data |
| `history` | `History` | `new History(40)` | Rolling window of metric samples |
| `keypressHandler` | `Function \| null` | `null` | Registered keypress listener |
| `termWidth` | `number` | `process.stdout.columns \|\| 80` | Current terminal width |
| `termHeight` | `number` | `process.stdout.rows \|\| 24` | Current terminal height |
| `sortMode` | `SortMode` | `'cpu'` | Active process sort key |
| `processFilter` | `string` | `''` | Active process filter string |
| `inputMode` | `InputMode` | `null` | Current input sub-mode |
| `inputBuffer` | `string` | `''` | Buffer for active text input |
| `treeView` | `boolean` | `false` | Process tree view toggle |
| `customizerIndex` | `number` | `0` | Selected index in UI customizer |
| `CUSTOMIZER_OPTIONS` | `string[]` | (see below) | Ordered list of customizer items |
| `CPU_ALERT_PCT` | `number` | `90` | CPU usage threshold for alerts |
| `TEMP_ALERT_C` | `number` | `95` | Temperature threshold for alerts |
| `alerted` | `boolean` | `false` | Whether an alert has been fired |
| `activePanel` | `string` | `'grid'` | Currently focused panel |
| `mouseEnabled` | `boolean` | `true` | Whether mouse input is enabled |
| `PANEL_TABS` | `readonly array` | (see below) | Ordered list of panel tab definitions |
| `p2pEvents` | `array` | `[]` | P2P peer event history |
| `p2pBind` | `string` | `''` | P2P bind address |
| `p2pServer` | `object \| null` | `null` | P2P server instance |
| `p2pServerRunning` | `boolean` | `false` | Whether P2P server is running |
| `p2pPort` | `number` | `9876` | P2P port |
| `p2pPassword` | `string` | `'pyre'` | P2P password |

### `PANEL_TABS`
Ordered array of 12 panel definitions: `cpu`, `mem`, `gpu`, `power`, `battery`, `thermal`, `network`, `packets`, `tasks`, `disk`, `process`, `p2p`. Each has `{ id, label, key }`.

### `CUSTOMIZER_OPTIONS`
Ordered list of 14 items: `Theme`, `Graph Mode`, `Toggle CPU`, `Toggle Memory`, `Toggle GPU`, `Toggle Power`, `Toggle Battery`, `Toggle Thermal`, `Toggle Network`, `Toggle Packets`, `Toggle Tasks`, `Toggle Disk`, `Toggle Processes`, `Toggle Tree View`.

### `SIGNAL_OPTIONS`
`readonly ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT']` — available signals for the kill signal picker.

### `setStatus(msg, ms?)`
Sets a transient status message that auto-clears after `ms` milliseconds (default 3000).

## `render.ts` — Screen Rendering

### `processRowBudget(): number`
Computes how many process rows can fit in the current terminal layout. Accounts for card columns, header, cards, graphs, and footer spacing. Returns a value clamped to 3–40.

### `p2pPanelLines(): { title: string; body: string[] }`
Renders the P2P status panel showing server state, bind address, password, and the 20 most recent peer events colour-coded by type (`auth`=green, `disconnect`=yellow, `error`/`blocked`/`rate_limited`=red, others=cyan).

### `renderCustomizerOverlay(): string`
Renders the UI customizer overlay showing all `CUSTOMIZER_OPTIONS` with the currently selected item marked by `▶`. Each item shows its current value/state (theme name, graph mode, visibility toggles).

### `render()`
The main render function. Called on every tick and after every input event.
1. If `activePanel === 'p2p'`, renders the P2P panel.
2. Otherwise, calls `formatTable()` with current state options (width, sort, filter, processLimit, theme, visible panels, treeView, activePanel).
3. If `showGraphs` and not in P2P panel, appends `formatGraphs()` output.
4. Appends the footer line.
5. If an `inputMode` is active, appends the appropriate input prompt (customizer, filter, kill, signal, p2p password).
6. If a `statusMessage` exists, appends it.
7. Writes the full output to stdout using ANSI escape sequences to clear and redraw the screen.

### `footerLine(): string`
Renders the bottom footer showing all key bindings with their current state (e.g. `p` shows "resume" or "pause" depending on `state.paused`). Includes badges for paused, recording, active panel, and P2P status.

### `checkAlerts(data: StatsData)`
Checks CPU usage and temperature against alert thresholds (`CPU_ALERT_PCT` = 90%, `TEMP_ALERT_C` = 95°C). On first trigger, sounds the terminal bell (`\x07`) and shows a red status message for 5 seconds. Resets the alert flag when conditions clear.

### Exported Functions
`render`, `footerLine`, `renderCustomizerOverlay`, `checkAlerts`, `processRowBudget`

## `input.ts` — Input Handling & Session Lifecycle

### `startLive(opts: LiveOptions, splashPromise?: Promise<void>)`
Starts the interactive live dashboard. Idempotent — calling while already running is a no-op.

1. Sets `state.running = true` and resets paused/detailed/theme/interval/exportDir from options.
2. Resets terminal dimensions and history max length.
3. Runs a warmup tick (`doWarmup()`) to collect initial data.
4. If a splash promise is provided, awaits it.
5. Enters alternate screen mode (`\x1b[?1049h`), hides cursor (`\x1b[?25l`), clears screen.
6. Enables mouse tracking if `state.mouseEnabled`.
7. Awaits warmup, then does an initial `render()`.
8. Starts the ticker interval (`restartTicker()`).
9. Starts logging if `opts.autoLog`.
10. Sets up raw TTY mode, keypress listener, resize listener, and SIGINT handler.

### `stopLive()`
Tears down the live session:
1. Clears the ticker interval and status timer.
2. Ends the log stream if active.
3. Stops the P2P server if running.
4. Removes the keypress listener.
5. Removes the resize listener.
6. Sets `state.running = false` and `state.logging = false`.
7. Restores terminal to normal mode (raw mode off, cursor shown, exit alternate screen).
8. Clears the screen and exits the process with code 0.

### Keypress Handler

The main keypress handler (registered on `process.stdin`) dispatches based on the current `inputMode`:

**When no input mode is active (normal mode):**

| Key | Action |
|-----|--------|
| `q` | `stopLive()` |
| `c` | Enter customizer mode |
| `r` | Toggle P2P server (or enter P2P password input) |
| `p` | Toggle pause |
| `g` | Toggle graphs |
| `b` | Cycle graph mode (spark ↔ bar) |
| `d` | Toggle detailed sensor mode |
| `←`/`→`/`tab` | Cycle to next/prev panel tab |
| `1`–`9`, `0` | Jump to panel by number (cpu, mem, gpu, power, battery, thermal, network, packets, tasks, disk) |
| `P` | Toggle process panel |
| `s` | Cycle sort mode (cpu → mem → pid → user → command → state → threads → runtime) |
| `/` | Enter filter input mode |
| `k` | Enter kill PID input mode |
| `S` | Enter signal picker (starts at SIGTERM) |
| `t` | Toggle tree view |
| `e` | Export snapshot |
| `l` | Toggle continuous CSV logging |
| `f` | Cycle export format (json → csv → tsv → json) |
| `+`/`-` | Increase/decrease refresh interval by 1s |
| Any single char | If it matches a tab key (`1`–`9`, `0`, `p`, `r`), jump to that panel |

**Filter input mode:**
- Type to build the filter string; Enter applies, Esc cancels.

**Kill input mode:**
- Type a PID; Enter sends SIGTERM, Esc cancels.

**Signal picker mode:**
- ↑/↓ or j/k to cycle through `SIGNAL_OPTIONS`; Enter sends the selected signal to the PID entered in the kill mode; Esc cancels.

**Customizer mode:**
- ↑/↓ or j/k to navigate options; Enter/Space to toggle; Esc to exit.
- `Theme` cycles through available themes.
- `Graph Mode` cycles spark ↔ bar.
- `Toggle Tree View` toggles tree view.
- Other options toggle panel visibility.

**P2P password input mode:**
- Type password; Enter starts P2P server, Esc cancels.

### Mouse Handling
Supports both normal mouse (`\x1b[M`) and SGR mouse (`\x1b[<`) protocols. Clicks on the tab bar row (`TAB_BAR_ROW` = 4) are mapped to panel tabs via `getTabHitboxes()`.

### `handleInputModeKey(str, key)`
Dispatches keypresses within an active input sub-mode (customizer, signal, p2p, filter, kill).

### `killProcess(pidStr, signal?)`
Sends a signal (default SIGTERM) to the specified PID. Shows a status message on success or failure.

### `startP2PServerFromTUI()`
Starts a P2P server from within the TUI using the current password and port. Handles errors and updates state accordingly.

### `syncP2PEvents()`
Syncs P2P peer event history from the server instance into `state.p2pEvents`.

### `stopP2PServer()`
Stops the running P2P server and resets P2P-related state.

### `onResize()`
Updates terminal dimensions on resize, adjusts history max length, and re-renders.

### `restartTicker()`
Clears and restarts the data-collection interval based on `state.interval`.

### `doWarmup()`
Collects an initial data sample, pushes it to history, writes a log row if logging, checks alerts, and syncs P2P events.

### `tick()`
The main data-collection tick. Runs every `state.interval` seconds when not paused. Collects data, updates history, writes log row, checks alerts, syncs P2P events, and calls `render()`.

### `tabKeyToId(str)`
Maps a single-character tab key (`1`–`9`, `0`, `p`, `r`) to its panel ID.

### `cycleTab(direction)`
Cycles through `PANEL_TABS` in the given direction (1 = forward, -1 = backward).

### `handleNormalMouse(seq)` and `handleSGRMouse(seq)`
Parse mouse event sequences and delegate to `handleMouseClick()`.

### `handleMouseClick(y, x)`
If the click is on the tab bar row, finds the hitbox at the clicked column and toggles the corresponding panel.

## `export.ts` — Snapshot Export & CSV Logging

### `ensureDir(dir: string)`
Creates a directory recursively if it does not exist.

### `timestampForFile(): string`
Generates a filesystem-safe ISO timestamp string (colons and dots replaced with hyphens).

### `exportSnapshot()`
Exports `state.lastData` to a file in `state.exportDir` using `state.exportFormat`. Filename pattern: `pyre-<timestamp>.<format>`. Shows a status message on success or failure.

### `startLogging()`
Starts continuous CSV logging. Creates a log file `pyre-log-<timestamp>.csv` in `state.exportDir` with a header row, then sets `state.logging = true`.

### `stopLogging()`
Stops continuous CSV logging. Ends the write stream and sets `state.logging = false`.

### `toggleLogging()`
Toggles logging on/off by calling `stopLogging()` or `startLogging()`.

### `writeLogRow(data)`
Writes a single CSV row to the log stream with the following columns: `timestamp`, `cpu_usage`, `mem_usage_percent`, `temp_c`, `net_rx_bytes`, `net_tx_bytes`, `net_rx_packets`, `net_tx_packets`, `connections`, `thermal_state`. No-op if logging is not active or the log stream is unavailable.
export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Activity Monitor</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg-window: #1e1e1e;
  --bg-toolbar: #2c2c2e;
  --bg-surface: #252528;
  --bg-surface-hover: rgba(255, 255, 255, 0.05);
  --bg-table-header: #28282a;
  --bg-table-alt: rgba(255, 255, 255, 0.02);
  --bg-selection: #007aff;
  --text-selection: #ffffff;
  --border-color: #38383a;
  --border-light: rgba(255, 255, 255, 0.1);
  --text-primary: #ffffff;
  --text-secondary: #a1a1a6;
  --text-tertiary: #636366;
  --mac-blue: #007aff;
  --mac-green: #34c759;
  --mac-yellow: #ff9f0a;
  --mac-red: #ff453a;
  --mac-purple: #af52de;
  --mac-teal: #64d2ff;
  --font-system: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
}

html, body {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--bg-window);
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 12px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-font-smoothing: antialiased;
}

body {
  display: flex;
  flex-direction: column;
}

/* Unified macOS Toolbar */
#toolbar {
  height: 52px;
  min-height: 52px;
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  gap: 12px;
  z-index: 50;
  -webkit-app-region: drag;
}

.toolbar-left, .toolbar-center, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.toolbar-center {
  flex: 1;
  justify-content: center;
}

/* macOS Toolbar Push Buttons */
.mac-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: #3a3a3c;
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.mac-btn:hover:not(:disabled) {
  background: #48484a;
  border-color: #545458;
}
.mac-btn:active:not(:disabled) {
  background: #323234;
}
.mac-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.mac-btn-icon {
  width: 28px;
  padding: 0;
}
.mac-btn-danger {
  background: rgba(255, 69, 58, 0.2);
  border-color: rgba(255, 69, 58, 0.4);
  color: #ff6961;
}
.mac-btn-danger:hover:not(:disabled) {
  background: rgba(255, 69, 58, 0.35);
  border-color: var(--mac-red);
  color: #fff;
}
.mac-btn-primary {
  background: var(--mac-blue);
  border-color: #0062cc;
  color: #fff;
}
.mac-btn-primary:hover:not(:disabled) {
  background: #006ee6;
}

/* macOS Segmented Control Tabs */
.mac-segmented {
  display: inline-flex;
  background: #1c1c1e;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.mac-seg-item {
  padding: 4px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.18s ease;
  display: flex;
  align-items: center;
  gap: 5px;
}
.mac-seg-item:hover:not(.active) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}
.mac-seg-item.active {
  background: #636366;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

/* Filter Dropdown */
.mac-select {
  height: 28px;
  border-radius: 6px;
  background: #3a3a3c;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 11px;
  padding: 0 8px;
  outline: none;
  cursor: pointer;
}
.mac-select:hover {
  background: #48484a;
}

/* Search Field */
.mac-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.mac-search-icon {
  position: absolute;
  left: 8px;
  width: 13px;
  height: 13px;
  fill: var(--text-secondary);
  pointer-events: none;
}
.mac-search-input {
  height: 28px;
  width: 170px;
  background: #1c1c1e;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0 24px 0 26px;
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 12px;
  outline: none;
  transition: width 0.2s, border-color 0.2s;
}
.mac-search-input:focus {
  width: 210px;
  border-color: var(--mac-blue);
  box-shadow: 0 0 0 1px var(--mac-blue);
}
.mac-search-clear {
  position: absolute;
  right: 6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-tertiary);
  color: #000;
  display: none;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  cursor: pointer;
  line-height: 1;
}

/* Session Recorder Button & Pulsing Dot */
.mac-btn-record {
  font-family: var(--font-mono);
  font-size: 11px;
  gap: 7px;
  padding: 0 10px;
  border-color: var(--border-color);
  background: #323235;
}
.mac-btn-record:hover:not(:disabled) {
  background: #3e3e42;
}
.mac-btn-record.recording {
  background: rgba(255, 69, 58, 0.22);
  border-color: var(--mac-red);
  color: #ff6961;
}
.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #777;
  display: inline-block;
  transition: background 0.2s;
}
.mac-btn-record.recording .rec-dot {
  background: #ff453a;
  box-shadow: 0 0 8px #ff453a;
  animation: rec-pulse 1.2s infinite alternate ease-in-out;
}
@keyframes rec-pulse {
  from { opacity: 0.45; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1.2); }
}

/* Export Snapshot Dropdown Menu */
.mac-dropdown-wrap {
  position: relative;
  display: inline-flex;
}
.mac-dropdown-menu {
  position: absolute;
  top: 32px;
  left: 0;
  min-width: 165px;
  background: #2c2c2e;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.65);
  padding: 5px;
  display: none;
  flex-direction: column;
  z-index: 200;
}
.mac-dropdown-menu.show {
  display: flex;
}
.mac-menu-item {
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--text-primary);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mac-menu-item:hover {
  background: var(--mac-blue);
  color: #fff;
}

/* Logs View & Stream Table */
#logs-view {
  flex: 1;
  display: none;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.logs-sub-toolbar {
  height: 38px;
  min-height: 38px;
  background: var(--bg-table-header);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 10px;
}
.logs-sub-left, .logs-sub-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logs-scroll-area {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-window);
}
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.log-table th {
  position: sticky;
  top: 0;
  background: #252528;
  color: var(--text-secondary);
  font-weight: 600;
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
  z-index: 5;
}
.log-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
  font-family: var(--font-mono);
}
.log-table tr:hover {
  background: var(--bg-surface-hover);
}
.log-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.log-badge.info { background: rgba(0, 122, 255, 0.18); color: #64b5f6; border: 1px solid rgba(0, 122, 255, 0.3); }
.log-badge.warn { background: rgba(255, 159, 10, 0.18); color: #ffb74d; border: 1px solid rgba(255, 159, 10, 0.35); }
.log-badge.crit { background: rgba(255, 69, 58, 0.22); color: #ff6e6e; border: 1px solid rgba(255, 69, 58, 0.45); }
.log-badge.action { background: rgba(175, 82, 222, 0.2); color: #d084f7; border: 1px solid rgba(175, 82, 222, 0.4); }
.log-badge.watchdog { background: rgba(52, 199, 89, 0.2); color: #81c784; border: 1px solid rgba(52, 199, 89, 0.4); }

.log-subsys {
  font-weight: 600;
  color: var(--text-secondary);
}
.log-msg {
  color: var(--text-primary);
  font-family: var(--font-system);
  font-size: 11.5px;
}
.log-ctx {
  color: var(--text-tertiary);
  font-size: 10.5px;
}

/* History Explorer Table */
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.history-table th {
  color: var(--text-secondary);
  font-weight: 600;
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color);
}
.history-table td {
  padding: 5px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.history-link {
  color: var(--mac-blue);
  cursor: pointer;
  text-decoration: none;
}
.history-link:hover {
  text-decoration: underline;
}

/* Main Split View */
#split-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* Top Process Table Area */
#table-container {
  flex: 62;
  min-height: 160px;
  overflow-y: auto;
  overflow-x: auto;
  background: var(--bg-window);
  position: relative;
}
#table-container::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
#table-container::-webkit-scrollbar-track {
  background: var(--bg-window);
}
#table-container::-webkit-scrollbar-thumb {
  background: #424245;
  border-radius: 5px;
  border: 2px solid var(--bg-window);
}

table.mac-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  table-layout: fixed;
}
table.mac-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-table-header);
}
table.mac-table th {
  padding: 6px 10px;
  text-align: right;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
table.mac-table th:first-child {
  text-align: left;
}
table.mac-table th:hover {
  background: #323235;
  color: var(--text-primary);
}
table.mac-table th .sort-caret {
  display: inline-block;
  margin-left: 4px;
  font-size: 8px;
  color: var(--mac-blue);
}

table.mac-table tbody tr {
  height: 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  cursor: default;
}
table.mac-table tbody tr:nth-child(even) {
  background: var(--bg-table-alt);
}
table.mac-table tbody tr:hover {
  background: var(--bg-surface-hover);
}
table.mac-table tbody tr.selected {
  background: var(--bg-selection) !important;
  color: var(--text-selection) !important;
}
table.mac-table tbody tr.selected td {
  color: var(--text-selection) !important;
}

table.mac-table td {
  padding: 3px 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
table.mac-table.density-compact td {
  padding: 1px 7px;
  font-size: 10px;
}
table.mac-table.density-comfortable td {
  padding: 6px 12px;
  font-size: 12px;
}
table.mac-table td.col-name {
  text-align: left;
  font-family: var(--font-system);
  display: flex;
  align-items: center;
  gap: 7px;
}
.proc-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  background: #3a3a3c;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}
.proc-icon.system { background: #5856d6; }
.proc-icon.user { background: #007aff; }

/* Horizontal Split Divider */
#split-divider {
  height: 4px;
  min-height: 4px;
  background: #2a2a2d;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  cursor: row-resize;
  position: relative;
  z-index: 20;
}
#split-divider::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 1px;
  transform: translateX(-50%);
  width: 28px;
  height: 2px;
  background: #4a4a4d;
  border-radius: 1px;
}

/* Bottom Hardware Dashboard Panels */
#bottom-panel {
  flex: 38;
  min-height: 160px;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
  position: relative;
}

.panel-content {
  display: none;
  height: 100%;
  width: 100%;
  gap: 20px;
}
.panel-content.active {
  display: flex;
}

/* Left / Right Pane Layout */
.pane-col {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.pane-stats {
  width: 270px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
}
.pane-graph {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: #19191b;
  padding: 8px;
  overflow: hidden;
}

/* Stat Rows */
.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}
.stat-k {
  color: var(--text-secondary);
  font-weight: 500;
}
.stat-v {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* Canvas Graph Styling */
.graph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.graph-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.graph-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
  color: var(--text-secondary);
}
.legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
canvas.mac-canvas {
  width: 100%;
  height: 100%;
  flex: 1;
  display: block;
}

/* Memory Pressure Badge */
.pressure-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 6px;
  background: #1c1c1e;
  border: 1px solid var(--border-color);
}
.pressure-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--mac-green);
  box-shadow: 0 0 8px var(--mac-green);
}
.pressure-dot.warn { background: var(--mac-yellow); box-shadow: 0 0 8px var(--mac-yellow); }
.pressure-dot.crit { background: var(--mac-red); box-shadow: 0 0 8px var(--mac-red); }
.pressure-text {
  font-weight: 600;
  font-size: 11px;
}

/* Status Bar */
#statusbar {
  height: 24px;
  min-height: 24px;
  background: #1a1a1c;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  font-size: 11px;
  color: var(--text-secondary);
  z-index: 40;
}
.sb-left, .sb-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sb-live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sb-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mac-green);
}
.sb-live-dot.offline {
  background: var(--mac-red);
}

/* Modal Sheets */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-backdrop.open {
  display: flex;
  animation: fadeIn 0.15s ease-out;
}
.mac-sheet {
  background: #252528;
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
  border-radius: 10px;
  overflow: hidden;
  max-width: 90vw;
  animation: slideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-quit-box { width: 380px; padding: 20px; text-align: center; }
.modal-inspect-box { width: 520px; }
.modal-settings-box {
  width: 680px;
  height: 540px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.settings-tabs {
  display: flex;
  background: #1c1c1e;
  border-bottom: 1px solid var(--border-color);
  padding: 0 10px;
  gap: 4px;
}
.settings-tab-btn {
  padding: 9px 13px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.settings-tab-btn:hover {
  color: var(--text-primary);
}
.settings-tab-btn.active {
  color: #fff;
  border-bottom-color: var(--mac-blue);
  font-weight: 600;
}
.settings-content-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  background: var(--bg-window);
}
.settings-pane {
  display: none;
  flex-direction: column;
  gap: 14px;
}
.settings-pane.active {
  display: flex;
}
.settings-card {
  background: #252528;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.settings-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.settings-label-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-primary);
}
.settings-sublabel {
  font-size: 10px;
  color: var(--text-tertiary);
}
.settings-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* macOS style toggle switch */
.mac-switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
}
.mac-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.mac-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: #3e3e42;
  transition: 0.2s;
  border-radius: 22px;
  border: 1px solid var(--border-color);
}
.mac-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: #fff;
  transition: 0.2s;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
input:checked + .mac-slider {
  background-color: var(--mac-blue);
  border-color: var(--mac-blue);
}
input:checked + .mac-slider:before {
  transform: translateX(16px);
}
.settings-input {
  background: #1e1e20;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  color: var(--text-primary);
  padding: 4px 8px;
  font-size: 11.5px;
  outline: none;
}
.settings-input:focus {
  border-color: var(--mac-blue);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 10.5px;
  font-weight: 600;
}
.status-pill.active {
  background: rgba(52, 199, 89, 0.2);
  color: #34c759;
  border: 1px solid rgba(52, 199, 89, 0.35);
}
.status-pill.inactive {
  background: rgba(255, 159, 10, 0.2);
  color: #ff9f0a;
  border: 1px solid rgba(255, 159, 10, 0.35);
}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideDown { from { transform: translateY(-16px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }

.sheet-header {
  height: 40px;
  background: #2c2c2e;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
}
.sheet-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}
.sheet-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}
.sheet-close-btn:hover { color: #fff; }
.sheet-body {
  padding: 16px;
  max-height: 65vh;
  overflow-y: auto;
}
.sheet-footer {
  padding: 12px 16px;
  background: #202022;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* Quit Sheet Specific */
.quit-icon-wrap {
  margin: 0 auto 12px;
  width: 54px;
  height: 54px;
}
.quit-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
}
.quit-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-bottom: 20px;
}

/* Toast */
#toast {
  position: fixed;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: rgba(40, 40, 44, 0.95);
  border: 1px solid var(--border-color);
  color: #fff;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  opacity: 0;
  transition: all 0.25s ease;
  pointer-events: none;
  z-index: 2000;
}
#toast.show {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}

/* Disk Mount Meter */
.disk-bar {
  height: 8px;
  border-radius: 4px;
  background: #1c1c1e;
  overflow: hidden;
  margin-top: 3px;
  border: 1px solid var(--border-color);
}
.disk-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--mac-blue), #5ac8fa);
}
</style>
</head>
<body>

<!-- Unified macOS Toolbar -->
<header id="toolbar">
  <div class="toolbar-left">
    <!-- Stop process button (octagon with ✕) -->
    <button id="btn-stop" class="mac-btn mac-btn-icon mac-btn-danger" title="Force a process to quit" disabled onclick="confirmQuitSelected()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2zm1.41 2L4 8.27v7.46L8.27 20h7.46L20 15.73V8.27L15.73 4H9.27zM12 10.59l3.3-3.3 1.41 1.42L13.41 12l3.3 3.29-1.41 1.42L12 13.41l-3.29 3.3-1.42-1.42L10.59 12l-3.3-3.29 1.42-1.42L12 10.59z"/>
      </svg>
    </button>

    <!-- Inspect process button (ⓘ) -->
    <button id="btn-inspect" class="mac-btn mac-btn-icon" title="Inspect a process" disabled onclick="openInspectorSelected()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
      </svg>
    </button>

    <!-- Continuous CSV Session Recorder button -->
    <button id="btn-record" class="mac-btn mac-btn-record" title="Start continuous CSV logging session to ./pyre-exports (Shortcut: R)" onclick="toggleWebRecording()">
      <span class="rec-dot" id="rec-dot"></span>
      <span id="rec-label">Record</span>
    </button>

    <!-- Quick Snapshot Exporter -->
    <div class="mac-dropdown-wrap">
      <button id="btn-export" class="mac-btn" title="Export current telemetry snapshot" onclick="toggleExportMenu(event)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
        <span>Export ▾</span>
      </button>
      <div class="mac-dropdown-menu" id="export-menu">
        <div class="mac-menu-item" onclick="downloadSnapshot('json')">📄 Snapshot JSON</div>
        <div class="mac-menu-item" onclick="downloadSnapshot('csv')">📊 Snapshot CSV</div>
        <div class="mac-menu-item" onclick="downloadSnapshot('tsv')">📋 Snapshot TSV</div>
        <div class="mac-menu-item" onclick="downloadSnapshot('md')">📝 Snapshot Markdown</div>
      </div>
    </div>
  </div>

  <!-- Segmented Control Tabs (Center) -->
  <div class="toolbar-center">
    <nav class="mac-segmented" role="tablist">
      <div class="mac-seg-item active" data-tab="cpu" onclick="switchTab('cpu')">CPU</div>
      <div class="mac-seg-item" data-tab="memory" onclick="switchTab('memory')">Memory</div>
      <div class="mac-seg-item" data-tab="energy" onclick="switchTab('energy')">Energy</div>
      <div class="mac-seg-item" data-tab="disk" onclick="switchTab('disk')">Disk</div>
      <div class="mac-seg-item" data-tab="network" onclick="switchTab('network')">Network</div>
      <div class="mac-seg-item" data-tab="gpu" onclick="switchTab('gpu')">GPU</div>
      <div class="mac-seg-item" data-tab="logs" onclick="switchTab('logs')">Logs</div>
    </nav>
  </div>

  <div class="toolbar-right">
    <!-- View Filter Menu -->
    <select id="proc-filter" class="mac-select" onchange="onFilterChange(this.value)" title="Filter processes">
      <option value="all">All Processes</option>
      <option value="my">My Processes</option>
      <option value="active">Active Processes</option>
      <option value="system">System Processes</option>
    </select>

    <!-- Search Input Field -->
    <div class="mac-search-wrap">
      <svg class="mac-search-icon" viewBox="0 0 24 24">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input id="search-input" class="mac-search-input" type="text" placeholder="Search" oninput="onSearchInput(this.value)" autocomplete="off" spellcheck="false"/>
      <div id="search-clear" class="mac-search-clear" onclick="clearSearch()">✕</div>
    </div>

    <!-- Settings / Preferences Button -->
    <button id="btn-settings" class="mac-btn mac-btn-icon" title="Preferences (Cmd+,)" onclick="openSettingsModal()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    </button>
  </div>
</header>

<!-- Main Split View -->
<div id="split-view">
  <!-- Top: Dynamic Process Table & Logs View -->
  <main id="table-container" tabindex="0">
    <table class="mac-table" id="proc-table">
      <thead id="proc-thead">
        <!-- Columns will be injected based on active tab -->
      </thead>
      <tbody id="proc-tbody">
        <!-- Process rows injected here -->
      </tbody>
    </table>

    <!-- Dedicated Logs & Audit Stream Container -->
    <div id="logs-view">
      <div class="logs-sub-toolbar">
        <div class="logs-sub-left">
          <select id="log-filter-level" class="mac-select" onchange="onLogLevelFilterChange(this.value)" title="Filter log severity">
            <option value="all">All Severities</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warnings</option>
            <option value="CRIT">Critical</option>
            <option value="ACTION">User Actions</option>
            <option value="WATCHDOG">Watchdog</option>
          </select>
          <select id="log-filter-subsys" class="mac-select" onchange="onLogSubsysFilterChange(this.value)" title="Filter subsystem">
            <option value="all">All Subsystems</option>
            <option value="SYSTEM">System</option>
            <option value="CPU">CPU</option>
            <option value="MEM">Memory</option>
            <option value="DISK">Disk</option>
            <option value="NET">Network</option>
            <option value="THERMAL">Thermal</option>
            <option value="PROCESS">Process</option>
            <option value="LOGGER">Recorder</option>
          </select>
          <div class="mac-search-wrap">
            <svg class="mac-search-icon" viewBox="0 0 24 24">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input id="log-search-input" class="mac-search-input" style="width:180px;" type="text" placeholder="Search event logs (L)" oninput="onLogSearchInput(this.value)" autocomplete="off" spellcheck="false"/>
          </div>
        </div>
        <div class="logs-sub-right">
          <button id="btn-autoscroll" class="mac-btn" onclick="toggleAutoScroll()" style="font-size:11px;color:var(--mac-green);">Auto-scroll: ON</button>
          <button class="mac-btn" onclick="clearLogs()" style="font-size:11px;">Clear</button>
          <button class="mac-btn mac-btn-primary" onclick="downloadLogsExport()" style="font-size:11px;">Export Logs JSON</button>
        </div>
      </div>
      <div class="logs-scroll-area" id="logs-scroll-area">
        <table class="log-table" id="logs-table">
          <thead>
            <tr>
              <th style="width:130px;">Time</th>
              <th style="width:85px;">Severity</th>
              <th style="width:90px;">Subsystem</th>
              <th>Event Message</th>
              <th style="width:220px;text-align:right;">Context / Telemetry</th>
            </tr>
          </thead>
          <tbody id="logs-tbody">
            <!-- Dynamic logs inserted here -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <!-- Horizontal Splitter Divider -->
  <div id="split-divider"></div>

  <!-- Bottom: Activity Monitor Hardware Panels -->
  <footer id="bottom-panel">
    <!-- 1. CPU Panel -->
    <div class="panel-content active" id="panel-cpu">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">% System:</span><span class="stat-v" id="cpu-stat-system">0.0%</span></div>
        <div class="stat-item"><span class="stat-k">% User:</span><span class="stat-v" id="cpu-stat-user">0.0%</span></div>
        <div class="stat-item"><span class="stat-k">% Idle:</span><span class="stat-v" id="cpu-stat-idle">100.0%</span></div>
        <div style="height:4px;border-bottom:1px solid var(--border-color);"></div>
        <div class="stat-item"><span class="stat-k">Threads:</span><span class="stat-v" id="cpu-stat-threads">0</span></div>
        <div class="stat-item"><span class="stat-k">Processes:</span><span class="stat-v" id="cpu-stat-procs">0</span></div>
        <div class="stat-item"><span class="stat-k">Processor:</span><span class="stat-v" id="cpu-stat-brand" style="font-size:10px;">–</span></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">CPU Load</span>
          <div class="graph-legend">
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-blue)"></span> User</span>
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-red)"></span> System</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-cpu"></canvas>
      </div>
    </div>

    <!-- 2. Memory Panel -->
    <div class="panel-content" id="panel-memory">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">Physical Memory:</span><span class="stat-v" id="mem-stat-phys">–</span></div>
        <div class="stat-item"><span class="stat-k">Memory Used:</span><span class="stat-v" id="mem-stat-used">–</span></div>
        <div class="stat-item"><span class="stat-k">App Memory:</span><span class="stat-v" id="mem-stat-app">–</span></div>
        <div class="stat-item"><span class="stat-k">Wired Memory:</span><span class="stat-v" id="mem-stat-wired">–</span></div>
        <div class="stat-item"><span class="stat-k">Compressed:</span><span class="stat-v" id="mem-stat-comp">–</span></div>
        <div class="stat-item"><span class="stat-k">Cached Files:</span><span class="stat-v" id="mem-stat-cached">–</span></div>
        <div class="stat-item"><span class="stat-k">Swap Used:</span><span class="stat-v" id="mem-stat-swap">–</span></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">Memory Pressure</span>
          <div class="pressure-meter">
            <div class="pressure-dot" id="pressure-dot"></div>
            <span class="pressure-text" id="pressure-text">Normal</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-mem"></canvas>
      </div>
    </div>

    <!-- 3. Energy Panel -->
    <div class="panel-content" id="panel-energy">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">Total Power Draw:</span><span class="stat-v" id="energy-stat-total">–</span></div>
        <div class="stat-item"><span class="stat-k">CPU Package:</span><span class="stat-v" id="energy-stat-cpu">–</span></div>
        <div class="stat-item"><span class="stat-k">GPU Package:</span><span class="stat-v" id="energy-stat-gpu">–</span></div>
        <div style="height:4px;border-bottom:1px solid var(--border-color);"></div>
        <div class="stat-item"><span class="stat-k">Battery Level:</span><span class="stat-v" id="energy-stat-batt">–</span></div>
        <div class="stat-item"><span class="stat-k">Power Source:</span><span class="stat-v" id="energy-stat-source">–</span></div>
        <div class="stat-item"><span class="stat-k">Time Remaining:</span><span class="stat-v" id="energy-stat-timerem">–</span></div>
        <div class="stat-item"><span class="stat-k">Battery Health:</span><span class="stat-v" id="energy-stat-health">–</span></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">Energy Consumption</span>
          <div class="graph-legend">
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-yellow)"></span> Watts</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-energy"></canvas>
      </div>
    </div>

    <!-- 4. Disk Panel -->
    <div class="panel-content" id="panel-disk">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">Reads in / sec:</span><span class="stat-v" id="disk-stat-reads">–</span></div>
        <div class="stat-item"><span class="stat-k">Writes out / sec:</span><span class="stat-v" id="disk-stat-writes">–</span></div>
        <div class="stat-item"><span class="stat-k">Data read:</span><span class="stat-v" id="disk-stat-total-read">–</span></div>
        <div class="stat-item"><span class="stat-k">Data written:</span><span class="stat-v" id="disk-stat-total-write">–</span></div>
        <div style="height:4px;border-bottom:1px solid var(--border-color);"></div>
        <div id="disk-mounts-box" style="display:flex;flex-direction:column;gap:5px;"></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">Disk Activity</span>
          <div class="graph-legend">
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-teal)"></span> Read/sec</span>
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-red)"></span> Write/sec</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-disk"></canvas>
      </div>
    </div>

    <!-- 5. Network Panel -->
    <div class="panel-content" id="panel-network">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">Packets in / sec:</span><span class="stat-v" id="net-stat-pkts-in">–</span></div>
        <div class="stat-item"><span class="stat-k">Packets out / sec:</span><span class="stat-v" id="net-stat-pkts-out">–</span></div>
        <div class="stat-item"><span class="stat-k">Data received / sec:</span><span class="stat-v" id="net-stat-rate-in">–</span></div>
        <div class="stat-item"><span class="stat-k">Data sent / sec:</span><span class="stat-v" id="net-stat-rate-out">–</span></div>
        <div style="height:4px;border-bottom:1px solid var(--border-color);"></div>
        <div class="stat-item"><span class="stat-k">Data received:</span><span class="stat-v" id="net-stat-total-in">–</span></div>
        <div class="stat-item"><span class="stat-k">Data sent:</span><span class="stat-v" id="net-stat-total-out">–</span></div>
        <div class="stat-item"><span class="stat-k">Interface / IP:</span><span class="stat-v" id="net-stat-iface" style="font-size:10px;">–</span></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">Network Throughput</span>
          <div class="graph-legend">
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-blue)"></span> In / sec</span>
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-red)"></span> Out / sec</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-net"></canvas>
      </div>
    </div>

    <!-- 6. GPU Panel -->
    <div class="panel-content" id="panel-gpu">
      <div class="pane-stats">
        <div class="stat-item"><span class="stat-k">GPU Processor:</span><span class="stat-v" id="gpu-stat-model" style="font-size:10px;">–</span></div>
        <div class="stat-item"><span class="stat-k">Utilization:</span><span class="stat-v" id="gpu-stat-util">–</span></div>
        <div class="stat-item"><span class="stat-k">VRAM Used:</span><span class="stat-v" id="gpu-stat-vram">–</span></div>
        <div class="stat-item"><span class="stat-k">Active Processes:</span><span class="stat-v" id="gpu-stat-procs">–</span></div>
        <div class="stat-item"><span class="stat-k">Temperature:</span><span class="stat-v" id="gpu-stat-temp">–</span></div>
      </div>
      <div class="pane-graph">
        <div class="graph-header">
          <span class="graph-title">GPU Utilization</span>
          <div class="graph-legend">
            <span class="legend-pill"><span class="legend-dot" style="background:var(--mac-purple)"></span> GPU %</span>
          </div>
        </div>
        <canvas class="mac-canvas" id="canvas-gpu"></canvas>
      </div>
    </div>

    <!-- 7. Logs Panel (Recording Session & History Explorer) -->
    <div class="panel-content" id="panel-logs">
      <div class="pane-stats" style="flex:1.2;">
        <div style="font-weight:700;margin-bottom:4px;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
          <span>Session CSV Recorder</span>
          <span id="logs-rec-badge" class="log-badge info">IDLE</span>
        </div>
        <div class="stat-item"><span class="stat-k">Status:</span><span class="stat-v" id="rec-stat-status">Idle</span></div>
        <div class="stat-item"><span class="stat-k">Active File:</span><span class="stat-v" id="rec-stat-file" style="font-size:10px;word-break:break-all;">–</span></div>
        <div class="stat-item"><span class="stat-k">Samples:</span><span class="stat-v" id="rec-stat-samples">0</span></div>
        <div class="stat-item"><span class="stat-k">Duration:</span><span class="stat-v" id="rec-stat-duration">0s</span></div>
        <div class="stat-item"><span class="stat-k">Export Dir:</span><span class="stat-v" id="rec-stat-dir" style="font-size:10px;">./pyre-exports</span></div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button class="mac-btn mac-btn-primary" id="btn-panel-rec" onclick="toggleWebRecording()" style="height:24px;font-size:11px;">Start Recording</button>
          <button class="mac-btn" onclick="fetchLogHistory()" style="height:24px;font-size:11px;">Refresh History</button>
        </div>
      </div>
      <div class="pane-graph" style="flex:2;display:flex;flex-direction:column;padding:8px 12px;overflow-y:auto;">
        <div class="graph-header" style="margin-bottom:6px;">
          <span class="graph-title">Saved CSV Logs on Disk</span>
          <span style="font-size:10px;color:var(--text-tertiary);">Replay in CLI: <code>pyre replay &lt;file&gt;</code></span>
        </div>
        <div id="history-list-box" style="flex:1;overflow-y:auto;">
          <table class="history-table">
            <thead>
              <tr><th>Filename</th><th>Size</th><th>Recorded At</th><th>Action</th></tr>
            </thead>
            <tbody id="history-tbody">
              <tr><td colspan="4" style="color:var(--text-tertiary);text-align:center;padding:12px;">Scanning ./pyre-exports...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </footer>
</div>

<!-- macOS Window Status Bar -->
<div id="statusbar">
  <div class="sb-left">
    <div class="sb-live-indicator">
      <span class="sb-live-dot" id="sb-dot"></span>
      <span id="sb-status">Connecting</span>
    </div>
    <span id="sb-host">–</span>
  </div>
  <div class="sb-right">
    <span id="sb-count">0 processes</span>
    <span>Updated <span id="sb-time">–</span></span>
  </div>
</div>

<!-- Modal 1: Force Quit Confirmation Sheet -->
<div class="modal-backdrop" id="modal-quit" onclick="if(event.target===this)closeModal('modal-quit')">
  <div class="mac-sheet modal-quit-box">
    <div class="quit-icon-wrap">
      <svg width="54" height="54" viewBox="0 0 24 24" fill="var(--mac-red)">
        <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2zm1.41 2L4 8.27v7.46L8.27 20h7.46L20 15.73V8.27L15.73 4H9.27zM12 10.59l3.3-3.3 1.41 1.42L13.41 12l3.3 3.29-1.41 1.42L12 13.41l-3.29 3.3-1.42-1.42L10.59 12l-3.3-3.29 1.42-1.42L12 10.59z"/>
      </svg>
    </div>
    <div class="quit-title">Do you want to quit this process?</div>
    <div class="quit-desc" id="quit-modal-desc">
      Quitting process may cause unsaved changes to be lost.
    </div>
    <div style="display:flex;justify-content:center;gap:10px;">
      <button class="mac-btn" onclick="closeModal('modal-quit')">Cancel</button>
      <button class="mac-btn mac-btn-danger" id="btn-do-force-quit" onclick="executeQuit(true)">Force Quit</button>
      <button class="mac-btn mac-btn-primary" id="btn-do-quit" onclick="executeQuit(false)">Quit</button>
    </div>
  </div>
</div>

<!-- Modal 2: Process Inspector Sheet -->
<div class="modal-backdrop" id="modal-inspector" onclick="if(event.target===this)closeModal('modal-inspector')">
  <div class="mac-sheet modal-inspect-box">
    <div class="sheet-header">
      <span class="sheet-title" id="inspect-title">Process Inspector</span>
      <button class="sheet-close-btn" onclick="closeModal('modal-inspector')">✕</button>
    </div>
    <div class="sheet-body" id="inspect-body">
      <!-- Process details injected here -->
    </div>
    <div class="sheet-footer">
      <button class="mac-btn" onclick="closeModal('modal-inspector')">Close</button>
      <button class="mac-btn mac-btn-danger" onclick="confirmQuitFromInspector()">Quit Process…</button>
    </div>
  </div>
</div>

<!-- Modal 3: Settings / Preferences Sheet -->
<div class="modal-backdrop" id="modal-settings" onclick="if(event.target===this)closeSettingsModal()">
  <div class="mac-sheet modal-settings-box">
    <div class="sheet-header">
      <span class="sheet-title">Pyre Preferences</span>
      <button class="sheet-close-btn" onclick="closeSettingsModal()">✕</button>
    </div>

    <!-- Tab navigation -->
    <div class="settings-tabs">
      <button class="settings-tab-btn active" data-stab="general" onclick="switchSettingsTab('general')">General</button>
      <button class="settings-tab-btn" data-stab="autostart" onclick="switchSettingsTab('autostart')">Start on Boot</button>
      <button class="settings-tab-btn" data-stab="alerts" onclick="switchSettingsTab('alerts')">Alerts & Watchdog</button>
      <button class="settings-tab-btn" data-stab="appearance" onclick="switchSettingsTab('appearance')">Appearance</button>
      <button class="settings-tab-btn" data-stab="diagnostics" onclick="switchSettingsTab('diagnostics')">Diagnostics</button>
    </div>

    <div class="settings-content-wrap">
      <!-- 1. General Pane -->
      <div class="settings-pane active" id="spane-general">
        <div class="settings-card">
          <div class="settings-card-title">Telemetry Update Frequency</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Update Interval</span>
              <span class="settings-sublabel">How frequently Pyre collects and refreshes hardware & process statistics</span>
            </div>
            <div class="settings-control">
              <select id="set-interval" class="mac-select" onchange="onSettingChange()">
                <option value="0.5">0.5s (Turbo High Performance)</option>
                <option value="1">1.0s (Fast Gaming/Dev)</option>
                <option value="2">2.0s (Default Balanced)</option>
                <option value="5">5.0s (Low Energy)</option>
                <option value="10">10.0s (Battery Saver)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Process Table Defaults</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Default Process Filter</span>
              <span class="settings-sublabel">Initial process filter when dashboard opens</span>
            </div>
            <div class="settings-control">
              <select id="set-filter" class="mac-select" onchange="onSettingChange()">
                <option value="all">All Processes</option>
                <option value="my">My Processes</option>
                <option value="active">Active Processes Only</option>
                <option value="system">System Daemons Only</option>
              </select>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Default Sort Column</span>
              <span class="settings-sublabel">Default metric used to sort processes on launch</span>
            </div>
            <div class="settings-control">
              <select id="set-sort" class="mac-select" onchange="onSettingChange()">
                <option value="cpu">% CPU</option>
                <option value="mem">Memory Usage</option>
                <option value="runtime">CPU Runtime</option>
                <option value="threads">Thread Count</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Window & Launch Behavior</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Launch in Compact Widget Mode</span>
              <span class="settings-sublabel">Opens a compact floating HUD instead of the full activity window</span>
            </div>
            <div class="settings-control">
              <label class="mac-switch">
                <input type="checkbox" id="set-compact" onchange="onSettingChange()">
                <span class="mac-slider"></span>
              </label>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Keep Window Always on Top</span>
              <span class="settings-sublabel">Floats the dashboard window above all other full-screen apps</span>
            </div>
            <div class="settings-control">
              <label class="mac-switch">
                <input type="checkbox" id="set-ontop" onchange="onSettingChange()">
                <span class="mac-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Start on Boot Pane -->
      <div class="settings-pane" id="spane-autostart">
        <div class="settings-card">
          <div class="settings-card-title">Background Telemetry Service (Start on Boot)</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Start Pyre Telemetry on System Startup</span>
              <span class="settings-sublabel">Installs a native user-level LaunchAgent (macOS) or systemd user service (Linux)</span>
            </div>
            <div class="settings-control">
              <label class="mac-switch">
                <input type="checkbox" id="set-autostart" onchange="toggleAutostartFromUI(this.checked)">
                <span class="mac-slider"></span>
              </label>
            </div>
          </div>
          <div style="font-size:11px;background:#1a1a1d;border:1px solid var(--border-color);border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:var(--text-secondary);">Service Status:</span>
              <span id="svc-status-pill" class="status-pill inactive">Checking…</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-secondary);">Service Identifier:</span>
              <span id="svc-label" style="font-family:var(--font-mono);font-size:10px;">com.pyre.web</span>
            </div>
            <div style="display:flex;justify-content:space-between;word-break:break-all;">
              <span style="color:var(--text-secondary);">Agent Path:</span>
              <span id="svc-path" style="font-family:var(--font-mono);font-size:10px;">~/Library/LaunchAgents/com.pyre.web.plist</span>
            </div>
            <div style="display:flex;justify-content:space-between;word-break:break-all;">
              <span style="color:var(--text-secondary);">Log File:</span>
              <span id="svc-log" style="font-family:var(--font-mono);font-size:10px;">~/.config/pyre/web.log</span>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Network & Remote Access</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Expose to Local Network (Wi-Fi / LAN)</span>
              <span class="settings-sublabel">When enabled, Pyre dashboard is reachable from other devices on your LAN</span>
            </div>
            <div class="settings-control">
              <label class="mac-switch">
                <input type="checkbox" id="set-lan" onchange="onSettingChange()">
                <span class="mac-slider"></span>
              </label>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Default Web Server Port</span>
              <span class="settings-sublabel">Port used when running pyre web or background service</span>
            </div>
            <div class="settings-control">
              <input id="set-port" type="number" class="settings-input" style="width:75px;" value="3000" min="1024" max="65535" onchange="onSettingChange()">
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Alerts & Watchdog Pane -->
      <div class="settings-pane" id="spane-alerts">
        <div class="settings-card">
          <div class="settings-card-title">Resource Threshold Triggers</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">CPU Alert Threshold (%)</span>
              <span class="settings-sublabel">Trigger alert when system or process CPU exceeds this percentage</span>
            </div>
            <div class="settings-control">
              <input id="set-cpu-alert" type="number" class="settings-input" style="width:70px;" min="50" max="100" value="90" onchange="onSettingChange()">
              <span style="color:var(--text-secondary);font-size:11px;">%</span>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Temperature Alert Threshold (°C)</span>
              <span class="settings-sublabel">Trigger warning when SoC/CPU temperature exceeds this limit</span>
            </div>
            <div class="settings-control">
              <input id="set-temp-alert" type="number" class="settings-input" style="width:70px;" min="60" max="110" value="95" onchange="onSettingChange()">
              <span style="color:var(--text-secondary);font-size:11px;">°C</span>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Autonomous Process Watchdog</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Target Process Name Filter</span>
              <span class="settings-sublabel">Leave blank to monitor all processes, or specify e.g. "node", "chrome", "python"</span>
            </div>
            <div class="settings-control">
              <input id="set-watchdog-proc" type="text" class="settings-input" style="width:140px;" placeholder="All processes" onchange="onSettingChange()">
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Runaway Memory Limit (%)</span>
              <span class="settings-sublabel">Threshold to flag or throttle memory-leaking tasks</span>
            </div>
            <div class="settings-control">
              <input id="set-watchdog-mem" type="number" class="settings-input" style="width:70px;" min="10" max="95" value="80" onchange="onSettingChange()">
              <span style="color:var(--text-secondary);font-size:11px;">%</span>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Notification Channels & Webhooks</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Slack Webhook URL</span>
              <span class="settings-sublabel">https://hooks.slack.com/services/...</span>
            </div>
            <input id="set-slack-url" type="text" class="settings-input" style="width:230px;" placeholder="Optional Slack webhook" onchange="onSettingChange()">
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Discord Webhook URL</span>
              <span class="settings-sublabel">https://discord.com/api/webhooks/...</span>
            </div>
            <input id="set-discord-url" type="text" class="settings-input" style="width:230px;" placeholder="Optional Discord webhook" onchange="onSettingChange()">
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">ntfy.sh Topic URL</span>
              <span class="settings-sublabel">https://ntfy.sh/my-topic</span>
            </div>
            <input id="set-ntfy-url" type="text" class="settings-input" style="width:230px;" placeholder="Optional ntfy URL" onchange="onSettingChange()">
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:4px;">
            <button class="mac-btn mac-btn-primary" onclick="sendTestAlertFromUI()">Dispatch Test Notification</button>
          </div>
        </div>
      </div>

      <!-- 4. Appearance Pane -->
      <div class="settings-pane" id="spane-appearance">
        <div class="settings-card">
          <div class="settings-card-title">Hardware Telemetry Graphs</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Rolling History Window</span>
              <span class="settings-sublabel">Amount of history preserved in CPU, GPU, Network, and Disk graphs</span>
            </div>
            <div class="settings-control">
              <select id="set-history-len" class="mac-select" onchange="onSettingChange()">
                <option value="30">30 seconds (Compact)</option>
                <option value="60">60 seconds (Standard)</option>
                <option value="120">120 seconds (2 Minutes)</option>
                <option value="300">300 seconds (5 Minutes Long Run)</option>
              </select>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Animate Live Waveform Gradients</span>
              <span class="settings-sublabel">Renders smooth neon area fills under live telemetry curves</span>
            </div>
            <div class="settings-control">
              <label class="mac-switch">
                <input type="checkbox" id="set-show-graphs" checked onchange="onSettingChange()">
                <span class="mac-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Process Table Row Density</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Table Row Density</span>
              <span class="settings-sublabel">Adjust row density for higher information density</span>
            </div>
            <div class="settings-control">
              <select id="set-density" class="mac-select" onchange="onDensityChange(this.value)">
                <option value="compact">Compact (Activity Monitor classic)</option>
                <option value="standard" selected>Standard (Balanced)</option>
                <option value="comfortable">Comfortable (Larger text & touch)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 5. Diagnostics Pane -->
      <div class="settings-pane" id="spane-diagnostics">
        <div class="settings-card">
          <div class="settings-card-title">System Information</div>
          <div id="diag-sys-info" style="font-size:11px;color:var(--text-secondary);display:flex;flex-direction:column;gap:5px;">
            <div>Loading system specifications…</div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">System Diagnostics (pyre doctor)</div>
          <p style="font-size:11px;color:var(--text-secondary);margin:0;">Run an automated health check covering kernel access, SMC thermal sensors, battery diagnostics, permissions, and daemon connectivity.</p>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button class="mac-btn mac-btn-primary" id="btn-run-doctor" onclick="runDoctorFromUI()">Run Diagnostics</button>
          </div>
          <div id="doctor-results" style="display:none;background:#151518;border:1px solid var(--border-color);border-radius:6px;padding:10px;font-family:var(--font-mono);font-size:11px;max-height:160px;overflow-y:auto;white-space:pre-wrap;"></div>
        </div>

        <div class="settings-card" style="border-color:rgba(255,69,58,0.3);">
          <div class="settings-card-title" style="color:var(--mac-red);">Reset Configuration</div>
          <div class="settings-item">
            <div class="settings-label-wrap">
              <span class="settings-label">Reset Preferences to Factory Defaults</span>
              <span class="settings-sublabel">Clears ~/.config/pyre/config.json back to original out-of-the-box defaults</span>
            </div>
            <button class="mac-btn mac-btn-danger" onclick="resetConfigFromUI()">Reset All Settings</button>
          </div>
        </div>
      </div>
    </div>

    <div class="sheet-footer" style="display:flex;justify-content:space-between;align-items:center;background:#252528;border-top:1px solid var(--border-color);padding:10px 16px;">
      <span id="settings-status-hint" style="font-size:11px;color:var(--text-tertiary);">Preferences saved to ~/.config/pyre/config.json</span>
      <div style="display:flex;gap:8px;">
        <button class="mac-btn" onclick="closeSettingsModal()">Done</button>
      </div>
    </div>
  </div>
</div>

<!-- Toast notification -->
<div id="toast">Action completed</div>

<script>
// State Management
let currentTab = 'cpu';
let latestData = null;
let selectedPid = null;
let currentFilter = 'all';
let searchQuery = '';

// Logs & Audit State
let logsBuffer = [];
let logFilterLevel = 'all';
let logFilterSubsys = 'all';
let logSearchQuery = '';
let autoScrollLogs = true;
let isRecording = false;
let hasLoggedInit = false;
let prevThermalState = null;
let lastCpuSpikeTimes = {};
let lastHighMemAlert = 0;
let lastNetBurstAlert = 0;

// Sort State per tab
const sortState = {
  cpu: { col: 'cpu', dir: 'desc' },
  memory: { col: 'mem', dir: 'desc' },
  energy: { col: 'cpu', dir: 'desc' },
  disk: { col: 'cpu', dir: 'desc' },
  network: { col: 'cpu', dir: 'desc' },
  gpu: { col: 'cpu', dir: 'desc' }
};

// Rolling Metrics History
const MAX_POINTS = 60;
const historyData = {
  cpuUser: [],
  cpuSystem: [],
  memPressure: [],
  energyWatts: [],
  diskRead: [],
  diskWrite: [],
  netIn: [],
  netOut: [],
  gpuUtil: []
};

// Utilities
function pushHistory(arr, val) {
  arr.push(typeof val === 'number' && !isNaN(val) ? val : 0);
  if (arr.length > MAX_POINTS) arr.shift();
}

function fmtBytes(b, dec = 1) {
  if (b === undefined || b === null || isNaN(b) || b === 0) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(k));
  if (i < 0) return '0 B';
  const v = b / Math.pow(k, i);
  return (parseFloat(v.toFixed(dec))) + ' ' + (s[i] || 'TB');
}

function fmtTime(sec) {
  if (!sec) return '0:00.00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 10 ? '0' : '') + ms;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

// Tab Column Schemas
const tabColumns = {
  cpu: [
    { id: 'command', name: 'Process Name', width: '38%', align: 'left' },
    { id: 'cpu', name: '% CPU', width: '12%', align: 'right' },
    { id: 'runtime', name: 'CPU Time', width: '14%', align: 'right' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'state', name: 'State', width: '8%', align: 'center' },
    { id: 'pid', name: 'PID', width: '8%', align: 'right' },
    { id: 'user', name: 'User', width: '10%', align: 'left' }
  ],
  memory: [
    { id: 'command', name: 'Process Name', width: '38%', align: 'left' },
    { id: 'memBytes', name: 'Memory', width: '15%', align: 'right' },
    { id: 'mem', name: '% Memory', width: '11%', align: 'right' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'state', name: 'State', width: '8%', align: 'center' },
    { id: 'pid', name: 'PID', width: '8%', align: 'right' },
    { id: 'user', name: 'User', width: '10%', align: 'left' }
  ],
  energy: [
    { id: 'command', name: 'Process Name', width: '42%', align: 'left' },
    { id: 'energyImpact', name: 'Energy Impact', width: '16%', align: 'right' },
    { id: 'cpu', name: '% CPU', width: '12%', align: 'right' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'pid', name: 'PID', width: '10%', align: 'right' },
    { id: 'user', name: 'User', width: '10%', align: 'left' }
  ],
  disk: [
    { id: 'command', name: 'Process Name', width: '44%', align: 'left' },
    { id: 'cpu', name: '% CPU', width: '12%', align: 'right' },
    { id: 'state', name: 'State', width: '12%', align: 'center' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'pid', name: 'PID', width: '10%', align: 'right' },
    { id: 'user', name: 'User', width: '12%', align: 'left' }
  ],
  network: [
    { id: 'command', name: 'Process Name', width: '38%', align: 'left' },
    { id: 'netRx', name: 'Sent Bytes', width: '13%', align: 'right' },
    { id: 'netTx', name: 'Rcvd Bytes', width: '13%', align: 'right' },
    { id: 'cpu', name: '% CPU', width: '10%', align: 'right' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'pid', name: 'PID', width: '8%', align: 'right' },
    { id: 'user', name: 'User', width: '8%', align: 'left' }
  ],
  gpu: [
    { id: 'command', name: 'Process Name', width: '42%', align: 'left' },
    { id: 'cpu', name: '% GPU/CPU', width: '16%', align: 'right' },
    { id: 'mem', name: '% Memory', width: '14%', align: 'right' },
    { id: 'threads', name: 'Threads', width: '10%', align: 'right' },
    { id: 'pid', name: 'PID', width: '8%', align: 'right' },
    { id: 'user', name: 'User', width: '10%', align: 'left' }
  ]
};

// Render Table Header
function renderTableHeader() {
  const thead = document.getElementById('proc-thead');
  const cols = tabColumns[currentTab] || tabColumns.cpu;
  const curSort = sortState[currentTab];

  let html = '<tr>';
  cols.forEach(c => {
    const isSorted = curSort.col === c.id;
    const caret = isSorted ? (curSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    html += \`<th style="width:\${c.width};text-align:\${c.align}" onclick="handleSort('\${c.id}')">\${escapeHtml(c.name)}<span class="sort-caret">\${caret}</span></th>\`;
  });
  html += '</tr>';
  thead.innerHTML = html;
}

// Sort Handler
function handleSort(colId) {
  const cur = sortState[currentTab];
  if (cur.col === colId) {
    cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
  } else {
    cur.col = colId;
    cur.dir = (colId === 'command' || colId === 'user') ? 'asc' : 'desc';
  }
  renderTableHeader();
  renderTableRows();
}

// Tab Switching
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.mac-seg-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.panel-content').forEach(el => {
    el.classList.toggle('active', el.id === 'panel-' + tab);
  });

  // Logs tab: show logs-view, hide proc-table; otherwise reverse
  const procTable = document.getElementById('proc-table');
  const logsView = document.getElementById('logs-view');
  const procFilter = document.getElementById('proc-filter');
  const searchWrap = document.querySelector('.mac-search-wrap');
  const btnStop = document.getElementById('btn-stop');
  const btnInspect = document.getElementById('btn-inspect');
  if (tab === 'logs') {
    if (procTable) procTable.style.display = 'none';
    if (logsView) logsView.style.display = 'flex';
    if (procFilter) procFilter.style.display = 'none';
    if (searchWrap) searchWrap.style.display = 'none';
    if (btnStop) btnStop.style.display = 'none';
    if (btnInspect) btnInspect.style.display = 'none';
    renderLogs();
    fetchLogHistory();
    syncRecordingStatus();
  } else {
    if (procTable) procTable.style.display = '';
    if (logsView) logsView.style.display = 'none';
    if (procFilter) procFilter.style.display = '';
    if (searchWrap) searchWrap.style.display = '';
    if (btnStop) btnStop.style.display = '';
    if (btnInspect) btnInspect.style.display = '';
    renderTableHeader();
    renderTableRows();
    updateBottomPanel();
    requestAnimationFrame(drawAllCanvases);
  }
}

// Process Filtering and Searching
function onFilterChange(val) {
  currentFilter = val;
  renderTableRows();
}

function onSearchInput(val) {
  searchQuery = (val || '').trim().toLowerCase();
  document.getElementById('search-clear').style.display = searchQuery ? 'flex' : 'none';
  renderTableRows();
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  onSearchInput('');
}

// Process Selection
function selectRow(pid) {
  selectedPid = pid;
  document.querySelectorAll('#proc-tbody tr').forEach(tr => {
    tr.classList.toggle('selected', Number(tr.dataset.pid) === pid);
  });
  const hasSel = selectedPid !== null;
  document.getElementById('btn-stop').disabled = !hasSel;
  document.getElementById('btn-inspect').disabled = !hasSel;
}

// Render Table Rows
function renderTableRows() {
  if (!latestData || !latestData.processes) return;
  const tbody = document.getElementById('proc-tbody');
  const cols = tabColumns[currentTab] || tabColumns.cpu;
  const sort = sortState[currentTab];
  const totalMem = latestData.memory?.total || 1;

  // Filter processes
  let procs = latestData.processes.map(p => {
    return {
      ...p,
      memBytes: (p.mem / 100) * totalMem,
      energyImpact: parseFloat(p.cpu.toFixed(1)),
      netRx: 0,
      netTx: 0
    };
  });

  if (currentFilter === 'my') {
    const myUser = latestData.header?.user || 'somalip';
    procs = procs.filter(p => p.user && p.user.toLowerCase().includes(myUser.toLowerCase()));
  } else if (currentFilter === 'active') {
    procs = procs.filter(p => p.cpu > 0.05 || p.mem > 0.2);
  } else if (currentFilter === 'system') {
    procs = procs.filter(p => p.user === 'root' || p.pid < 100);
  }

  if (searchQuery) {
    procs = procs.filter(p => {
      return p.command.toLowerCase().includes(searchQuery) ||
             String(p.pid).includes(searchQuery) ||
             (p.user && p.user.toLowerCase().includes(searchQuery));
    });
  }

  // Sort
  procs.sort((a, b) => {
    let va = a[sort.col];
    let vb = b[sort.col];
    if (typeof va === 'string') {
      va = va.toLowerCase();
      vb = (vb || '').toLowerCase();
    }
    if (va < vb) return sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  // Generate HTML
  let rowsHtml = '';
  procs.forEach(p => {
    const isSelected = p.pid === selectedPid;
    const isSys = p.user === 'root' || p.pid < 100;
    const initial = (p.command.replace(/^.*[\\\/]/, '')[0] || 'P').toUpperCase();

    rowsHtml += \`<tr class="\${isSelected ? 'selected' : ''}" data-pid="\${p.pid}" onclick="selectRow(\${p.pid})" ondblclick="openInspector(\${p.pid})">\`;

    cols.forEach(c => {
      if (c.id === 'command') {
        const shortName = p.command.replace(/^.*[\\\/]/, '');
        rowsHtml += \`<td class="col-name" title="\${escapeHtml(p.command)}">
          <span class="proc-icon \${isSys ? 'system' : 'user'}">\${initial}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;">\${escapeHtml(shortName)}</span>
        </td>\`;
      } else if (c.id === 'cpu') {
        rowsHtml += \`<td>\${p.cpu.toFixed(1)}</td>\`;
      } else if (c.id === 'runtime') {
        rowsHtml += \`<td>\${fmtTime(p.runtime)}</td>\`;
      } else if (c.id === 'mem') {
        rowsHtml += \`<td>\${p.mem.toFixed(1)}</td>\`;
      } else if (c.id === 'memBytes') {
        rowsHtml += \`<td>\${fmtBytes(p.memBytes)}</td>\`;
      } else if (c.id === 'energyImpact') {
        rowsHtml += \`<td>\${p.energyImpact.toFixed(1)}</td>\`;
      } else if (c.id === 'netRx') {
        rowsHtml += \`<td>\${fmtBytes(p.netRx)}</td>\`;
      } else if (c.id === 'netTx') {
        rowsHtml += \`<td>\${fmtBytes(p.netTx)}</td>\`;
      } else if (c.id === 'pid') {
        rowsHtml += \`<td>\${p.pid}</td>\`;
      } else if (c.id === 'threads') {
        rowsHtml += \`<td>\${p.threads || 1}</td>\`;
      } else if (c.id === 'state') {
        rowsHtml += \`<td style="text-align:center;">\${escapeHtml(p.state || 'R')}</td>\`;
      } else if (c.id === 'user') {
        rowsHtml += \`<td style="text-align:left;">\${escapeHtml(p.user || 'root')}</td>\`;
      } else {
        rowsHtml += \`<td>\${escapeHtml(p[c.id] || '–')}</td>\`;
      }
    });

    rowsHtml += '</tr>';
  });

  tbody.innerHTML = rowsHtml;
  document.getElementById('sb-count').textContent = procs.length + ' processes';
}

// Draw Area Charts on Canvas
function drawChart(canvasId, pointsA, colorA, pointsB = null, colorB = null, maxVal = 100) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  if (c.width !== Math.floor(rect.width * dpr) || c.height !== Math.floor(rect.height * dpr)) {
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
  }

  const W = c.width;
  const H = c.height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1 * dpr;
  [0.25, 0.5, 0.75].forEach(ratio => {
    ctx.beginPath();
    ctx.moveTo(0, H * ratio);
    ctx.lineTo(W, H * ratio);
    ctx.stroke();
  });

  if (!pointsA || !pointsA.length) return;

  const actualMax = maxVal || Math.max(...pointsA, ...(pointsB || []), 1);

  // Helper to render area + stroke
  function renderPath(pts, strokeCol, fillCol) {
    if (!pts || !pts.length) return;
    const step = W / (MAX_POINTS - 1);
    const startX = W - (pts.length - 1) * step;

    ctx.beginPath();
    ctx.moveTo(startX, H);
    pts.forEach((v, i) => {
      const x = startX + i * step;
      const y = Math.max(0, H - (v / actualMax) * H);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(W, H);
    ctx.fillStyle = fillCol;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = startX + i * step;
      const y = Math.max(0, H - (v / actualMax) * H);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }

  if (pointsB && pointsB.length && colorB) {
    renderPath(pointsB, colorB, colorB + '33');
  }
  renderPath(pointsA, colorA, colorA + '44');
}

function drawAllCanvases() {
  if (currentTab === 'cpu') {
    drawChart('canvas-cpu', historyData.cpuUser, '#007aff', historyData.cpuSystem, '#ff453a', 100);
  } else if (currentTab === 'memory') {
    const pressurePct = latestData?.memory?.usagePercent || 50;
    const col = pressurePct > 80 ? '#ff453a' : (pressurePct > 60 ? '#ff9f0a' : '#34c759');
    drawChart('canvas-mem', historyData.memPressure, col, null, null, 100);
  } else if (currentTab === 'energy') {
    const maxW = Math.max(10, ...historyData.energyWatts);
    drawChart('canvas-energy', historyData.energyWatts, '#ff9f0a', null, null, maxW);
  } else if (currentTab === 'disk') {
    const maxIO = Math.max(1, ...historyData.diskRead, ...historyData.diskWrite);
    drawChart('canvas-disk', historyData.diskRead, '#64d2ff', historyData.diskWrite, '#ff453a', maxIO);
  } else if (currentTab === 'network') {
    const maxNet = Math.max(1, ...historyData.netIn, ...historyData.netOut);
    drawChart('canvas-net', historyData.netIn, '#007aff', historyData.netOut, '#ff453a', maxNet);
  } else if (currentTab === 'gpu') {
    drawChart('canvas-gpu', historyData.gpuUtil, '#af52de', null, null, 100);
  }
}

// Update Bottom Panel Elements
function updateBottomPanel() {
  if (!latestData) return;
  const d = latestData;

  // CPU
  const totalCpu = d.cpu.usage || 0;
  const userCpu = totalCpu * 0.75;
  const sysCpu = totalCpu * 0.25;
  const idleCpu = Math.max(0, 100 - totalCpu);

  document.getElementById('cpu-stat-system').textContent = sysCpu.toFixed(1) + '%';
  document.getElementById('cpu-stat-user').textContent = userCpu.toFixed(1) + '%';
  document.getElementById('cpu-stat-idle').textContent = idleCpu.toFixed(1) + '%';
  
  const totalThreads = (d.processes || []).reduce((acc, p) => acc + (p.threads || 1), 0);
  document.getElementById('cpu-stat-threads').textContent = totalThreads.toLocaleString();
  document.getElementById('cpu-stat-procs').textContent = (d.processes || []).length;
  document.getElementById('cpu-stat-brand').textContent = (d.cpu.brand || 'Apple Silicon') + ' (' + (d.cpu.cores || 8) + ' cores)';

  // Memory
  const m = d.memory;
  document.getElementById('mem-stat-phys').textContent = fmtBytes(m.total);
  document.getElementById('mem-stat-used').textContent = fmtBytes(m.used);
  document.getElementById('mem-stat-wired').textContent = fmtBytes(m.wiredBytes || m.used * 0.22);
  document.getElementById('mem-stat-comp').textContent = fmtBytes(m.compressedBytes || 0);
  document.getElementById('mem-stat-cached').textContent = fmtBytes(Math.max(0, m.total - m.used - m.free));
  document.getElementById('mem-stat-swap').textContent = fmtBytes(m.swapUsed);
  document.getElementById('mem-stat-app').textContent = fmtBytes(Math.max(0, m.used - (m.wiredBytes || m.used * 0.22) - (m.compressedBytes || 0)));

  const pDot = document.getElementById('pressure-dot');
  const pTxt = document.getElementById('pressure-text');
  const pct = m.usagePercent || 0;
  if (pct > 80) {
    pDot.className = 'pressure-dot crit';
    pTxt.textContent = 'Critical (' + pct.toFixed(0) + '%)';
    pTxt.style.color = 'var(--mac-red)';
  } else if (pct > 65) {
    pDot.className = 'pressure-dot warn';
    pTxt.textContent = 'Warning (' + pct.toFixed(0) + '%)';
    pTxt.style.color = 'var(--mac-yellow)';
  } else {
    pDot.className = 'pressure-dot';
    pTxt.textContent = 'Normal';
    pTxt.style.color = 'var(--mac-green)';
  }

  // Energy
  const tw = d.power?.combinedWatts ?? (d.battery?.powerWatts || 0);
  document.getElementById('energy-stat-total').textContent = tw ? tw.toFixed(2) + ' W' : '–';
  document.getElementById('energy-stat-cpu').textContent = d.power?.cpuWatts != null ? d.power.cpuWatts.toFixed(2) + ' W' : '–';
  document.getElementById('energy-stat-gpu').textContent = d.power?.gpuWatts != null ? d.power.gpuWatts.toFixed(2) + ' W' : '–';

  if (d.battery) {
    document.getElementById('energy-stat-batt').textContent = d.battery.level + '% (' + d.battery.state + ')';
    document.getElementById('energy-stat-source').textContent = d.battery.powerSource || 'Battery';
    document.getElementById('energy-stat-timerem').textContent = d.battery.timeRemaining || 'Calculating…';
    document.getElementById('energy-stat-health').textContent = (d.battery.condition || 'Normal') + (d.battery.cycles ? ' · ' + d.battery.cycles + ' cycles' : '');
  } else {
    document.getElementById('energy-stat-batt').textContent = 'AC Power Only';
    document.getElementById('energy-stat-source').textContent = 'Power Adapter';
    document.getElementById('energy-stat-timerem').textContent = 'N/A';
    document.getElementById('energy-stat-health').textContent = 'Good';
  }

  // Disk
  const firstDisk = (d.disk && d.disk[0]) ? d.disk[0] : null;
  const dRead = firstDisk?.readBytesSec || 0;
  const dWrite = firstDisk?.writeBytesSec || 0;
  document.getElementById('disk-stat-reads').textContent = fmtBytes(dRead) + '/s';
  document.getElementById('disk-stat-writes').textContent = fmtBytes(dWrite) + '/s';
  document.getElementById('disk-stat-total-read').textContent = firstDisk?.used || '–';
  document.getElementById('disk-stat-total-write').textContent = firstDisk?.available || '–';

  // Disk Mounts bars
  const mountsBox = document.getElementById('disk-mounts-box');
  if (d.disk && d.disk.length) {
    mountsBox.innerHTML = d.disk.map(v => \`
      <div style="font-size:10px;">
        <div style="display:flex;justify-content:space-between;color:var(--text-secondary);">
          <span>\${escapeHtml(v.mountpoint || '/')}</span>
          <span>\${escapeHtml(v.used)} / \${escapeHtml(v.size)}</span>
        </div>
        <div class="disk-bar"><div class="disk-bar-fill" style="width:\${parseFloat(v.capacity)||50}%"></div></div>
      </div>
    \`).join('');
  }

  // Network
  document.getElementById('net-stat-pkts-in').textContent = (d.network.rxPacketsPerSec || Math.round(d.network.rxPackets / 1000) || 0).toLocaleString();
  document.getElementById('net-stat-pkts-out').textContent = (d.network.txPacketsPerSec || Math.round(d.network.txPackets / 1000) || 0).toLocaleString();
  document.getElementById('net-stat-rate-in').textContent = fmtBytes(d.network.rxRate || 0) + '/s';
  document.getElementById('net-stat-rate-out').textContent = fmtBytes(d.network.txRate || 0) + '/s';
  document.getElementById('net-stat-total-in').textContent = fmtBytes(d.network.rxBytes);
  document.getElementById('net-stat-total-out').textContent = fmtBytes(d.network.txBytes);
  document.getElementById('net-stat-iface').textContent = (d.network.interface || 'en0') + ' · ' + (d.network.ip || '127.0.0.1');

  // GPU
  if (d.gpu) {
    document.getElementById('gpu-stat-model').textContent = d.gpu.model || 'Integrated GPU';
    document.getElementById('gpu-stat-util').textContent = (d.gpu.utilization || 0).toFixed(1) + '%';
    document.getElementById('gpu-stat-vram').textContent = fmtBytes(d.gpu.memory || 0);
    document.getElementById('gpu-stat-procs').textContent = d.gpu.processes || 0;
    document.getElementById('gpu-stat-temp').textContent = d.gpu.temperature ? d.gpu.temperature + '°C' : '–';
  }
}

// Ingest Incoming Data Stream
let prevRx = null, prevTx = null;
function ingestStats(d) {
  latestData = d;

  const totalCpu = d.cpu.usage || 0;
  pushHistory(historyData.cpuUser, totalCpu * 0.75);
  pushHistory(historyData.cpuSystem, totalCpu * 0.25);
  pushHistory(historyData.memPressure, d.memory.usagePercent || 0);

  const tw = d.power?.combinedWatts ?? (d.battery?.powerWatts || 0);
  pushHistory(historyData.energyWatts, tw);

  const firstDisk = (d.disk && d.disk[0]) ? d.disk[0] : null;
  pushHistory(historyData.diskRead, firstDisk?.readBytesSec || 0);
  pushHistory(historyData.diskWrite, firstDisk?.writeBytesSec || 0);

  let rxRate = d.network.rxRate || 0;
  let txRate = d.network.txRate || 0;
  if (!rxRate && prevRx !== null) rxRate = Math.max(0, d.network.rxBytes - prevRx) / 2;
  if (!txRate && prevTx !== null) txRate = Math.max(0, d.network.txBytes - prevTx) / 2;
  prevRx = d.network.rxBytes; prevTx = d.network.txBytes;

  pushHistory(historyData.netIn, rxRate);
  pushHistory(historyData.netOut, txRate);
  pushHistory(historyData.gpuUtil, d.gpu?.utilization || 0);

  // Status Bar
  document.getElementById('sb-dot').className = 'sb-live-dot';
  document.getElementById('sb-status').textContent = 'Live';
  document.getElementById('sb-host').textContent = (d.header.hostname || 'Mac') + ' (' + (d.header.os || 'macOS') + ')';
  document.getElementById('sb-time').textContent = new Date().toLocaleTimeString();

  // Analyze telemetry for automatic log events
  analyzeAndLog(d);

  renderTableRows();
  updateBottomPanel();
  drawAllCanvases();
}

// Window Resize Hook
window.addEventListener('resize', () => {
  requestAnimationFrame(drawAllCanvases);
});

// Modal Management
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

// Quit Confirmation
function confirmQuitSelected() {
  if (selectedPid === null) return;
  const p = (latestData?.processes || []).find(x => x.pid === selectedPid);
  const name = p ? p.command.replace(/^.*[\\\/]/, '') : 'selected process';
  document.getElementById('quit-modal-desc').innerHTML = \`Are you sure you want to quit <b>\${escapeHtml(name)}</b> (PID \${selectedPid})?<br/><span style="font-size:11px;color:var(--text-tertiary);">Quitting may result in unsaved changes being lost.</span>\`;
  openModal('modal-quit');
}

function confirmQuitFromInspector() {
  closeModal('modal-inspector');
  confirmQuitSelected();
}

async function executeQuit(isForce) {
  if (selectedPid === null) return;
  const pidToKill = selectedPid;
  const sig = isForce ? 'SIGKILL' : 'SIGTERM';
  closeModal('modal-quit');

  try {
    const res = await fetch(\`/api/kill?pid=\${pidToKill}&signal=\${sig}\`);
    const data = await res.json();
    if (data.success) {
      showToast(\`Sent \${sig} to PID \${pidToKill}\`);
      const p = (latestData?.processes || []).find(x => x.pid === pidToKill);
      const pname = p ? p.command.replace(/^.*[\\\\/]/, '') : 'PID ' + pidToKill;
      addLogEntry('ACTION', 'PROCESS',
        \`Sent \${sig} to \${pname} (PID \${pidToKill})\`,
        isForce ? 'Force kill' : 'Graceful quit');
      selectedPid = null;
      document.getElementById('btn-stop').disabled = true;
      document.getElementById('btn-inspect').disabled = true;
    } else {
      addLogEntry('WARN', 'PROCESS',
        \`Failed to send \${sig} to PID \${pidToKill}\`,
        data.error || 'Unknown error');
      showToast('Error: ' + (data.error || 'Failed to kill process'));
    }
  } catch (e) {
    showToast('Network error: ' + e.message);
  }
}

// Process Inspector
function openInspector(pid) {
  selectRow(pid);
  const p = (latestData?.processes || []).find(x => x.pid === pid);
  if (!p) return;

  const shortName = p.command.replace(/^.*[\\\/]/, '');
  document.getElementById('inspect-title').textContent = \`\${shortName} (PID \${p.pid})\`;

  const totalMem = latestData.memory?.total || 1;
  const memBytes = (p.mem / 100) * totalMem;

  document.getElementById('inspect-body').innerHTML = \`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div class="proc-icon user" style="width:36px;height:36px;font-size:16px;border-radius:6px;">\${shortName[0]?.toUpperCase() || 'P'}</div>
      <div>
        <div style="font-size:14px;font-weight:700;">\${escapeHtml(shortName)}</div>
        <div style="font-size:11px;color:var(--text-secondary);word-break:break-all;">\${escapeHtml(p.command)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;font-size:12px;">
      <div class="stat-item"><span class="stat-k">Process ID:</span><span class="stat-v">\${p.pid}</span></div>
      <div class="stat-item"><span class="stat-k">Parent Process ID:</span><span class="stat-v">\${p.ppid || '1'}</span></div>
      <div class="stat-item"><span class="stat-k">User:</span><span class="stat-v">\${escapeHtml(p.user || 'root')}</span></div>
      <div class="stat-item"><span class="stat-k">State:</span><span class="stat-v">\${escapeHtml(p.state || 'R')}</span></div>
      <div class="stat-item"><span class="stat-k">% CPU Usage:</span><span class="stat-v">\${p.cpu.toFixed(1)}%</span></div>
      <div class="stat-item"><span class="stat-k">CPU Runtime:</span><span class="stat-v">\${fmtTime(p.runtime)}</span></div>
      <div class="stat-item"><span class="stat-k">Memory:</span><span class="stat-v">\${fmtBytes(memBytes)} (\${p.mem.toFixed(1)}%)</span></div>
      <div class="stat-item"><span class="stat-k">Threads:</span><span class="stat-v">\${p.threads || 1}</span></div>
    </div>
  \`;

  openModal('modal-inspector');
}

function openInspectorSelected() {
  if (selectedPid !== null) openInspector(selectedPid);
}

// ═══════════════════ SETTINGS & PREFERENCES ═══════════════════

let currentConfig = {};

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      currentConfig = await res.json();
      applyConfigToUI(currentConfig);
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function applyConfigToUI(cfg) {
  if (!cfg) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };
  const setChecked = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.checked = !!val;
  };

  setVal('set-interval', cfg.interval || cfg.telemetryInterval || '2');
  setVal('set-filter', cfg.defaultFilter || 'all');
  setVal('set-sort', cfg.defaultSort || 'cpu');
  setChecked('set-compact', cfg.compact);
  setChecked('set-ontop', cfg.alwaysOnTop);
  setChecked('set-lan', cfg.exposeLan);
  setVal('set-port', cfg.port || 3000);
  setVal('set-history-len', cfg.historyDuration || '60');
  setChecked('set-show-graphs', cfg.showGraphs !== false);
  setVal('set-density', cfg.tableDensity || 'standard');
  if (cfg.tableDensity) onDensityChange(cfg.tableDensity, false);

  setVal('set-cpu-alert', cfg.cpuAlertPct ?? 90);
  setVal('set-temp-alert', cfg.tempAlertC ?? 95);
  setVal('set-watchdog-proc', cfg.watchdogProcess || '');
  setVal('set-watchdog-mem', cfg.watchdogMem ?? 80);
  setVal('set-slack-url', cfg.slackAlertUrl || '');
  setVal('set-discord-url', cfg.discordAlertUrl || '');
  setVal('set-ntfy-url', cfg.ntfyUrl || '');

  // Apply default filter to live state if filter is currently 'all'
  if (cfg.defaultFilter && currentFilter === 'all') {
    const filterSelect = document.getElementById('filter-select');
    if (filterSelect) {
      filterSelect.value = cfg.defaultFilter;
      currentFilter = cfg.defaultFilter;
    }
  }
}

async function fetchServiceStatus() {
  try {
    const pill = document.getElementById('svc-status-pill');
    if (pill) {
      pill.className = 'status-pill inactive';
      pill.textContent = 'Checking…';
    }
    const res = await fetch('/api/service/status');
    if (res.ok) {
      const s = await res.json();
      const chk = document.getElementById('set-autostart');
      if (chk) chk.checked = !!s.installed;
      if (pill) {
        if (s.installed) {
          pill.className = 'status-pill active';
          pill.textContent = 'Active (' + (s.platform === 'darwin' ? 'LaunchAgent loaded' : 'systemd active') + ')';
        } else {
          pill.className = 'status-pill inactive';
          pill.textContent = 'Inactive (Not installed)';
        }
      }
      const lbl = document.getElementById('svc-label');
      if (lbl && s.serviceLabel) lbl.textContent = s.serviceLabel;
      const pth = document.getElementById('svc-path');
      if (pth && s.path) pth.textContent = s.path;
      const logEl = document.getElementById('svc-log');
      if (logEl && s.logPath) logEl.textContent = s.logPath;
    }
  } catch (err) {
    console.error('Failed to get service status:', err);
  }
}

function updateSysInfoInSettings() {
  const container = document.getElementById('diag-sys-info');
  if (!container) return;
  const sys = latestData?.system;
  if (!sys) {
    container.innerHTML = '<div>System information waiting for initial telemetry frame…</div>';
    return;
  }
  container.innerHTML = \`
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">Operating System:</span><span>\${escapeHtml(sys.platform || 'macOS')} (\${escapeHtml(sys.osRelease || '')})</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">Hardware Architecture:</span><span>\${escapeHtml(sys.arch || 'arm64')}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">Processor Model:</span><span>\${escapeHtml(latestData.cpu?.model || 'Apple Silicon')}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">Physical / Logical Cores:</span><span>\${latestData.cpu?.physicalCores || latestData.cpu?.cores || 8} cores</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">Installed Memory:</span><span>\${fmtBytes(latestData.memory?.total || 0)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:var(--text-secondary);">System Uptime:</span><span>\${fmtUptime(sys.uptime || 0)}</span></div>
  \`;
}

function openSettingsModal() {
  openModal('modal-settings');
  loadConfig();
  fetchServiceStatus();
  updateSysInfoInSettings();
}

function closeSettingsModal() {
  closeModal('modal-settings');
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.stab === tabName);
  });
  document.querySelectorAll('.settings-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === 'spane-' + tabName);
  });
  if (tabName === 'diagnostics') {
    updateSysInfoInSettings();
  }
}

async function onSettingChange() {
  const getNum = (id, def) => {
    const el = document.getElementById(id);
    const n = parseFloat(el?.value);
    return isNaN(n) ? def : n;
  };
  const getStr = (id, def = '') => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : def;
  };
  const getBool = (id, def = false) => {
    const el = document.getElementById(id);
    return el ? el.checked : def;
  };

  const patch = {
    interval: getNum('set-interval', 2),
    defaultFilter: getStr('set-filter', 'all'),
    defaultSort: getStr('set-sort', 'cpu'),
    compact: getBool('set-compact', false),
    alwaysOnTop: getBool('set-ontop', false),
    exposeLan: getBool('set-lan', false),
    port: Math.round(getNum('set-port', 3000)),
    historyDuration: Math.round(getNum('set-history-len', 60)),
    showGraphs: getBool('set-show-graphs', true),
    cpuAlertPct: getNum('set-cpu-alert', 90),
    tempAlertC: getNum('set-temp-alert', 95),
    watchdogProcess: getStr('set-watchdog-proc', ''),
    watchdogMem: getNum('set-watchdog-mem', 80),
    slackAlertUrl: getStr('set-slack-url', ''),
    discordAlertUrl: getStr('set-discord-url', ''),
    ntfyUrl: getStr('set-ntfy-url', '')
  };

  // Adjust graph buffer size if historyDuration changed
  if (patch.historyDuration && patch.interval) {
    MAX_POINTS = Math.max(20, Math.round(patch.historyDuration / patch.interval));
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (res.ok) {
      const data = await res.json();
      currentConfig = data.config || patch;
      const hint = document.getElementById('settings-status-hint');
      if (hint) {
        hint.textContent = 'Saved to ~/.config/pyre/config.json • ' + new Date().toLocaleTimeString();
        hint.style.color = 'var(--mac-green)';
        setTimeout(() => {
          hint.style.color = 'var(--text-tertiary)';
          hint.textContent = 'Preferences saved to ~/.config/pyre/config.json';
        }, 3000);
      }
    }
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

function onDensityChange(density, save = true) {
  const table = document.getElementById('proc-table');
  if (table) {
    table.classList.remove('density-compact', 'density-standard', 'density-comfortable');
    table.classList.add('density-' + density);
  }
  if (save) {
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableDensity: density })
    }).catch(console.error);
    showToast('Table density: ' + density.charAt(0).toUpperCase() + density.slice(1));
  }
}

async function toggleAutostartFromUI(enabled) {
  const pill = document.getElementById('svc-status-pill');
  if (pill) {
    pill.textContent = 'Updating service…';
    pill.className = 'status-pill';
  }
  try {
    const res = await fetch('/api/service/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || (enabled ? 'Service enabled' : 'Service disabled'));
      addLogEntry('ACTION', 'SYSTEM', 'Background service ' + (enabled ? 'enabled' : 'disabled'), data.message);
      fetchServiceStatus();
    } else {
      showToast('Error: ' + (data.error || 'Failed to modify service'));
      const chk = document.getElementById('set-autostart');
      if (chk) chk.checked = !enabled;
      fetchServiceStatus();
    }
  } catch (err) {
    showToast('Failed to contact Pyre server');
    const chk = document.getElementById('set-autostart');
    if (chk) chk.checked = !enabled;
    fetchServiceStatus();
  }
}

async function sendTestAlertFromUI() {
  showToast('Dispatching test notification…');
  try {
    const res = await fetch('/api/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Pyre Activity Monitor: Test notification triggered from Web Dashboard' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Notification dispatched');
      addLogEntry('WATCHDOG', 'SYSTEM', 'Test notification sent', data.message);
    } else {
      showToast('Alert test failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    showToast('Failed to dispatch test notification');
  }
}

async function runDoctorFromUI() {
  const btn = document.getElementById('btn-run-doctor');
  const resEl = document.getElementById('doctor-results');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Running…';
  }
  if (resEl) {
    resEl.style.display = 'block';
    resEl.textContent = 'Running system diagnostic checks…\\nScanning kernel metrics, thermal sensors, battery, launchd daemons, network interfaces…';
  }

  try {
    const res = await fetch('/api/doctor');
    const data = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Run Diagnostics';
    }
    if (resEl) {
      if (data.success && data.report) {
        let out = '✓ System Diagnostics Complete\\n';
        out += 'Timestamp: ' + (data.report.timestamp || new Date().toISOString()) + '\\n';
        out += 'Overall Status: ' + (data.report.status || 'HEALTHY').toUpperCase() + '\\n\\n';
        if (Array.isArray(data.report.checks)) {
          for (const c of data.report.checks) {
            const sym = c.ok ? '  ✓ ' : '  ✗ ';
            out += sym + c.name + (c.detail ? ': ' + c.detail : '') + '\\n';
          }
        }
        resEl.textContent = out;
        addLogEntry('INFO', 'SYSTEM', 'Diagnostics completed', data.report.status || 'OK');
      } else {
        resEl.textContent = 'Diagnostic run complete.\\n\\n' + JSON.stringify(data, null, 2);
      }
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Run Diagnostics';
    }
    if (resEl) {
      resEl.textContent = 'Error executing diagnostics: ' + err.message;
    }
  }
}

async function resetConfigFromUI() {
  if (!confirm('Are you sure you want to reset all preferences to factory defaults?')) {
    return;
  }
  try {
    const res = await fetch('/api/config/reset', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Preferences reset to factory defaults');
      addLogEntry('ACTION', 'UI', 'Preferences reset to factory defaults');
      loadConfig();
    } else {
      showToast('Error resetting preferences: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    showToast('Failed to reset preferences');
  }
}

// Keyboard Navigation
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('modal-quit');
    closeModal('modal-inspector');
    closeSettingsModal();
    return;
  }

  // Cmd+, or , (when not in an input/select/textarea) opens preferences
  if ((e.key === ',' && (e.metaKey || e.ctrlKey)) ||
      (e.key === ',' && !document.activeElement.matches('input, select, textarea'))) {
    e.preventDefault();
    openSettingsModal();
    return;
  }

  // If focused in search, don't hijack keys
  if (document.activeElement === document.getElementById('search-input') ||
      document.activeElement === document.getElementById('log-search-input')) {
    return;
  }

  // Segmented shortcuts 1-7
  const keyTabs = { '1': 'cpu', '2': 'memory', '3': 'energy', '4': 'disk', '5': 'network', '6': 'gpu', '7': 'logs' };
  if (keyTabs[e.key]) {
    switchTab(keyTabs[e.key]);
    return;
  }

  // r = toggle recording
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    toggleWebRecording();
    return;
  }

  // l = focus log search (when on logs tab)
  if (e.key === 'l' && currentTab === 'logs') {
    e.preventDefault();
    const ls = document.getElementById('log-search-input');
    if (ls) { ls.focus(); ls.select(); }
    return;
  }

  // Table arrow navigation
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && latestData?.processes?.length) {
    e.preventDefault();
    const rows = Array.from(document.querySelectorAll('#proc-tbody tr'));
    if (!rows.length) return;
    const curIdx = rows.findIndex(tr => Number(tr.dataset.pid) === selectedPid);
    let nextIdx = curIdx;
    if (e.key === 'ArrowDown') nextIdx = curIdx < rows.length - 1 ? curIdx + 1 : 0;
    if (e.key === 'ArrowUp') nextIdx = curIdx > 0 ? curIdx - 1 : rows.length - 1;
    const nextPid = Number(rows[nextIdx].dataset.pid);
    selectRow(nextPid);
    rows[nextIdx].scrollIntoView({ block: 'nearest' });
    return;
  }

  // Enter or Space opens inspector
  if ((e.key === 'Enter' || e.key === ' ') && selectedPid !== null) {
    e.preventDefault();
    openInspectorSelected();
    return;
  }

  // Delete or Backspace prompts quit
  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedPid !== null) {
    e.preventDefault();
    confirmQuitSelected();
    return;
  }

  // Cmd+F or / focuses search
  if ((e.key === 'f' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
    e.preventDefault();
    const s = document.getElementById('search-input');
    s.focus();
    s.select();
  }
});

// ═══════════════════ LOGGING & RECORDING ═══════════════════

const MAX_LOG_ENTRIES = 500;

function addLogEntry(level, subsys, msg, ctx) {
  const entry = {
    ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 }),
    level,    // 'INFO','WARN','CRIT','ACTION','WATCHDOG'
    subsys,   // 'CPU','MEM','DISK','NET','THERMAL','PROCESS','SYSTEM','LOGGER','UI'
    msg,
    ctx: ctx || '',
    raw: { level, subsys, msg, ctx, ts: new Date().toISOString() }
  };
  logsBuffer.unshift(entry);
  if (logsBuffer.length > MAX_LOG_ENTRIES) logsBuffer.pop();
  if (currentTab === 'logs') renderLogs();
}

function fmtSizeB(b) {
  if (!b) return '0 B';
  if (b > 1e9) return (b/1e9).toFixed(1) + ' GB';
  if (b > 1e6) return (b/1e6).toFixed(1) + ' MB';
  if (b > 1e3) return (b/1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function renderLogs() {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  const visible = logsBuffer.filter(e => {
    if (logFilterLevel !== 'all' && e.level !== logFilterLevel) return false;
    if (logFilterSubsys !== 'all' && e.subsys !== logFilterSubsys) return false;
    if (logSearchQuery && !e.msg.toLowerCase().includes(logSearchQuery) && !e.ctx.toLowerCase().includes(logSearchQuery)) return false;
    return true;
  });

  tbody.innerHTML = visible.map(e => {
    const badgeCls = e.level.toLowerCase();
    return \`<tr>
      <td class="log-ctx">\${escapeHtml(e.ts)}</td>
      <td><span class="log-badge \${badgeCls}">\${escapeHtml(e.level)}</span></td>
      <td class="log-subsys">\${escapeHtml(e.subsys)}</td>
      <td class="log-msg">\${escapeHtml(e.msg)}</td>
      <td style="text-align:right;" class="log-ctx">\${escapeHtml(e.ctx)}</td>
    </tr>\`;
  }).join('');

  if (autoScrollLogs && visible.length) {
    const area = document.getElementById('logs-scroll-area');
    if (area) area.scrollTop = 0;
  }
}

function onLogLevelFilterChange(val) {
  logFilterLevel = val;
  renderLogs();
}

function onLogSubsysFilterChange(val) {
  logFilterSubsys = val;
  renderLogs();
}

function onLogSearchInput(val) {
  logSearchQuery = (val || '').toLowerCase();
  renderLogs();
}

function toggleAutoScroll() {
  autoScrollLogs = !autoScrollLogs;
  const btn = document.getElementById('btn-autoscroll');
  if (btn) {
    btn.textContent = 'Auto-scroll: ' + (autoScrollLogs ? 'ON' : 'OFF');
    btn.style.color = autoScrollLogs ? 'var(--mac-green)' : 'var(--text-secondary)';
  }
}

function clearLogs() {
  logsBuffer = [];
  renderLogs();
  showToast('Event log cleared');
}

function downloadLogsExport() {
  const json = JSON.stringify(logsBuffer.map(e => e.raw), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pyre-ui-events-' + new Date().toISOString().slice(0,19).replace(/:/g,'-') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Analyze incoming telemetry and emit structured log events
function analyzeAndLog(d) {
  if (!hasLoggedInit) {
    hasLoggedInit = true;
    addLogEntry('INFO', 'SYSTEM', 'Pyre-UI connected — live telemetry streaming started',
      (d.header?.hostname || 'unknown') + ' · ' + (d.header?.os || 'macOS'));
  }

  const now = Date.now();
  const cpu = d.cpu?.usage || 0;
  const mem = d.memory?.usagePercent || 0;
  const thermalState = d.thermal?.state || 'Nominal';

  // CPU spike detection (>70% WARN, >90% CRIT), per-process
  if (d.processes) {
    d.processes.forEach(p => {
      if (!p || !p.pid) return;
      const lastSpike = lastCpuSpikeTimes[p.pid] || 0;
      if (p.cpu > 90 && now - lastSpike > 30000) {
        lastCpuSpikeTimes[p.pid] = now;
        addLogEntry('CRIT', 'CPU',
          \`Critical CPU usage: \${p.command.replace(/^.*[\\\\/]/,'')} (PID \${p.pid}) at \${p.cpu.toFixed(1)}%\`,
          \`Threads: \${p.threads || 1} · User: \${p.user || 'root'}\`);
      } else if (p.cpu > 70 && now - lastSpike > 60000) {
        lastCpuSpikeTimes[p.pid] = now;
        addLogEntry('WARN', 'CPU',
          \`High CPU usage: \${p.command.replace(/^.*[\\\\/]/,'')} (PID \${p.pid}) at \${p.cpu.toFixed(1)}%\`,
          \`Threads: \${p.threads || 1}\`);
      }
    });
  }

  // System-wide CPU
  if (cpu > 90) {
    addLogEntry('CRIT', 'CPU', \`System CPU at \${cpu.toFixed(1)}% — critical load\`, '');
  } else if (cpu > 75) {
    addLogEntry('WARN', 'CPU', \`System CPU elevated at \${cpu.toFixed(1)}%\`, '');
  }

  // Memory pressure
  if (mem > 85 && now - lastHighMemAlert > 60000) {
    lastHighMemAlert = now;
    addLogEntry('CRIT', 'MEM', \`Memory pressure critical: \${mem.toFixed(0)}% used\`,
      'Total: ' + fmtSizeB(d.memory?.total) + ' · Swap: ' + fmtSizeB(d.memory?.swapUsed));
  } else if (mem > 70 && now - lastHighMemAlert > 120000) {
    lastHighMemAlert = now;
    addLogEntry('WARN', 'MEM', \`Memory usage high: \${mem.toFixed(0)}%\`, 'Swap: ' + fmtSizeB(d.memory?.swapUsed));
  }

  // Thermal state transitions
  if (prevThermalState !== null && prevThermalState !== thermalState) {
    const level = thermalState === 'Critical' ? 'CRIT' : thermalState === 'Nominal' ? 'INFO' : 'WARN';
    addLogEntry(level, 'THERMAL',
      \`Thermal state changed: \${prevThermalState} → \${thermalState}\`,
      \`CPU temp: \${d.cpu?.temperature ? d.cpu.temperature + '°C' : '–'}\`);
  }
  prevThermalState = thermalState;

  // Network burst detection
  const rxRate = d.network?.rxRate || 0;
  const txRate = d.network?.txRate || 0;
  if ((rxRate > 50*1024*1024 || txRate > 50*1024*1024) && now - lastNetBurstAlert > 30000) {
    lastNetBurstAlert = now;
    addLogEntry('WARN', 'NET',
      \`Network burst: ↓\${fmtSizeB(rxRate)}/s ↑\${fmtSizeB(txRate)}/s\`,
      \`Interface: \${d.network?.interface || 'en0'}\`);
  }
}

// ═══════════════════ RECORDING CONTROLS ═══════════════════

async function toggleWebRecording() {
  try {
    if (isRecording) {
      const res = await fetch('/api/logging/stop');
      const data = await res.json();
      isRecording = false;
      updateRecordingUI(false);
      addLogEntry('INFO', 'LOGGER',
        \`Session recording stopped: \${data.samples} samples in \${data.durationSec}s\`,
        data.file || '');
      showToast(\`Recording stopped — \${data.samples} samples saved\`);
    } else {
      const res = await fetch('/api/logging/start');
      const data = await res.json();
      isRecording = true;
      updateRecordingUI(true, data.file);
      addLogEntry('INFO', 'LOGGER', 'Session recording started', data.file || '');
      showToast('Recording started → ' + (data.file || './pyre-exports/'));
    }
    if (currentTab === 'logs') fetchLogHistory();
  } catch (e) {
    showToast('Recording error: ' + e.message);
  }
}

function updateRecordingUI(recording, filename) {
  const btn = document.getElementById('btn-record');
  const label = document.getElementById('rec-label');
  const panelBtn = document.getElementById('btn-panel-rec');
  const badge = document.getElementById('logs-rec-badge');

  if (btn) btn.classList.toggle('recording', recording);
  if (label) label.textContent = recording ? 'Stop REC' : 'Record';
  if (panelBtn) panelBtn.textContent = recording ? 'Stop Recording' : 'Start Recording';
  if (badge) {
    badge.textContent = recording ? 'REC' : 'IDLE';
    badge.className = 'log-badge ' + (recording ? 'crit' : 'info');
  }
}

async function syncRecordingStatus() {
  try {
    const res = await fetch('/api/logging/status');
    const data = await res.json();
    isRecording = data.recording;
    updateRecordingUI(data.recording, data.file);

    const statStatus = document.getElementById('rec-stat-status');
    const statFile = document.getElementById('rec-stat-file');
    const statSamples = document.getElementById('rec-stat-samples');
    const statDuration = document.getElementById('rec-stat-duration');
    const statDir = document.getElementById('rec-stat-dir');
    if (statStatus) statStatus.textContent = data.recording ? 'Recording…' : 'Idle';
    if (statFile) statFile.textContent = data.file || '–';
    if (statSamples) statSamples.textContent = data.samples;
    if (statDuration) statDuration.textContent = data.durationSec + 's';
    if (statDir) statDir.textContent = data.exportDir;
  } catch { /* ignore */ }
}

async function fetchLogHistory() {
  try {
    const res = await fetch('/api/logging/history');
    const data = await res.json();
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    if (!data.files || !data.files.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-tertiary);text-align:center;padding:12px;">No CSV logs found in ' + escapeHtml(data.exportDir) + '. Click Record to start a session.</td></tr>';
      return;
    }
    tbody.innerHTML = data.files.map(f => {
      const kb = (f.sizeBytes / 1024).toFixed(1);
      const mtime = f.mtime ? new Date(f.mtime).toLocaleString() : '–';
      return \`<tr>
        <td style="font-family:var(--font-mono);font-size:10px;">\${escapeHtml(f.name)}</td>
        <td>\${kb} KB</td>
        <td>\${mtime}</td>
        <td><a class="history-link" href="/api/logging/download?file=\${encodeURIComponent(f.name)}" download="\${escapeHtml(f.name)}">↓ Download</a></td>
      </tr>\`;
    }).join('');
  } catch { /* ignore */ }
}

// ═══════════════════ EXPORT DROPDOWN ═══════════════════

function toggleExportMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.toggle('show');
}

document.addEventListener('click', () => {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('show');
});

function downloadSnapshot(fmt) {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('show');
  const url = '/api/export?format=' + fmt;
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pyre-snapshot.' + fmt;
  a.click();
  showToast('Exporting snapshot as ' + fmt.toUpperCase() + '…');
  addLogEntry('ACTION', 'UI', 'User exported snapshot', 'format: ' + fmt);
}

// SSE Connection
let eventSource = null;
function initSSE() {
  try {
    eventSource = new EventSource('/api/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        ingestStats(data);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };
    eventSource.onerror = () => {
      document.getElementById('sb-dot').className = 'sb-live-dot offline';
      document.getElementById('sb-status').textContent = 'Reconnecting';
    };
  } catch (err) {
    console.error('SSE error:', err);
  }
}

// Fallback Polling (also handles window.__pyreUpdate from Cocoa WebView)
window.__pyreUpdate = function(jsonStr) {
  try {
    const d = JSON.parse(jsonStr);
    ingestStats(d);
  } catch (e) {
    console.error('pyreUpdate parse error:', e);
  }
};

async function pollFallback() {
  try {
    const res = await fetch('/api/stats', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      ingestStats(data);
    }
  } catch (err) {
    document.getElementById('sb-dot').className = 'sb-live-dot offline';
    document.getElementById('sb-status').textContent = 'Offline';
  }
}

// Initialize
renderTableHeader();
initSSE();
pollFallback();
syncRecordingStatus();
loadConfig();
setInterval(() => {
  if (!latestData || document.getElementById('sb-status').textContent === 'Offline') {
    pollFallback();
  }
}, 3000);
// Periodically sync recording status & update panel stats
setInterval(() => {
  if (currentTab === 'logs' && isRecording) {
    syncRecordingStatus();
  }
}, 5000);
</script>
</body>
</html>`;
}

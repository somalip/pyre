/**
 * Live dashboard rendering.
 *
 * Contains the main `render` loop, the footer key-bindings
 * line, the UI customizer overlay, and the thermal/CPU
 * alert checker.  All state variables are imported from
 * `state.ts`.
 */
import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { formatTable, formatGraphs, gridColumns, THEMES, type ThemeName, panel, fitVisible, visLen, styleSelectedRow, stampOverlay, render3DSprite, SPRITE_3D_MODES } from '../formatters/index.js';
import { detectAnomalies } from '../anomalies.js';
import { state, setStatus, SIGNAL_OPTIONS, getToggleKey, MENU_OPTIONS } from './state.js';
import type { StatsData } from '../monitors/index.js';
import { sendAlert, type AlertChannelConfig } from '../alertChannels.js';
import { readConfig } from '../state/config.js';
import { AVAILABLE_AI_MODELS } from '../ai/models.js';

function formatTempForUnit(c: number): string {
  if (state.tempUnit === 'f') {
    const f = c * (9 / 5) + 32;
    return `${f.toFixed(1)}°F`;
  }
  return `${c.toFixed(1)}°C`;
}

function applyTempUnit(text: string): string {
  if (state.tempUnit === 'f') {
    return text.replace(/([\d.]+)°C \/ ([\d.]+)°F/g, '$2°F');
  }
  return text.replace(/([\d.]+)°C \/ ([\d.]+)°F/g, '$1°C');
}

// --- render caching -----------------------------------------------------------

let _cachedTable = '';
let _cachedTableData: StatsData | null = null;
let _cachedTableParams = '';
let _tableDataDirty = false;

function invalidateTableCache() {
  _tableDataDirty = true;
}

let _cachedGraphs = '';
let _cachedGraphsVersion = -1;
let _cachedGraphsParams = '';

function tableCacheParams(): string {
   const limit = processRowBudget();
   return [
     state.termWidth,
     state.termHeight,
     state.sortMode,
     state.sortReverse ? 'asc' : 'desc',
     state.processFilter || '',
     state.processSelectionIndex,
     state.trackedPid || '',
     state.trackedPidHistory.cpu.length,
     state.inspectingProcess ? state.inspectingProcess.pid : '',
     limit,
     state.currentTheme,
     state.activePanel,
     state.treeView ? '1' : '0',
     state.showGraphs ? '1' : '0',
     state.history.version,
     JSON.stringify(state.visiblePanels),
     JSON.stringify(state.panelLayout),
     state.aiModel,
     state.graphZoomLevel,
     state.animFrame,
     state.sprite3dMode,
     JSON.stringify(state.panelHistory.slice(-5)),
     JSON.stringify(state.bookmarks.map(b => b.name)),
   ].join('|');
  }

function graphsCacheParams(): string {
  return [
    state.termWidth,
    state.currentTheme,
    state.graphMode,
  ].join('|');
}

function processRowBudget(): number {
  if (state.activePanel === 'process') {
    return Math.max(8, state.termHeight - 8);
  }
  return Math.max(6, state.termHeight - 12);
}

function p2pPanelLines(): { title: string; body: string[] } {
  const events = state.p2pServer ? state.p2pServer.peerEventHistory : state.p2pEvents;
  const body: string[] = [];
  const bindAddr = state.p2pBind || `0.0.0.0:${state.p2pPort}`;

  body.push(`Status:   ${state.p2pServerRunning ? chalk.green('Running') : chalk.red('Stopped')}`);
  body.push(`Bind:     ${bindAddr}`);
  body.push(`Password: ${state.p2pPassword}`);
  body.push('');

  const typeColor = (t: string) => {
    if (t === 'auth') return chalk.green;
    if (t === 'disconnect') return chalk.yellow;
    if (t === 'error' || t === 'blocked' || t === 'rate_limited') return chalk.red;
    return chalk.cyan;
  };
  body.push(chalk.dim('Events (most recent):'));
  const recent = events.slice(-20).reverse();
  for (const evt of recent) {
    const time = new Date(evt.ts).toLocaleTimeString();
    body.push(`${chalk.dim(time)} ${typeColor(evt.type)(evt.type.padEnd(14))} ${evt.detail}`);
  }

  const title = `R p2p · ${state.p2pServerRunning ? 'ON' : 'OFF'} · ${events.length} events`;
  return { title, body };
}

function renderCustomizerOverlay(scrollOffset: number, maxVisibleItems: number): string {
  const themesList = Object.keys(THEMES) as ThemeName[];
  const totalItems = state.CUSTOMIZER_OPTIONS.length;
  const end = Math.min(scrollOffset + maxVisibleItems, totalItems);
  const lines: string[] = [
    chalk.hex('#94a3b8')('↑/↓ or J/K navigate · Enter/Space toggle · Esc close'),
    '',
  ];

  for (let i = scrollOffset; i < end; i++) {
    const opt = state.CUSTOMIZER_OPTIONS[i];
    const isSelected = i === state.customizerIndex;
    const prefix = isSelected ? chalk.hex('#ff6b35').bold('❯ ') : '  ';
    const labelStr = (isSelected ? chalk.bold.hex('#f8fafc') : chalk.hex('#cbd5e1'))(opt.padEnd(20));

    let valStr = '';
    if (opt === 'Theme') {
      valStr = `${chalk.bold.hex('#10b981')(state.currentTheme)} ${chalk.dim(`[${themesList.join(', ')}]`)}`;
    } else if (opt === '3D Sprite') {
      valStr = `${chalk.bold.hex('#38bdf8')(state.sprite3dMode.toUpperCase())} ${chalk.dim(`[${SPRITE_3D_MODES.join(', ')}]`)}`;
    } else if (opt === 'Graph Mode') {
      valStr = `${chalk.bold.hex('#10b981')(state.graphMode)} ${chalk.dim('[spark, bar]')}`;
    } else if (opt === 'Splash Screen') {
      valStr = state.splashEnabled ? chalk.hex('#10b981').bold('● ON') : chalk.hex('#64748b')('○ OFF');
    } else if (opt === 'Splash Color') {
      valStr = `${chalk.bold.hex('#10b981')(state.splashColorScheme)} ${chalk.dim('[fire, ocean, forest, purple]')}`;
    } else if (opt === 'Splash Animation') {
      valStr = `${chalk.bold.hex('#10b981')(state.splashAnimation)} ${chalk.dim('[classic, wave, sparks]')}`;
    } else if (opt === 'Notifications') {
      valStr = state.notificationsEnabled ? chalk.hex('#10b981').bold('● ON') : chalk.hex('#64748b')('○ OFF');
    } else if (opt === 'Temperature Unit') {
      valStr = `${chalk.bold.hex('#10b981')(state.tempUnit.toUpperCase())} ${chalk.dim('[C, F]')}`;
    } else if (opt === 'AI Model') {
      const curModel = AVAILABLE_AI_MODELS.find(m => m.id === state.aiModel) || AVAILABLE_AI_MODELS[0];
      valStr = `${chalk.bold.hex('#06b6d4')(curModel.name)} ${chalk.dim(`[${curModel.badge}]`)}`;
    } else if (opt === 'Grid Panel Order') {
      valStr = chalk.bold.hex('#10b981')(state.panelLayout.join(' → '));
    } else {
      const toggleKey = getToggleKey(opt);
      const isVisible = toggleKey ? (toggleKey === 'tree' ? state.treeView : state.visiblePanels[toggleKey] !== false) : true;
      valStr = isVisible ? chalk.hex('#10b981').bold('● VISIBLE') : chalk.hex('#64748b')('○ HIDDEN');
    }

    lines.push(`${prefix}${labelStr} ${valStr}`);
  }

  return lines.join('\n');
}

function buildModalBox(title: string, rawLines: string[], modalW: number, accent: (s: string) => string): string[] {
  const innerW = Math.max(10, modalW - 4);
  const bgLines = rawLines.map(l => styleSelectedRow(l, innerW, '15;23;42'));
  const box = panel(title, bgLines, modalW, accent, chalk.hex('#38bdf8'), bgLines.length, 'Esc close');
  return box.map(l => styleSelectedRow(l, modalW, '15;23;42'));
}

function renderQuickRefLines(): string[] {
  const categories: [string, [string, string][]][] = [
    ['Navigation', [
      ['1-9, 0', 'CPU / Mem / GPU / Pwr / Bat / Thm / Net / Conns / Tasks / Disk'],
      ['L / P / C', 'Listening Ports (L) · Processes (P) · Containers (C)'],
      ['A / B / R', 'Anomalies (A) · Blender (B) · P2P Server (R)'],
      ['Tab / Esc', 'Cycle tabs forward/back · Return to main btop grid'],
    ]],
    ['Process Controls', [
      ['↑/↓, PgUp/Dn', 'Select process row (Home / End for top / bottom)'],
      ['s / v (or I)', 'Cycle sort column (s) · Invert sort direction ▲/▼ (v)'],
      ['/ (or f)', 'Filter processes by substring'],
      ['Space / Enter', 'Follow selected PID (live sparkline) · Inspect PID'],
      ['k / S / n', 'Kill PID (k) · Send signal (S) · Renice priority -20..19 (n)'],
    ]],
    ['View & System', [
      ['t / g / b', 'Toggle process tree (t) · Graphs (g) · Spark/Bar mode (b)'],
      ['c / m / T', 'UI Customizer (c) · AI Engine (m) · Temp unit C/F (T)'],
      ['e / l / p', 'Export snapshot (e) · CSV logging (l) · Pause/Resume (p)'],
      [': / o / q', 'Command Palette (:) · Main Menu (o) · Quit (q)'],
    ]],
  ];

  const lines: string[] = [];
  for (const [category, items] of categories) {
    lines.push(chalk.bold.hex('#38bdf8')(`◆ ${category}`));
    for (const [key, desc] of items) {
      lines.push(`  ${chalk.hex('#ffaa40').bold(key.padEnd(14))} ${chalk.hex('#cbd5e1')(desc)}`);
    }
    lines.push('');
  }
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function renderCommandPaletteLines(maxRows: number): string[] {
  const cmds = state.paletteFilteredCommands;
  const filterLine = `${chalk.bgHex('#9333ea').white.bold(' ⌕ ')} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#c084fc')('█')} ${chalk.hex('#64748b')(`(${cmds.length} commands)`)}`;
  const lines: string[] = [filterLine, ''];

  if (cmds.length === 0) {
    lines.push(chalk.hex('#94a3b8')('  No matching commands found.'));
    return lines;
  }

  const listBudget = Math.max(4, maxRows - 3);
  const start = Math.max(0, Math.min(state.paletteIndex - Math.floor(listBudget / 2), Math.max(0, cmds.length - listBudget)));
  const end = Math.min(cmds.length, start + listBudget);

  for (let i = start; i < end; i++) {
    const cmd = cmds[i];
    const isSelected = i === state.paletteIndex;
    const prefix = isSelected ? chalk.hex('#ff6b35').bold('❯ ') : '  ';
    const keyPill = chalk.hex('#ffaa40')(`[${cmd.keys}]`.padEnd(9));
    const catPill = chalk.hex('#64748b')(`${cmd.category}`.padEnd(10));
    const label = isSelected ? chalk.bold.hex('#f8fafc')(cmd.label) : chalk.hex('#cbd5e1')(cmd.label);
    lines.push(`${prefix}${keyPill} ${catPill} ${label}`);
  }
  return lines;
}

function renderBookmarkSaveLines(): string[] {
  return [
    chalk.hex('#cbd5e1')('Save current panel, sort mode, filter, and theme as a quick bookmark:'),
    '',
    `  ${chalk.hex('#f59e0b').bold('Name:')} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#fbbf24')('█')}`,
    '',
    chalk.hex('#64748b')('Press Enter to save · Esc to cancel'),
  ];
}

// --- frame diffing -------------------------------------------------------
let _prevFrameLines: string[] = [];
let _frameDirty = true;

function invalidateFrame() {
  _frameDirty = true;
}

function writeFrame(lines: string[]) {
  if (_frameDirty || _prevFrameLines.length === 0 || lines.length !== _prevFrameLines.length) {
    process.stdout.write('\x1b[?25l\x1b[H' + lines.map(l => `\x1b[2K${l}`).join('\r\n') + '\x1b[0J');
    _prevFrameLines = lines;
    _frameDirty = false;
    return;
  }

  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== _prevFrameLines[i]) {
      out += `\x1b[${i + 1};1H\x1b[2K${lines[i]}`;
    }
  }
  if (out) process.stdout.write(out);
  _prevFrameLines = lines;
}

function render() {
  if (!state.lastData) return;
  const rows = state.termHeight || 24;
  const cols = state.termWidth || 80;
  if (cols < 50 || rows < 15) {
    const msg = chalk.yellow(`pyre ${rows}x${cols} too small. Resize terminal to >= 50x18.`);
    const centered = Math.max(0, Math.floor((rows - 2) / 2));
    const out: string[] = [];
    for (let i = 0; i < centered; i++) out.push('');
    out.push(fitVisible(msg, cols));
    while (out.length < rows) out.push('');
    writeFrame(out);
    return;
  }

  if (state.inputMode === 'menu') {
    writeFrame(renderSplashMenu(cols, rows));
    return;
  }
  if (state.inputMode === 'readme') {
    writeFrame(renderReadme(cols, rows));
    return;
  }
  if (state.inputMode === 'credits') {
    writeFrame(renderCredits(cols, rows));
    return;
  }
  if (state.inputMode === 'docker-alert') {
    writeFrame(renderDockerAlert(cols, rows));
    return;
  }
  if (state.inputMode === 'ai-model') {
    writeFrame(renderAiModelSelector(cols, rows));
    return;
  }

  const theme = THEMES[state.currentTheme] || THEMES.default;
  const footerHeight = 2;
  const targetBodyHeight = Math.max(12, rows - footerHeight);

  const params = tableCacheParams();
  const anomalies = detectAnomalies(state.lastData, state.history);
  if (anomalies.length > 0) {
    for (const a of anomalies) {
      const now = new Date();
      const alertWithTime = { ...a, timestamp: now };
      const exists = state.anomalyHistory.some(
        h => h.metric === a.metric && Math.abs(h.zScore - a.zScore) < 0.1 && (now.getTime() - (h.timestamp?.getTime() || 0)) < 10000
      );
      if (!exists) {
        state.anomalyHistory.unshift(alertWithTime);
      }
    }
    if (state.anomalyHistory.length > 100) {
      state.anomalyHistory.length = 100;
    }
  }
  const anomalyCacheKey = anomalies.map(a => `${a.metric}:${a.zScore.toFixed(2)}`).join(',');
  const cacheParams = params + '|' + anomalyCacheKey + '|' + state.anomalyHistory.length;
  const tableStr = _tableDataDirty || state.lastData !== _cachedTableData || cacheParams !== _cachedTableParams
    ? (() => {
        const out = formatTable(state.lastData, {
          width: cols,
          height: targetBodyHeight,
          showGraphs: state.showGraphs,
          sortBy: state.sortMode,
          sortReverse: state.sortReverse,
          filter: state.processFilter || undefined,
          processLimit: processRowBudget(),
          theme: state.currentTheme,
          visible: state.visiblePanels,
          treeView: state.treeView,
          activePanel: state.activePanel,
          anomalies: anomalies,
          anomalyHistory: state.anomalyHistory,
          tempUnit: state.tempUnit,
          history: state.history,
          graphMode: state.graphMode,
          panelLayout: state.panelLayout,
          selectedProcessIndex: state.processSelectionIndex,
          trackedPid: state.trackedPid,
          trackedPidHistory: state.trackedPid ? state.trackedPidHistory : undefined,
          inspectProcess: state.inspectingProcess,
          aiModel: state.aiModel,
          animFrame: state.animFrame,
          sprite3dMode: state.sprite3dMode,
        });
        _cachedTableData = state.lastData;
        _cachedTableParams = cacheParams;
        _cachedTable = applyTempUnit(out);
        _tableDataDirty = false;
        return _cachedTable;
      })()
    : _cachedTable;

  const bodyLines: string[] = [];
  if (state.activePanel === 'p2p') {
    const panelLines = p2pPanelLines();
    bodyLines.push(...panel(panelLines.title, panelLines.body, cols, theme.process, theme.border, Math.max(6, targetBodyHeight - 2)));
  } else {
    bodyLines.push(...tableStr.split('\n'));
  }

  // In single-panel detail views (non-grid), append standalone history graphs if toggled on and space permits
  if (state.showGraphs && state.activePanel !== 'grid' && state.activePanel !== 'p2p' && state.activePanel !== 'process') {
    const graphsParams = graphsCacheParams();
    const graphsStr =
      state.history.version !== _cachedGraphsVersion || graphsParams !== _cachedGraphsParams
        ? (() => {
            const out = formatGraphs(state.history, cols, state.currentTheme, state.graphMode);
            _cachedGraphsVersion = state.history.version;
            _cachedGraphsParams = graphsParams;
            _cachedGraphs = applyTempUnit(out);
            return _cachedGraphs;
          })()
        : _cachedGraphs;
    const gLines = graphsStr.split('\n');
    if (bodyLines.length + gLines.length <= targetBodyHeight) {
      bodyLines.push(...gLines);
    }
  }

  if (bodyLines.length > targetBodyHeight) {
    bodyLines.length = targetBodyHeight;
  }
  const frameLines = [...bodyLines];
  while (frameLines.length < targetBodyHeight) {
    frameLines.push('');
  }

  // Stamp centered framed modals over the dashboard body when active
  if (state.inputMode === 'customizer') {
    const modalW = Math.min(cols - 4, 68);
    const maxItems = Math.max(6, Math.min(state.CUSTOMIZER_OPTIONS.length, targetBodyHeight - 6));
    const scrollOffset = state.CUSTOMIZER_OPTIONS.length > maxItems
      ? Math.max(0, Math.min(state.customizerIndex - Math.floor(maxItems / 2), state.CUSTOMIZER_OPTIONS.length - maxItems))
      : 0;
    const rawLines = renderCustomizerOverlay(scrollOffset, maxItems).split('\n');
    const box = buildModalBox('⬢ UI CUSTOMIZER', rawLines, modalW, chalk.hex('#38bdf8'));
    stampOverlay(frameLines, box, cols, targetBodyHeight);
  } else if (state.inputMode === 'quick-ref') {
    const modalW = Math.min(cols - 4, 76);
    const rawLines = renderQuickRefLines().slice(0, Math.max(8, targetBodyHeight - 4));
    const box = buildModalBox('? KEYBOARD SHORTCUTS', rawLines, modalW, chalk.hex('#10b981'));
    stampOverlay(frameLines, box, cols, targetBodyHeight);
  } else if (state.inputMode === 'command-palette') {
    const modalW = Math.min(cols - 4, 72);
    const rawLines = renderCommandPaletteLines(Math.max(6, targetBodyHeight - 4));
    const box = buildModalBox('✦ COMMAND PALETTE', rawLines, modalW, chalk.hex('#c084fc'));
    stampOverlay(frameLines, box, cols, targetBodyHeight);
  } else if (state.inputMode === 'bookmark-save') {
    const modalW = Math.min(cols - 4, 64);
    const rawLines = renderBookmarkSaveLines();
    const box = buildModalBox('★ SAVE BOOKMARK', rawLines, modalW, chalk.hex('#f59e0b'));
    stampOverlay(frameLines, box, cols, targetBodyHeight);
  }

  const fLines = footerLine();
  frameLines.push(fLines[0] || '');
  frameLines.push(fLines[1] || '');

  const fittedLines = frameLines.map(l => fitVisible(l, cols));
  writeFrame(fittedLines);
}

function footerLine(): string[] {
  const cols = state.termWidth || 80;

  // --- Row 1: Interactive Input Prompt OR Status Message OR Clean Status Strip ---
  let statusRow = '';
  if (state.inputMode === 'filter') {
    statusRow = `${chalk.bgHex('#0284c7').black.bold(' FILTER ')} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#38bdf8')('█')}  ${chalk.hex('#94a3b8')('(Type process name · Enter apply · Esc clear)')}`;
  } else if (state.inputMode === 'kill') {
    statusRow = `${chalk.bgHex('#e11d48').white.bold(' KILL PID ')} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#f43f5e')('█')}  ${chalk.hex('#94a3b8')('(Enter to send SIGTERM · Esc cancel)')}`;
  } else if (state.inputMode === 'renice') {
    statusRow = `${chalk.bgHex('#d97706').black.bold(` RENICE PID ${state.targetPid || '?'} `)} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#fbbf24')('█')}  ${chalk.hex('#94a3b8')('(Priority -20 to 19 · Enter apply · Esc cancel)')}`;
  } else if (state.inputMode === 'signal') {
    if (!state.targetPid) {
      statusRow = `${chalk.bgHex('#9333ea').white.bold(' SIGNAL PID ')} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#c084fc')('█')}  ${chalk.hex('#94a3b8')('(Enter PID first · Esc cancel)')}`;
    } else {
      const sigIdx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
      const sigPills = state.SIGNAL_OPTIONS.map((s, i) =>
        i === sigIdx ? chalk.bgHex('#eab308').black.bold(` ${s} `) : chalk.hex('#94a3b8')(` ${s} `)
      ).join(' ');
      statusRow = `${chalk.bgHex('#9333ea').white.bold(` PID ${state.targetPid} `)} ${sigPills}  ${chalk.hex('#64748b')('(↑/↓ choose · Enter send · Esc cancel)')}`;
    }
  } else if (state.inputMode === 'p2p') {
    statusRow = `${chalk.bgHex('#10b981').black.bold(` P2P (:${state.p2pPort}) `)} ${chalk.bold.hex('#f8fafc')(state.inputBuffer)}${chalk.hex('#34d399')('█')}  ${chalk.hex('#94a3b8')('(Enter password to start · Esc cancel)')}`;
  } else if (state.statusMessage) {
    statusRow = ` ${chalk.bgHex('#1e293b').hex('#38bdf8').bold(' STATUS ')} ${state.statusMessage}`;
  } else {
    const badges: string[] = [];
    const viewLabel = state.activePanel === 'grid' ? 'GRID' : state.activePanel.toUpperCase();
    badges.push(chalk.hex('#38bdf8').bold(`◆ ${viewLabel}`));
    if (state.paused) badges.push(chalk.bgHex('#854d0e').hex('#fef08a').bold(' PAUSED '));
    if (state.logging) badges.push(chalk.bgHex('#881337').hex('#fecdd3').bold(' ● REC '));
    if (state.processFilter) badges.push(chalk.bgHex('#0369a1').hex('#e0f2fe').bold(` "${state.processFilter}" `));
    if (state.trackedPid) badges.push(chalk.bgHex('#4c1d95').hex('#ede9fe').bold(` PID ${state.trackedPid} `));
    if (state.p2pServerRunning) badges.push(chalk.bgHex('#14532d').hex('#bbf7d0').bold(` P2P :${state.p2pPort} `));

    const metaRight: string[] = [
      `${chalk.hex('#64748b')('sort:')} ${chalk.hex('#ffaa40').bold(state.sortMode + (state.sortReverse ? '▲' : '▼'))}`,
      `${chalk.hex('#64748b')('poll:')} ${chalk.hex('#cbd5e1')(`${state.interval}s`)}`,
      `${chalk.hex('#64748b')('theme:')} ${chalk.hex('#cbd5e1')(state.currentTheme)}`,
    ];
    if (state.bookmarks.length > 0) metaRight.push(chalk.hex('#38bdf8')(`★${state.bookmarks.length}`));

    const leftStr = ' ' + badges.join('  ');
    const rightStr = metaRight.join(chalk.hex('#334155')(' · ')) + ' ';
    const gap = Math.max(1, cols - visLen(leftStr) - visLen(rightStr));
    statusRow = leftStr + ' '.repeat(gap) + rightStr;
  }

  // --- Row 2: Clean Minimal Keybinding Hint Bar ---
  const keys: [string, string][] = [
    ['q', 'quit'],
    ['y', '3D'],
    ['o', 'menu'],
    ['1-0/L/P', 'panels'],
    ['/', 'filter'],
    ['s/v', 'sort'],
    ['Space', 'follow'],
    ['k', 'kill'],
    ['t', state.treeView ? 'flat' : 'tree'],
    ['c', 'style'],
    [':', 'cmd'],
    ['?', 'help'],
  ];

  const sep = chalk.hex('#334155')(' · ');
  const sepW = 3;
  let usedW = 1;
  const keyItems: string[] = [];
  for (const [k, label] of keys) {
    const item = `${chalk.hex('#ffaa40').bold(k)} ${chalk.hex('#94a3b8')(label)}`;
    const itemW = visLen(item) + (keyItems.length > 0 ? sepW : 0);
    if (usedW + itemW > cols - 1 && keyItems.length > 0) break;
    keyItems.push(item);
    usedW += itemW;
  }
  const keyRow = styleSelectedRow(' ' + keyItems.join(sep), cols, '15;23;42');

  return [fitVisible(statusRow, cols), keyRow];
}

function sendNotification(title: string, message: string) {
  if (!state.notificationsEnabled) return;
  execFile('osascript', ['-e', `display notification "${message}" with title "${title}"`], (err) => {
    if (err) {
      // Silently ignore notification failures (e.g., terminal not in focus, no notification permission)
    }
  });
}

function checkAlerts(data: StatsData) {
   const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? null;
   const hot = data.cpu.usage >= state.CPU_ALERT_PCT || (temp !== null && temp >= state.TEMP_ALERT_C);
   const anomalies = detectAnomalies(data, state.history);
   
   // Add timestamp to anomalies and push to history
   for (const a of anomalies) {
     const timestamped = { ...a, timestamp: new Date() };
     // Only add if not already recently reported (same metric and similar zScore)
     const recent = state.anomalyHistory.slice(-5);
     const isDuplicate = recent.some(r => r.metric === a.metric && Math.abs(r.zScore - a.zScore) < 0.5);
     if (!isDuplicate) {
       state.anomalyHistory.push(timestamped as any);
       if (state.anomalyHistory.length > 50) state.anomalyHistory.shift();
     }
   }

   const hasCriticalAnomaly = anomalies.some(a => a.severity === 'critical');
   const hasWarningAnomaly = anomalies.some(a => a.severity === 'warning');
   // Process watchdog check
   let watchdogTriggered = false;
   if (state.watchdogProcess) {
     const matches = data.processes.filter(p => p.command.toLowerCase().includes(state.watchdogProcess.toLowerCase()));
     for (const p of matches) {
       if (p.cpu >= state.watchdogCpu || p.mem >= state.watchdogMem) {
         watchdogTriggered = true;
         break;
       }
     }
   }

   const anomalyTriggered = hasCriticalAnomaly || hasWarningAnomaly;

   if ((hot || anomalyTriggered || watchdogTriggered) && !state.alerted) {
     state.alerted = true;
     process.stdout.write('\x07');
     const reasons: string[] = [];
     if (data.cpu.usage >= state.CPU_ALERT_PCT) reasons.push(`CPU at ${data.cpu.usage}%`);
     if (temp !== null && temp >= state.TEMP_ALERT_C) reasons.push(`Temp at ${formatTempForUnit(temp)}`);
     if (watchdogTriggered) reasons.push(`Watchdog process "${state.watchdogProcess}" crossed threshold`);
     for (const a of anomalies) {
       reasons.push(`${a.metric} anomaly (σ=${a.zScore.toFixed(1)})`);
     }
      setStatus(chalk.red(`[ALERT] ${reasons.join('; ')}`), 5000);
      sendNotification('pyre Alert', reasons.join('; '));
      
      const alertMsg = reasons.join('; ');
      if (state.webhookUrl) {
        fetch(state.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alert: alertMsg, timestamp: new Date().toISOString() })
        }).catch(() => {});
      }
      if (state.alertCmd) {
        exec(state.alertCmd, { env: { ...process.env, PYRE_ALERT: alertMsg } }, () => {});
      }

      // Multi-channel alert fan-out (Slack, Discord, Pushover, ntfy)
      const cfg = readConfig();
      const channelConfig: AlertChannelConfig = {
        slackUrl: cfg.slackAlertUrl || undefined,
        discordUrl: cfg.discordAlertUrl || undefined,
        pushoverToken: cfg.pushoverToken || undefined,
        pushoverUser: cfg.pushoverUser || undefined,
        ntfyUrl: cfg.ntfyUrl || undefined,
      };
      const hasChannels = Object.values(channelConfig).some(v => !!v);
      if (hasChannels) {
        const severity = hasCriticalAnomaly ? 'critical' : 'warning';
        sendAlert({
          metric: reasons[0]?.split(' ')[0] ?? 'System',
          value: data.cpu.usage,
          threshold: state.CPU_ALERT_PCT,
          unit: '%',
          host: data.header.hostname,
          timestamp: new Date().toISOString(),
          severity,
        }, channelConfig).catch(() => {});
      }
    } else if (!hot && !anomalyTriggered && !watchdogTriggered) {
     state.alerted = false;
   }
  }

function renderSplashMenu(cols: number, rows: number): string[] {
  const out: string[] = [];
  const contentLines: string[] = [];
  const logo = [
    chalk.hex('#ff3b00').bold('██████╗ ██╗   ██╗██████╗ ███████╗'),
    chalk.hex('#ff6b00').bold('██╔══██╗╚██╗ ██╔╝██╔══██╗██╔════╝'),
    chalk.hex('#ff8800').bold('██████╔╝ ╚████╔╝ ██████╔╝█████╗  '),
    chalk.hex('#ffaa00').bold('██╔═══╝   ╚██╔╝  ██╔══██╗██╔══╝  '),
    chalk.hex('#ffc800').bold('██║        ██║   ██║  ██║███████╗'),
    chalk.hex('#ffe040').bold('╚═╝        ╚═╝   ╚═╝  ╚═╝╚══════╝')
  ];

  const menuTop = Math.max(0, Math.floor((rows - (logo.length + MENU_OPTIONS.length + 7)) / 2));
  for (let i = 0; i < menuTop; i++) out.push(' '.repeat(cols));

  for (const line of logo) contentLines.push(line);
  contentLines.push('');
  contentLines.push(chalk.hex('#475569')('◢▓◤ ') + chalk.bold.hex('#ff8800')('3D SYSTEM MONITOR & HARDWARE FORGE') + chalk.hex('#475569')(' ◥▓◣'));
  contentLines.push(chalk.hex('#64748b')('v10.9.0 · 3D Holo-Telemetry · Command Center'));
  contentLines.push('');

  const leftSprite = render3DSprite('ignis', 18, MENU_OPTIONS.length, state.animFrame, {
    cpuUsage: state.lastData?.cpu.usage ?? 25,
    memUsage: state.lastData?.memory.usagePercent ?? 50,
  });
  const rightSprite = render3DSprite('torus', 18, MENU_OPTIONS.length, state.animFrame, {
    cpuUsage: state.lastData?.cpu.usage ?? 25,
    memUsage: state.lastData?.memory.usagePercent ?? 50,
  });

  const btnInnerW = Math.max(30, ...MENU_OPTIONS.map((o) => o.length + 4));
  for (let i = 0; i < MENU_OPTIONS.length; i++) {
    const isSelected = i === state.menuSelectionIndex;
    const opt = MENU_OPTIONS[i];
    const label = `  ${opt}`.padEnd(btnInnerW, ' ');
    const prefix = isSelected ? chalk.hex('#ff6b35').bold('❯ ') : '  ';
    const text = isSelected
      ? chalk.bgHex('#ff5500').black.bold(label)
      : chalk.bgHex('#1e293b').hex('#cbd5e1')(label);
    const btnRow = prefix + text + '  ';
    if (cols >= 76) {
      contentLines.push(`${leftSprite[i] || ' '.repeat(18)}   ${btnRow}   ${rightSprite[i] || ' '.repeat(18)}`);
    } else {
      contentLines.push(btnRow);
    }
  }

  contentLines.push('');
  contentLines.push(chalk.hex('#64748b')('[↑/↓] Navigate  ·  [Enter] Launch  ·  [y] Cycle 3D  ·  [q] Quit'));

  for (const line of contentLines) {
    const lineW = visLen(line);
    const leftPad = Math.max(0, Math.floor((cols - lineW) / 2));
    out.push(fitVisible(' '.repeat(leftPad) + line, cols));
  }
  while (out.length < rows) out.push(' '.repeat(cols));
  return out;
}

let cachedReadmeLines: string[] | null = null;

function getReadmeLines(): string[] {
  if (cachedReadmeLines) return cachedReadmeLines;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rootDir = path.resolve(__dirname, '..', '..');
    const readmePath = path.join(rootDir, 'README.md');
    const content = fs.readFileSync(readmePath, 'utf8');
    cachedReadmeLines = content.split('\n');
    return cachedReadmeLines;
  } catch (err) {
    return [chalk.red('Failed to load README.md')];
  }
}

function renderReadme(cols: number, rows: number): string[] {
  const lines = getReadmeLines();
  const availableLines = Math.max(1, rows - 2); // Body height of the panel
  
  const startIdx = Math.min(state.readmeScrollOffset, Math.max(0, lines.length - availableLines));
  state.readmeScrollOffset = startIdx; // Clamp the state value
  
  const content = lines.slice(startIdx, startIdx + availableLines).map(l => {
    let out = l;
    if (out.startsWith('#')) {
       out = chalk.cyan.bold(out);
    } else if (out.startsWith('```')) {
       out = chalk.dim(out);
    } else if (out.startsWith('- ') || out.startsWith('* ')) {
       out = '  ' + chalk.yellow(out.substring(0, 2)) + out.substring(2);
    }
    return out;
  });

  const out: string[] = [];
  const pct = Math.round((startIdx / Math.max(1, lines.length - availableLines)) * 100);
  const title = lines.length > availableLines 
    ? `README (${pct}%)` 
    : 'README';
  out.push(...panel(title, content, cols, chalk.cyan, chalk.dim, availableLines));
  return out;
}

function renderCredits(cols: number, rows: number): string[] {
  const out: string[] = [];
  const content = [
    chalk.bold.hex('#ff6004')('Pyre — System Monitor & Hardware Forge'),
    '',
    chalk.hex('#94a3b8')('Cross-platform high-performance telemetry dashboard'),
    '',
    chalk.hex('#06b6d4').bold('Core Telemetry & Architecture:'),
    '  • systeminformation   System metrics & hardware probe',
    '  • chalk               Terminal styling & color engine',
    '  • commander           CLI argument parsing & routing',
    '',
    chalk.dim('Press Esc or Enter to return to menu.')
  ];

  out.push(...panel('CREDITS', content, cols, chalk.hex('#ff6004'), chalk.dim, rows - 2));
  return out;
}

function renderDockerAlert(cols: number, rows: number): string[] {
  const out: string[] = [];
  const content = [
    chalk.bold.hex('#f43f5e')('⬢ Docker Container Environment Detected'),
    '',
    'Pyre is running inside an isolated container.',
    'Host hardware sensors (battery, thermal, power) may be restricted.',
    '',
    chalk.hex('#06b6d4')('Choose operating profile:'),
    ''
  ];
  
  const options = ['Docker Profile (optimized for containers)', 'Full TUI Profile (attempt all sensors)'];
  for (let i = 0; i < options.length; i++) {
    const isSelected = i === state.dockerSelectionIndex;
    const prefix = isSelected ? chalk.hex('#ff6b35').bold('  ❯ ') : '    ';
    const text = isSelected
      ? chalk.bgHex('#ff5500').black.bold(` ${options[i]} `)
      : chalk.bgHex('#1e293b').hex('#94a3b8')(` ${options[i]} `);
    content.push(prefix + text);
  }
  
  content.push('');
  content.push(chalk.dim('Press ↑/↓ or J/K to select · Enter to confirm · Esc to skip'));

  out.push(...panel('DOCKER ENVIRONMENT', content, cols, chalk.hex('#f43f5e'), chalk.dim, rows - 2));
  return out;
}

function renderAiModelSelector(cols: number, rows: number): string[] {
  const out: string[] = [];
  const content: string[] = [
    chalk.bold.hex('#ff6004')('Choose AI Anomaly Explanation Engine'),
    chalk.dim('Select your preferred diagnosis model. In-process models require zero external API calls.'),
    '',
  ];

  for (let i = 0; i < AVAILABLE_AI_MODELS.length; i++) {
    const m = AVAILABLE_AI_MODELS[i];
    const isSelected = i === state.modelSelectionIndex;
    const isCurrent = m.id === state.aiModel;
    const prefix = isSelected ? chalk.hex('#ff6b35').bold(' ❯ ') : '   ';
    const curBadge = isCurrent ? chalk.bgHex('#14532d').hex('#86efac').bold(' ACTIVE ') : '';
    const badgeStr = m.offline ? chalk.hex('#10b981')(`[${m.badge}]`) : chalk.hex('#f59e0b')(`[${m.badge}]`);

    const nameStr = isSelected
      ? chalk.bgHex('#ff5500').black.bold(` ${m.name} `)
      : chalk.bold.hex('#f1f5f9')(m.name);
    content.push(`${prefix}${nameStr} ${badgeStr} ${curBadge}`);
    content.push(chalk.dim(`     ${m.description}`));
    content.push('');
  }

  content.push(chalk.dim('Use ↑/↓ or J/K to navigate · Enter/Space to select · Esc to cancel'));

  out.push(...panel('AI MODEL SELECTOR', content, cols, chalk.hex('#06b6d4'), chalk.dim, Math.max(1, rows - 2)));
  return out;
}

export { render, footerLine, renderCustomizerOverlay, checkAlerts, processRowBudget, invalidateTableCache, invalidateFrame };
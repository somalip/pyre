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
import { formatTable, formatGraphs, gridColumns, THEMES, type ThemeName, panel, fitVisible, visLen } from '../formatters/index.js';
import { detectAnomalies } from '../anomalies.js';
import { state, setStatus, SIGNAL_OPTIONS, getToggleKey, MENU_OPTIONS } from './state.js';
import type { StatsData } from '../monitors/index.js';

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
    state.sortMode,
    state.processFilter || '',
    state.processSelectionIndex,
    state.trackedPid || '',
    state.inspectingProcess ? state.inspectingProcess.pid : '',
    limit,
    state.currentTheme,
    state.activePanel,
    state.treeView ? '1' : '0',
    state.history.version,
    JSON.stringify(state.visiblePanels),
    JSON.stringify(state.panelLayout),
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
  let overlayRows = 0;
  if (state.inputMode === 'signal') overlayRows = 6;
  else if (state.inputMode === 'filter' || state.inputMode === 'kill' || state.inputMode === 'p2p') overlayRows = 3;

  if (state.activePanel === 'process') {
    return Math.max(10, state.termHeight - 12 - overlayRows);
  }

  const reserved = 16 + overlayRows;
  return Math.max(4, state.termHeight - reserved);
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

  const title = `P2P · ${state.p2pServerRunning ? 'ON' : 'OFF'} · ${events.length} events`;
  return { title, body };
}

function renderCustomizerOverlay(scrollOffset: number, maxVisibleItems: number): string {
    const themesList = Object.keys(THEMES) as ThemeName[];
    const headerLine = chalk.bgCyan.black.bold(' UI CUSTOMIZER (Use ↑/↓ or J/K to navigate, Enter/Space to toggle, Esc to exit) ');
    const totalItems = state.CUSTOMIZER_OPTIONS.length;
    const end = Math.min(scrollOffset + maxVisibleItems, totalItems);

    const lines = [headerLine];

    for (let i = scrollOffset; i < end; i++) {
      const opt = state.CUSTOMIZER_OPTIONS[i];
      const isSelected = i === state.customizerIndex;
      const prefix = isSelected ? chalk.yellow('▶ ') : '  ';

       if (opt === 'Theme') {
         lines.push(`${prefix}${opt}: ${chalk.bold.green(state.currentTheme)} [${themesList.join(', ')}]`);
       } else if (opt === 'Graph Mode') {
         lines.push(`${prefix}${opt}: ${chalk.bold.green(state.graphMode)} [spark, bar]`);
       } else if (opt === 'Splash Screen') {
         const status = state.splashEnabled ? chalk.green('[ON]') : chalk.red('[OFF]');
         lines.push(`${prefix}${opt}: ${status}`);
       } else if (opt === 'Splash Color') {
         lines.push(`${prefix}${opt}: ${chalk.bold.green(state.splashColorScheme)} [fire, ocean, forest, purple, monochrome]`);
       } else if (opt === 'Splash Animation') {
         lines.push(`${prefix}${opt}: ${chalk.bold.green(state.splashAnimation)} [classic, wave, sparks]`);
       } else if (opt === 'Notifications') {
         const status = state.notificationsEnabled ? chalk.green('[ON]') : chalk.red('[OFF]');
         lines.push(`${prefix}${opt}: ${status}`);
       } else if (opt === 'Temperature Unit') {
         lines.push(`${prefix}${opt}: ${chalk.bold.green(state.tempUnit.toUpperCase())} [C, F]`);
       } else {
         const toggleKey = getToggleKey(opt);
         const isVisible = toggleKey ? (toggleKey === 'tree' ? state.treeView : state.visiblePanels[toggleKey] !== false) : true;
         const status = isVisible ? chalk.green('[VISIBLE]') : chalk.red('[HIDDEN]');
         lines.push(`${prefix}${opt}: ${status}`);
       }
    }

   return lines.map(l => `  ${l}`).join('\n');
  }

// --- frame diffing -------------------------------------------------------
// Instead of erasing the whole screen (`\x1b[2J`) and repainting everything
// on every keypress/tick, we keep the previous frame's lines around and
// only move the cursor + rewrite the lines that actually changed. A full
// erase forces a scrollback/display invalidation in many terminals
// (iTerm2, Windows Terminal, tmux, various SSH clients), which is what
// made menu navigation and tab switches feel like they took a second or
// two even though the underlying data was already cached.
let _prevFrameLines: string[] = [];
let _frameDirty = true; // force full paint on first render / resize

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

  // Incremental repaint: move to each changed line and rewrite only
  // that line, clearing to end-of-line first so shorter replacement
  // text doesn't leave stale characters behind.
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
    const msg = chalk.yellow(`pyre ${rows}x${cols} too small. Resize terminal to >= 50x20.`);
    const centered = Math.max(0, Math.floor((rows - 2) / 2));
    const out: string[] = [];
    for (let i = 0; i < centered; i++) out.push('');
    out.push(msg.padEnd(cols));
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
  const lines: string[] = [];
  const theme = THEMES[state.currentTheme] || THEMES.default;

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
            width: state.termWidth,
            sortBy: state.sortMode,
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
            inspectProcess: state.inspectingProcess,
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
    bodyLines.push(...panel(panelLines.title, panelLines.body, state.termWidth, theme.process, theme.border));
  } else {
    bodyLines.push(...tableStr.split('\n'));
  }

  const graphsParams = graphsCacheParams();
  const graphsStr =
    state.history.version !== _cachedGraphsVersion || graphsParams !== _cachedGraphsParams
      ? (() => {
          const out = formatGraphs(state.history, state.termWidth, state.currentTheme, state.graphMode);
          _cachedGraphsVersion = state.history.version;
          _cachedGraphsParams = graphsParams;
          _cachedGraphs = applyTempUnit(out);
          return _cachedGraphs;
        })()
      : _cachedGraphs;

  if (state.showGraphs && state.activePanel !== 'p2p') {
    bodyLines.push('');
    bodyLines.push(...graphsStr.split('\n'));
  }

  const footerLine1 = footerLine()[0] || '';
  const footerLine2 = footerLine()[1] || '';
  const footerLine3 = footerLine()[2] || ' ';
  const footerLines = [footerLine1, footerLine2, footerLine3];

  const footerHeight = 3;
  const targetBodyHeight = Math.max(1, state.termHeight - footerHeight);

  if (state.inputMode === 'customizer') {
    const totalItems = state.CUSTOMIZER_OPTIONS.length;
    const headerLines = 1;  // the "UI CUSTOMIZER" header
    const blankLines = 1;   // blank separator line
    // Reserve a fixed height for the customizer: show all items if they fit,
    // otherwise guarantee at least 10 visible items (or half the screen).
    const idealOverlayHeight = totalItems + headerLines + blankLines;
    const minOverlayHeight = Math.min(10 + headerLines + blankLines, Math.floor(targetBodyHeight / 2));
    const overlayHeight = Math.min(idealOverlayHeight, Math.max(minOverlayHeight, Math.floor(targetBodyHeight * 0.6)));
    // Truncate table body to make room for the customizer overlay
    const maxBodyForTable = Math.max(3, targetBodyHeight - overlayHeight);
    if (bodyLines.length > maxBodyForTable) {
      bodyLines.length = maxBodyForTable;
    }
    const availableForOverlay = targetBodyHeight - bodyLines.length;
    const maxVisibleItems = Math.max(1, availableForOverlay - headerLines - blankLines);
    const scrollOffset = totalItems > maxVisibleItems
      ? Math.max(0, Math.min(state.customizerIndex, totalItems - maxVisibleItems))
      : 0;

    bodyLines.push('');
    bodyLines.push(...renderCustomizerOverlay(scrollOffset, maxVisibleItems).split('\n'));
  } else if (state.inputMode === 'filter') {
    bodyLines.push(chalk.cyan(`  Filter processes: ${state.inputBuffer}_`));
  } else if (state.inputMode === 'kill') {
    bodyLines.push(chalk.cyan(`  Kill PID: ${state.inputBuffer}_  (enter to confirm, esc to cancel)`));
  } else if (state.inputMode === 'signal') {
    const sigIdx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
    const sigList = state.SIGNAL_OPTIONS.map((s, i) => i === sigIdx ? chalk.yellow(s) : chalk.dim(s)).join('  ');
    bodyLines.push(chalk.cyan(`  Signal: ${state.inputBuffer}_`));
    bodyLines.push(chalk.dim(`  ${sigList}`));
    bodyLines.push(chalk.dim('  ↑/↓ to select, Enter to confirm, Esc to cancel'));
  } else if (state.inputMode === 'p2p') {
    bodyLines.push(chalk.cyan(`  P2P password (${state.p2pPort}): ${state.inputBuffer}_  (enter to start, esc to cancel)`));
  } else if (state.statusMessage) {
    bodyLines.push(`  ${state.statusMessage}`);
  }

  if (bodyLines.length > targetBodyHeight) {
    bodyLines.length = targetBodyHeight;
  }
  const frameLines = [...bodyLines];
  while (frameLines.length < targetBodyHeight) {
    frameLines.push('');
  }
  frameLines.push(...footerLines);
  const fittedLines = frameLines.map(l => fitVisible(l, cols));
  writeFrame(fittedLines);
}

function footerLine(): string[] {
   const row1: [string, string][] = [
      ['q', 'quit'],
      ['c', 'customize UI'],
      ['←/→', 'tab'],
      ['1-9', 'panels'],
      ['g', state.showGraphs ? 'hide graphs' : 'show graphs'],
      ['b', `graph:${state.graphMode}`],
      ['t', state.treeView ? 'flat' : 'tree'],
      ['d', state.detailed ? 'basic' : 'detailed'],
      ['T', `temp:${state.tempUnit}`],
      ['p', state.paused ? 'resume' : 'pause'],
    ];
   const row2: [string, string][] = [
     ['s', `sort:${state.sortMode}`],
     ['/', 'filter'],
     ['k', 'kill'],
     ['S', 'signal'],
     ['e', 'export'],
     ['l', state.logging ? 'stop log' : 'log'],
     ['f', state.exportFormat],
     ['+/-', `${state.interval}s`],
     ['r', state.p2pServerRunning ? 'stop p2p' : 'start p2p'],
   ];
   const fmt = (list: [string, string][]) => list.map(([k, label]) => `${chalk.hex('#50fa7b').bold(k)} ${chalk.dim(label)}`).join(chalk.dim('  |  '));
   const str1 = fmt(row1);
   const str2 = fmt(row2);

   const badges: string[] = [];
   if (state.paused) badges.push(chalk.yellow.bold('⏸ PAUSED'));
   if (state.logging) badges.push(chalk.red.bold('● REC'));
   if (state.activePanel !== 'grid') badges.push(chalk.cyan.bold(`◉ ${state.activePanel.toUpperCase()}`));
   if (state.p2pServerRunning) badges.push(chalk.green.bold(`P2P ${state.p2pBind || '0.0.0.0'}:${state.p2pPort}`));
   const badgeStr = badges.join('  ') || ' ';

   return [str1, str2, badgeStr];
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
      setStatus(chalk.red(`⚠ Alert: ${reasons.join('; ')}`), 5000);
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
    } else if (!hot && !anomalyTriggered && !watchdogTriggered) {
     state.alerted = false;
   }
  }

function renderSplashMenu(cols: number, rows: number): string[] {
  const out: string[] = [];
  const contentLines: string[] = [];
  const logo = [
    chalk.hex('#ff6004').bold('                ██████╗ ██╗   ██╗██████╗ ███████╗'),
    chalk.hex('#ff8004').bold('                ██╔══██╗╚██╗ ██╔╝██╔══██╗██╔════╝'),
    chalk.hex('#ffa004').bold('                ██████╔╝ ╚████╔╝ ██████╔╝█████╗  '),
    chalk.hex('#ffc004').bold('                ██╔═══╝   ╚██╔╝  ██╔══██╗██╔══╝  '),
    chalk.hex('#ffe004').bold('                ██║        ██║   ██║  ██║███████╗'),
    chalk.hex('#ffff40').bold('                ╚═╝        ╚═╝   ╚═╝  ╚═╝╚══════╝')
  ];

  const menuTop = Math.max(0, Math.floor(rows / 2) - 8);
  for (let i = 0; i < menuTop; i++) out.push('');

  const strip = (s: string) => s.replace(/^(\x1b\[[0-9;]*m)+( +)/, '$1');
  for (const line of logo) contentLines.push(strip(line));
  contentLines.push('');
  contentLines.push(strip(chalk.dim('                  system monitor v9.0.0')));
  contentLines.push('');
  contentLines.push('');

  for (let i = 0; i < MENU_OPTIONS.length; i++) {
    const isSelected = i === state.menuSelectionIndex;
    const opt = MENU_OPTIONS[i];
    const prefix = isSelected ? chalk.cyan.bold('  ▶ ') : '    ';
    const text = isSelected ? chalk.bgCyan.black(` ${opt} `) : chalk.dim(` ${opt} `);
    contentLines.push(prefix + text);
  }

  contentLines.push('');
  contentLines.push('');
  contentLines.push(strip(chalk.dim('             Use ↑/↓ to navigate, Enter to select')));

  while (contentLines.length < rows) contentLines.push('');
  const maxWidth = Math.max(...contentLines.map(visLen));
  const padding = Math.max(0, Math.floor((cols - maxWidth) / 2));
  const padStr = ' '.repeat(padding);
  for (const line of contentLines) out.push(padStr + fitVisible(line, cols));
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
    chalk.bold.hex('#ff6004')('Pyre - The Terminal System Monitor'),
    '',
    'Created with ❤️  using Node.js',
    '',
    chalk.cyan('Libraries used:'),
    '  - chalk       (Terminal styling)',
    '  - systeminformation (System metrics)',
    '',
    chalk.dim('Press Esc or Enter to return to menu.')
  ];

  out.push(...panel('CREDITS', content, cols, chalk.magenta, chalk.dim, rows - 2));
  return out;
}

export { render, footerLine, renderCustomizerOverlay, checkAlerts, processRowBudget, invalidateTableCache, invalidateFrame };
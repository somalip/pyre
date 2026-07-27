/**
 * Live dashboard rendering.
 *
 * Contains the main `render` loop, the footer key-bindings
 * line, the UI customizer overlay, and the thermal/CPU
 * alert checker.  All state variables are imported from
 * `state.ts`.
 */
import chalk from 'chalk';
import { formatTable, formatGraphs, gridColumns, THEMES, type ThemeName, panel } from '../formatters/index.js';
import { state, setStatus, SIGNAL_OPTIONS, getToggleKey } from './state.js';
import type { StatsData } from '../monitors/index.js';

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
    limit,
    state.currentTheme,
    state.activePanel,
    state.treeView ? '1' : '0',
    JSON.stringify(state.visiblePanels),
  ].join('|');
}

function graphsCacheParams(): string {
  return [
    state.termWidth,
    state.currentTheme,
    state.graphMode,
  ].join('|');
}

/**
 * How many process rows we can realistically fit given
 * current terminal height.  Computed from the number of
 * card columns and the reserved space for the header,
 * cards, graphs, and footer.
 */
  function processRowBudget(): number {
    let overlayRows = 0;
    if (state.inputMode === 'customizer') overlayRows = state.CUSTOMIZER_OPTIONS.length + 3;
    else if (state.inputMode === 'signal') overlayRows = 6;
    else if (state.inputMode === 'filter' || state.inputMode === 'kill' || state.inputMode === 'p2p') overlayRows = 3;

    if (state.activePanel === 'process') {
      return Math.max(10, state.termHeight - 12 - overlayRows);
    }

    const columns = gridColumns(state.termWidth);
    const visibleCards = Object.values(state.visiblePanels).filter(v => v !== false).length;
    const cardRows = Math.ceil(visibleCards / columns);
    const reserved = 4 + cardRows * 8 + 8 + (state.showGraphs ? 11 : 0) + 5 + overlayRows;
    return Math.max(5, state.termHeight - reserved);
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

function renderCustomizerOverlay(): string {
   const themesList = Object.keys(THEMES) as ThemeName[];
   const lines = [
     chalk.bgCyan.black.bold(' UI CUSTOMIZER (Use ↑/↓ or J/K to navigate, Enter/Space to toggle, Esc to exit) '),
   ];

   state.CUSTOMIZER_OPTIONS.forEach((opt, idx) => {
     const isSelected = idx === state.customizerIndex;
     const prefix = isSelected ? chalk.yellow('▶ ') : '  ';

      if (opt === 'Theme') {
        lines.push(`${prefix}${opt}: ${chalk.bold.green(state.currentTheme)} [${themesList.join(', ')}]`);
      } else if (opt === 'Graph Mode') {
        lines.push(`${prefix}${opt}: ${chalk.bold.green(state.graphMode)} [spark, bar]`);
      } else {
        const toggleKey = getToggleKey(opt);
        const isVisible = toggleKey ? (toggleKey === 'tree' ? state.treeView : state.visiblePanels[toggleKey] !== false) : true;
        const status = isVisible ? chalk.green('[VISIBLE]') : chalk.red('[HIDDEN]');
        lines.push(`${prefix}${opt}: ${status}`);
      }
   });

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
  const lines: string[] = [];
  const theme = THEMES[state.currentTheme] || THEMES.default;

  const params = tableCacheParams();
  const tableStr = _tableDataDirty || state.lastData !== _cachedTableData || params !== _cachedTableParams
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
        });
        _cachedTableData = state.lastData;
        _cachedTableParams = params;
        _cachedTable = out;
        _tableDataDirty = false;
        return out;
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
          _cachedGraphs = out;
          return out;
        })()
      : _cachedGraphs;

  if (state.showGraphs && state.activePanel !== 'p2p') {
    bodyLines.push('');
    bodyLines.push(...graphsStr.split('\n'));
  }

  const footerLines: string[] = [];
  footerLines.push('');
  footerLines.push(...footerLine().split('\n'));

  if (state.inputMode === 'customizer') {
      footerLines.push(...renderCustomizerOverlay().split('\n'));
    } else if (state.inputMode === 'filter') {
      footerLines.push(chalk.cyan(`  Filter processes: ${state.inputBuffer}_`));
    } else if (state.inputMode === 'kill') {
      footerLines.push(chalk.cyan(`  Kill PID: ${state.inputBuffer}_  (enter to confirm, esc to cancel)`));
     } else if (state.inputMode === 'signal') {
       const sigIdx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
       const sigList = state.SIGNAL_OPTIONS.map((s, i) => i === sigIdx ? chalk.yellow(s) : chalk.dim(s)).join('  ');
       footerLines.push(chalk.cyan(`  Signal: ${state.inputBuffer}_`));
       footerLines.push(chalk.dim(`  ${sigList}`));
       footerLines.push(chalk.dim('  ↑/↓ to select, Enter to confirm, Esc to cancel'));
     } else if (state.inputMode === 'p2p') {
       footerLines.push(chalk.cyan(`  P2P password (${state.p2pPort}): ${state.inputBuffer}_  (enter to start, esc to cancel)`));
     } else if (state.statusMessage) {
       footerLines.push(`  ${state.statusMessage}`);
     } else {
       footerLines.push('');
     }

  const maxBodyLines = Math.max(1, state.termHeight - footerLines.length);
  if (bodyLines.length > maxBodyLines) {
    bodyLines.length = maxBodyLines;
  }

  const frameLines = [...bodyLines, ...footerLines];
  if (frameLines.length > state.termHeight) {
    frameLines.length = state.termHeight;
  }
  writeFrame(frameLines);
}

function footerLine(): string {
   const row1: [string, string][] = [
     ['q', 'quit'],
     ['c', 'customize UI'],
     ['←/→', 'tab'],
     ['1-9', 'panels'],
     ['g', state.showGraphs ? 'hide graphs' : 'show graphs'],
     ['b', `graph:${state.graphMode}`],
     ['t', state.treeView ? 'flat' : 'tree'],
     ['d', state.detailed ? 'basic' : 'detailed'],
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
   const badgeStr = badges.join('  ');

   return badgeStr ? `${str1}\n${str2}    ${badgeStr}` : `${str1}\n${str2}`;
  }

function checkAlerts(data: StatsData) {
  const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? null;
  const hot = data.cpu.usage >= state.CPU_ALERT_PCT || (temp !== null && temp >= state.TEMP_ALERT_C);
  if (hot && !state.alerted) {
    state.alerted = true;
    process.stdout.write('\x07');
    const reason = data.cpu.usage >= state.CPU_ALERT_PCT ? `CPU at ${data.cpu.usage}%` : `Temp at ${temp}°C`;
    setStatus(chalk.red(`⚠ Alert: ${reason}`), 5000);
  } else if (!hot) {
    state.alerted = false;
  }
}

export { render, footerLine, renderCustomizerOverlay, checkAlerts, processRowBudget, invalidateTableCache, invalidateFrame };
/**
 * Live dashboard rendering.
 *
 * Contains the main `render` loop, the footer key-bindings
 * line, the UI customizer overlay, and the thermal/CPU
 * alert checker.  All state variables are imported from
 * `state.ts`.
 */
import chalk from 'chalk';
import { formatTable, formatGraphs, gridColumns, THEMES, type ThemeName } from '../formatters/index.js';
import { state, setStatus, SIGNAL_OPTIONS } from './state.js';
import type { StatsData } from '../monitors/index.js';

/**
 * How many process rows we can realistically fit given
 * current terminal height.  Computed from the number of
 * card columns and the reserved space for the header,
 * cards, graphs, and footer.
 */
function processRowBudget(): number {
  const columns = gridColumns(state.termWidth);
  const cardRows = Math.ceil(6 / columns);
  const reserved = 2 + cardRows * 8 + 11 + (state.showGraphs ? 9 : 0) + 4;
  return Math.max(3, Math.min(40, state.termHeight - reserved));
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
     } else if (opt === 'Toggle Tree View') {
       const status = state.treeView ? chalk.green('[VISIBLE]') : chalk.red('[HIDDEN]');
       lines.push(`${prefix}${opt}: ${status}`);
     } else {
       const key = opt.replace('Toggle ', '').toLowerCase();
       const isVisible = state.visiblePanels[key as keyof typeof state.visiblePanels] !== false;
       const status = isVisible ? chalk.green('[VISIBLE]') : chalk.red('[HIDDEN]');
       lines.push(`${prefix}${opt}: ${status}`);
     }
   });

   return lines.map(l => `  ${l}`).join('\n');
 }

function render() {
  if (!state.lastData) return;
  const lines: string[] = [];
  lines.push(
    formatTable(state.lastData, {
      width: state.termWidth,
      sortBy: state.sortMode,
      filter: state.processFilter || undefined,
      processLimit: processRowBudget(),
      theme: state.currentTheme,
      visible: state.visiblePanels,
      treeView: state.treeView,
    })
  );

  if (state.showGraphs) {
    lines.push('');
    lines.push(formatGraphs(state.history, state.termWidth, state.currentTheme));
  }

  lines.push('');
  lines.push(footerLine());

if (state.inputMode === 'customizer') {
     lines.push(renderCustomizerOverlay());
   } else if (state.inputMode === 'filter') {
     lines.push(chalk.cyan(`  Filter processes: ${state.inputBuffer}_`));
   } else if (state.inputMode === 'kill') {
     lines.push(chalk.cyan(`  Kill PID: ${state.inputBuffer}_  (enter to confirm, esc to cancel)`));
   } else if (state.inputMode === 'signal') {
     const sigIdx = SIGNAL_OPTIONS.indexOf(state.inputBuffer);
     const sigList = SIGNAL_OPTIONS.map((s, i) => i === sigIdx ? chalk.yellow(s) : chalk.dim(s)).join('  ');
     lines.push(chalk.cyan(`  Signal: ${state.inputBuffer}_`));
     lines.push(chalk.dim(`  ${sigList}`));
     lines.push(chalk.dim('  ↑/↓ to select, Enter to confirm, Esc to cancel'));
   } else if (state.statusMessage) {
     lines.push(`  ${state.statusMessage}`);
   }

  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(lines.join('\n'));
}

function footerLine(): string {
   const keys: [string, string][] = [
     ['q', 'quit'],
     ['c', 'customize UI'],
     ['p', state.paused ? 'resume' : 'pause'],
     ['g', state.showGraphs ? 'hide graphs' : 'show graphs'],
     ['d', state.detailed ? 'basic' : 'detailed'],
     ['s', `sort:${state.sortMode}`],
     ['/', 'filter'],
     ['k', 'kill'],
     ['S', 'signal'],
     ['t', state.treeView ? 'flat' : 'tree'],
     ['e', 'export'],
     ['l', state.logging ? 'stop log' : 'log'],
     ['f', state.exportFormat],
     ['+/-', `${state.interval}s`],
   ];
    const keyStr = keys.map(([k, label]) => `${chalk.hex('#50fa7b').bold(k)} ${chalk.dim(label)}`).join(chalk.dim('  |  '));


   const badges: string[] = [];
   if (state.paused) badges.push(chalk.yellow.bold('⏸ PAUSED'));
   if (state.logging) badges.push(chalk.red.bold('● REC'));
   const badgeStr = badges.join('  ');

   return badgeStr ? `${keyStr}    ${badgeStr}` : keyStr;
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

export { render, footerLine, renderCustomizerOverlay, checkAlerts, processRowBudget };
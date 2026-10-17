/**
 * TUI Renderer for Pyre's Command Center & Tool Navigator.
 */
import chalk from 'chalk';
import { THEMES, type ThemeName, panel, fitVisible, visLen, stampOverlay, styleSelectedRow, render3DSprite, SPRITE_3D_MODES } from '../formatters/index.js';
import type { MenuState, CommandDefinition } from './types.js';
import { CATEGORIES } from './commands.js';

export function renderMenuScreen(state: MenuState, filteredCommands: CommandDefinition[]): string {
  const width = Math.max(60, state.termWidth || 80);
  const height = Math.max(16, state.termHeight || 24);
  const theme = THEMES[state.theme as ThemeName] || THEMES.default;
  const accent = theme.cpu || chalk.cyan;
  const border = theme.border || chalk.dim;
  const highlight = theme.graphs || chalk.hex('#ff6a39');

  const lines: string[] = [];

  // --- 1. Header Banner ---
  const headerLeft = border('─[ ') + chalk.hex('#ff3b00').bold('◢▓◤ ') + accent(chalk.bold('PYRE 3D ')) + chalk.hex('#f1f5f9').bold('Command Center') + chalk.hex('#64748b')(' · 38 Tools') + border(' ]─');
  const headerRight = chalk.hex('#94a3b8')('[?] Help  [q] Quit ') + border('─');
  const topBarInner = headerLeft + border('─'.repeat(Math.max(0, width - visLen(headerLeft) - visLen(headerRight) - 2))) + headerRight;
  lines.push(border('╭') + fitVisible(topBarInner, width - 2) + border('╮'));

  const subtitle = ' ◈ 3D Interactive Tool Deck — Browse, search, inspect, and launch all 38 Pyre CLI subcommands';
  lines.push(border('│') + fitVisible(chalk.hex('#94a3b8')(subtitle), width - 2) + border('│'));

  // --- 2. Search Bar & Status ---
  let searchInput = state.searchQuery;
  if (state.inputMode === 'search') {
    searchInput += chalk.bgWhite.black(' ');
  }
  const searchPrompt = chalk.hex('#94a3b8')(' / Search: ');
  const searchContent = searchPrompt + (state.searchQuery ? chalk.bold.yellow(searchInput) : chalk.dim('Type command, keyword or description... (e.g. doctor, clean, smart)'));
  const matchCount = chalk.hex('#64748b')(`(${filteredCommands.length}/38 tools) `);
  const searchBar = fitVisible(searchContent, Math.max(10, width - visLen(matchCount) - 2)) + matchCount;
  lines.push(border('├') + border('─'.repeat(width - 2)) + border('┤'));
  lines.push(border('│') + fitVisible(searchBar, width - 2) + border('│'));

  // --- 3. Category Tabs Bar ---
  const catTabs = CATEGORIES.map((cat) => {
    const isSelected = cat.id === state.category;
    if (isSelected) {
      return chalk.bgHex('#ff5500').black.bold(` ${cat.icon} ${cat.name} `);
    }
    return chalk.hex('#64748b')(` ${cat.icon} `) + chalk.hex('#94a3b8')(`${cat.name} `);
  }).join(chalk.hex('#3b4252')('·'));
  lines.push(border('│') + fitVisible(' ' + catTabs, width - 2) + border('│'));

  // --- 4. Main Body (Dual Pane or Single Pane) ---
  const bodyHeight = Math.max(8, height - 9); // Total rows available for list/inspector
  const isDualPane = width >= 76;
  const listWidth = isDualPane ? Math.min(46, Math.floor(width * 0.44)) : width - 2;
  const inspectorWidth = width - 2 - listWidth - (isDualPane ? 1 : 0);

  if (isDualPane) {
    lines.push(border('├') + border('─'.repeat(listWidth)) + border('┬') + border('─'.repeat(inspectorWidth)) + border('┤'));
  } else {
    lines.push(border('├') + border('─'.repeat(width - 2)) + border('┤'));
  }

  // Left: Command list rows
  const listLines: string[] = [];
  const selectedIdx = Math.min(state.selectedIndex, Math.max(0, filteredCommands.length - 1));

  // Compute scroll window
  let startIdx = state.scrollOffset;
  if (selectedIdx < startIdx) {
    startIdx = selectedIdx;
  } else if (selectedIdx >= startIdx + bodyHeight) {
    startIdx = selectedIdx - bodyHeight + 1;
  }
  state.scrollOffset = startIdx;
  const endIdx = Math.min(filteredCommands.length, startIdx + bodyHeight);

  if (filteredCommands.length === 0) {
    listLines.push(chalk.yellow('  No commands match your search.'));
    listLines.push(chalk.dim('  Press Esc or backspace to clear query.'));
  } else {
    for (let i = startIdx; i < endIdx; i++) {
      const cmd = filteredCommands[i];
      const isCur = i === selectedIdx;
      const badgeText = `[${cmd.badge}]`;
      const cliMax = Math.max(10, listWidth - badgeText.length - 5);
      const cliTrunc = cmd.cli.length > cliMax ? cmd.cli.slice(0, cliMax - 1) + '…' : cmd.cli.padEnd(cliMax);

      if (isCur) {
        const rowText = `${chalk.hex('#ff6b35').bold(' ❯ ')}${chalk.bold.white(cliTrunc)} ${chalk.hex('#fdba74')(badgeText)} `;
        listLines.push(styleSelectedRow(rowText, listWidth));
      } else {
        const badgeStyled = chalk.hex('#64748b')(badgeText);
        const cliStyled = chalk.bold.hex('#e2e8f0')(cliTrunc);
        const rowText = `   ${cliStyled} ${badgeStyled} `;
        listLines.push(fitVisible(rowText, listWidth));
      }
    }
  }

  while (listLines.length < bodyHeight) {
    listLines.push(' '.repeat(listWidth));
  }

  // Right: Inspector Pane
  const inspectorLines: string[] = [];
  const curCmd = filteredCommands[selectedIdx];

  if (curCmd && isDualPane) {
    inspectorLines.push(' ' + accent(chalk.bold(curCmd.name)) + '  ' + chalk.bgHex('#1e293b').hex('#94a3b8')(` ${curCmd.badge} `));
    inspectorLines.push(chalk.hex('#64748b')(' Syntax: ') + highlight(chalk.bold(curCmd.cli)));
    inspectorLines.push(' ' + chalk.hex('#334155')('─'.repeat(Math.max(4, inspectorWidth - 2))));

    // Description & Help
    inspectorLines.push(fitVisible(` ${chalk.hex('#f1f5f9')(curCmd.description)}`, inspectorWidth - 1));
    inspectorLines.push('');
    inspectorLines.push(fitVisible(` ${chalk.hex('#94a3b8')(curCmd.detailedHelp)}`, inspectorWidth - 1));
    inspectorLines.push('');

    // Flags section if present
    if (curCmd.flags && curCmd.flags.length > 0) {
      inspectorLines.push(chalk.bold.hex('#94a3b8')(' Options & Flags:'));
      for (const f of curCmd.flags.slice(0, 4)) {
        const flagLabel = chalk.yellow(`  ${f.flag.padEnd(18)}`);
        const flagDesc = chalk.hex('#94a3b8')(` ${f.desc}`);
        inspectorLines.push(fitVisible(`${flagLabel}${flagDesc}`, inspectorWidth - 1));
      }
      inspectorLines.push('');
    }

    // Example section if present
    if (curCmd.examples && curCmd.examples.length > 0) {
      inspectorLines.push(chalk.bold.hex('#94a3b8')(' Examples:'));
      for (const ex of curCmd.examples.slice(0, 2)) {
        inspectorLines.push(chalk.cyan(`  $ ${ex}`));
      }
      inspectorLines.push('');
    }

    // Quick action prompt
    inspectorLines.push(' ' + chalk.hex('#334155')('─'.repeat(Math.max(4, inspectorWidth - 2))));
    const runPrompt = curCmd.requiresArgs
      ? chalk.yellow(' [Enter] Configure Args & Run   [c] Copy   [e] Edit Flags')
      : chalk.green(' [Enter] Execute Command   [c] Copy   [e] Edit Flags');
    inspectorLines.push(fitVisible(runPrompt, inspectorWidth - 1));

    // If there are at least 6 spare rows at the bottom of the inspector, render a 3D Hologram for the selected tool!
    if (bodyHeight - inspectorLines.length >= 6 && inspectorWidth >= 32) {
      while (inspectorLines.length < bodyHeight - 6) {
        inspectorLines.push(' '.repeat(inspectorWidth));
      }
      const spriteMode = SPRITE_3D_MODES[selectedIdx % SPRITE_3D_MODES.length];
      const spriteRows = render3DSprite(spriteMode, 18, 6, 12 + selectedIdx * 3, { cpuUsage: 35 + (selectedIdx * 11) % 50, memUsage: 45 });
      const infoW = Math.max(10, inspectorWidth - 21);
      const infoRows = [
        chalk.hex('#38bdf8').bold(`◈ 3D HOLO: ${spriteMode.toUpperCase()}`),
        chalk.hex('#94a3b8')(`Tool #${selectedIdx + 1} · ${curCmd.category.toUpperCase()}`),
        chalk.hex('#64748b')(`Tags: ${curCmd.tags.slice(0, 3).join(', ')}`),
        chalk.hex('#cbd5e1')(`CLI:  ${curCmd.cli}`),
        chalk.hex('#10b981')(`Mode: ${curCmd.requiresArgs ? 'Interactive Args' : 'Instant Launch'}`),
        chalk.hex('#64748b')(`Press Enter to launch`),
      ];
      for (let s = 0; s < 6; s++) {
        inspectorLines.push(fitVisible(` ${spriteRows[s]}  ${fitVisible(infoRows[s] || '', infoW)}`, inspectorWidth));
      }
    }
  }

  while (inspectorLines.length < bodyHeight) {
    inspectorLines.push(' '.repeat(inspectorWidth));
  }

  // Combine Left & Right panes into body rows
  for (let r = 0; r < bodyHeight; r++) {
    const left = fitVisible(listLines[r] || '', listWidth);
    if (isDualPane) {
      const right = fitVisible(inspectorLines[r] || '', inspectorWidth);
      lines.push(border('│') + left + border('│') + right + border('│'));
    } else {
      lines.push(border('│') + left + border('│'));
    }
  }

  // --- 5. Footer Shortcuts ---
  if (isDualPane) {
    lines.push(border('├') + border('─'.repeat(listWidth)) + border('┴') + border('─'.repeat(inspectorWidth)) + border('┤'));
  } else {
    lines.push(border('├') + border('─'.repeat(width - 2)) + border('┤'));
  }
  const statusMsg = state.statusMessage ? chalk.yellow(` ${state.statusMessage} `) : '';
  const shortcuts = ` [↑/↓] Select  [Enter] Run  [Tab] Category  [/] Search  [e] Edit  [?] Help  [q] Quit`;
  const footerRow = fitVisible(shortcuts, Math.max(10, width - visLen(statusMsg) - 2)) + statusMsg;
  lines.push(border('│') + fitVisible(footerRow, width - 2) + border('│'));
  lines.push(border('╰') + border('─'.repeat(width - 2)) + border('╯'));

  // --- 6. Modal Overlays (if active) ---
  if (state.inputMode === 'prompt-args' && state.activeCommand) {
    overlayPromptModal(lines, width, state.activeCommand, state.argPromptValue, accent, border);
  } else if (state.inputMode === 'edit-cmd' && state.activeCommand) {
    overlayEditCmdModal(lines, width, state.activeCommand, state.argPromptValue, accent, border);
  } else if (state.inputMode === 'help') {
    overlayHelpModal(lines, width, accent, border);
  }

  return lines.join('\r\n');
}

/** Render centered modal prompt for command arguments */
function overlayPromptModal(
  lines: string[],
  width: number,
  cmd: CommandDefinition,
  val: string,
  accent: (s: string) => string,
  border: (s: string) => string
) {
  const modalW = Math.min(width - 4, 64);
  const promptText = cmd.requiresArgs?.prompt || 'Enter arguments:';
  const modalLines = [
    chalk.bold.yellow(`  Run: ${cmd.cli}`),
    chalk.dim(`  ${cmd.description}`),
    '',
    chalk.white(`  ${promptText}`),
    `  > ${chalk.bold.cyan(val)}${chalk.bgWhite.black(' ')}`,
    '',
    chalk.dim('  [Enter] Run Command    [Esc] Cancel'),
  ];

  const box = panel(` Execute: ${cmd.name} `, modalLines, modalW, accent, border, modalLines.length);
  stampOverlay(lines, box, width);
}

/** Render centered modal for customizing command line */
function overlayEditCmdModal(
  lines: string[],
  width: number,
  cmd: CommandDefinition,
  val: string,
  accent: (s: string) => string,
  border: (s: string) => string
) {
  const modalW = Math.min(width - 4, 70);
  const modalLines = [
    chalk.bold.yellow(`  Customize Command Line:`),
    chalk.dim(`  Edit flags or arguments and press Enter to execute.`),
    '',
    `  $ ${chalk.bold.cyan(val)}${chalk.bgWhite.black(' ')}`,
    '',
    chalk.dim('  [Enter] Execute Custom Command    [Esc] Cancel'),
  ];

  const box = panel(` Edit & Run `, modalLines, modalW, accent, border, modalLines.length);
  stampOverlay(lines, box, width);
}

/** Render help overlay */
function overlayHelpModal(
  lines: string[],
  width: number,
  accent: (s: string) => string,
  border: (s: string) => string
) {
  const modalW = Math.min(width - 4, 66);
  const modalLines = [
    chalk.bold.yellow('  Pyre Command Center — Keyboard Shortcuts'),
    '',
    `  ${chalk.cyan('↑ / k, ↓ / j')}       Navigate command list`,
    `  ${chalk.cyan('PgUp / PgDn')}       Scroll command list fast`,
    `  ${chalk.cyan('Tab / Shift+Tab')}   Cycle category filters`,
    `  ${chalk.cyan('1 - 7')}             Jump directly to category`,
    `  ${chalk.cyan('Enter')}             Execute selected command`,
    `  ${chalk.cyan('e')}                 Edit flags/arguments before running`,
    `  ${chalk.cyan('c')}                 Copy command to clipboard / show snippet`,
    `  ${chalk.cyan('/ (or type)')}       Search / filter commands instantly`,
    `  ${chalk.cyan('Backspace')}         Delete search query character`,
    `  ${chalk.cyan('Esc')}               Clear search or close modal`,
    `  ${chalk.cyan('q')}                 Quit to shell`,
    '',
    chalk.dim('  Press any key or Esc to close help...'),
  ];

  const box = panel(' Help & Shortcuts ', modalLines, modalW, accent, border, modalLines.length);
  stampOverlay(lines, box, width);
}

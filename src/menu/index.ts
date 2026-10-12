/**
 * Interactive TUI Command Center & Tool Navigator for Pyre.
 */
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { readConfig } from '../state/config.js';
import type { CommandDefinition, MenuState, CommandCategory } from './types.js';
import { ALL_COMMANDS, CATEGORIES, filterCommands } from './commands.js';
import { renderMenuScreen } from './render.js';

export interface MenuOptions {
  theme?: string;
  initialCategory?: CommandCategory;
  onExit?: () => void;
}

export async function runMenu(opts?: MenuOptions): Promise<void> {
  const config = readConfig();
  const theme = opts?.theme || config.theme || 'default';

  const state: MenuState = {
    category: opts?.initialCategory || 'all',
    categoryIndex: CATEGORIES.findIndex((c) => c.id === (opts?.initialCategory || 'all')) || 0,
    searchQuery: '',
    selectedIndex: 0,
    scrollOffset: 0,
    inputMode: 'search',
    argPromptValue: '',
    activeCommand: null,
    statusMessage: '',
    termWidth: process.stdout.columns || 80,
    termHeight: process.stdout.rows || 24,
    theme,
  };

  let isRunning = true;
  let statusTimer: NodeJS.Timeout | null = null;

  function setStatus(msg: string, durationMs = 3000) {
    state.statusMessage = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      state.statusMessage = '';
      if (isRunning) render();
    }, durationMs);
  }

  function getFiltered(): CommandDefinition[] {
    return filterCommands(ALL_COMMANDS, state.category, state.searchQuery);
  }

  function render() {
    if (!isRunning) return;
    const filtered = getFiltered();
    const output = renderMenuScreen(state, filtered);
    process.stdout.write('\x1b[H' + output);
  }

  function onResize() {
    state.termWidth = process.stdout.columns || 80;
    state.termHeight = process.stdout.rows || 24;
    render();
  }

  function enterTui() {
    process.stdout.write('\x1b[?1049h'); // Enter alternate screen buffer
    process.stdout.write('\x1b[?25l');   // Hide cursor
    process.stdout.write('\x1b[2J\x1b[H'); // Clear screen
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.on('resize', onResize);
    render();
  }

  function leaveTui() {
    process.stdout.removeListener('resize', onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\x1b[?25h');   // Show cursor
    process.stdout.write('\x1b[?1049l'); // Leave alternate screen buffer
  }

  function executeCommand(rawCommandLine: string, isInteractive = false) {
    leaveTui();

    // Parse tokens from command line string
    // e.g. "pyre check --detailed" -> ["check", "--detailed"]
    const tokens = rawCommandLine.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] === 'pyre') {
      tokens.shift();
    }

    console.log(chalk.bold(`\n  🔥 Executing: ${chalk.hex('#ff6a39')(rawCommandLine)}\n`));

    try {
      // Execute through the current node binary and entry point
      const scriptPath = process.argv[1];
      spawnSync(process.argv[0], [scriptPath, ...tokens], {
        stdio: 'inherit',
        env: process.env,
      });
    } catch (err: any) {
      console.error(chalk.red(`\n  ✖ Error executing command: ${err.message}`));
    }

    if (!isInteractive) {
      console.log(chalk.dim('\n  ─────────────────────────────────────────────────────────────'));
      console.log(chalk.yellow('  Press any key to return to Command Center (or [q] to exit)...'));

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', (buf) => {
          const str = buf.toString().toLowerCase();
          if (str === 'q' || str === '\u0003') {
            process.exit(0);
          }
          enterTui();
        });
        return;
      }
    }

    enterTui();
  }

  enterTui();

  return new Promise<void>((resolve) => {
    function onKeypress(str: string, key: readline.Key) {
      if (!isRunning) return;
      if (!key) return;

      // Ctrl+C exits immediately
      if (key.ctrl && key.name === 'c') {
        isRunning = false;
        leaveTui();
        if (opts?.onExit) opts.onExit();
        else process.exit(0);
        resolve();
        return;
      }

      // 1. HELP MODAL MODE
      if (state.inputMode === 'help') {
        state.inputMode = 'search';
        render();
        return;
      }

      // 2. PROMPT ARGS MODE
      if (state.inputMode === 'prompt-args') {
        if (key.name === 'escape') {
          state.inputMode = 'search';
          state.argPromptValue = '';
          render();
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const cmd = state.activeCommand;
          const args = state.argPromptValue.trim();
          state.inputMode = 'search';
          state.argPromptValue = '';
          if (cmd) {
            const fullCmd = args ? `${cmd.cli} ${args}` : cmd.cli;
            executeCommand(fullCmd, cmd.interactive);
          }
          return;
        }
        if (key.name === 'backspace') {
          state.argPromptValue = state.argPromptValue.slice(0, -1);
          render();
          return;
        }
        if (str && str.length === 1 && !key.ctrl && !key.meta) {
          state.argPromptValue += str;
          render();
          return;
        }
        return;
      }

      // 3. EDIT COMMAND LINE MODE
      if (state.inputMode === 'edit-cmd') {
        if (key.name === 'escape') {
          state.inputMode = 'search';
          state.argPromptValue = '';
          render();
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const fullCmd = state.argPromptValue.trim();
          const cmd = state.activeCommand;
          state.inputMode = 'search';
          state.argPromptValue = '';
          if (fullCmd) {
            executeCommand(fullCmd, cmd?.interactive);
          }
          return;
        }
        if (key.name === 'backspace') {
          state.argPromptValue = state.argPromptValue.slice(0, -1);
          render();
          return;
        }
        if (str && str.length === 1 && !key.ctrl && !key.meta) {
          state.argPromptValue += str;
          render();
          return;
        }
        return;
      }

      // 4. MAIN SEARCH & BROWSING MODE
      const filtered = getFiltered();
      const count = filtered.length;

      // Navigation: Up / k
      if (key.name === 'up' || (key.name === 'k' && state.searchQuery === '')) {
        if (count > 0) {
          state.selectedIndex = (state.selectedIndex - 1 + count) % count;
          render();
        }
        return;
      }

      // Navigation: Down / j
      if (key.name === 'down' || (key.name === 'j' && state.searchQuery === '')) {
        if (count > 0) {
          state.selectedIndex = (state.selectedIndex + 1) % count;
          render();
        }
        return;
      }

      // Navigation: PageUp
      if (key.name === 'pageup') {
        state.selectedIndex = Math.max(0, state.selectedIndex - 6);
        render();
        return;
      }

      // Navigation: PageDown
      if (key.name === 'pagedown') {
        state.selectedIndex = Math.min(count - 1, state.selectedIndex + 6);
        render();
        return;
      }

      // Cycle Category: Tab / Shift+Tab
      if (key.name === 'tab') {
        const dir = key.shift ? -1 : 1;
        state.categoryIndex = (state.categoryIndex + dir + CATEGORIES.length) % CATEGORIES.length;
        state.category = CATEGORIES[state.categoryIndex].id;
        state.selectedIndex = 0;
        state.scrollOffset = 0;
        render();
        return;
      }

      // Help: ?
      if (str === '?' || (str === 'h' && state.searchQuery === '')) {
        state.inputMode = 'help';
        render();
        return;
      }

      // Copy: c
      if (str === 'c' && state.searchQuery === '') {
        const cur = filtered[state.selectedIndex];
        if (cur) {
          setStatus(`CLI command: ${cur.cli}`);
        }
        return;
      }

      // Edit Command: e
      if (str === 'e' && state.searchQuery === '') {
        const cur = filtered[state.selectedIndex];
        if (cur) {
          state.inputMode = 'edit-cmd';
          state.activeCommand = cur;
          state.argPromptValue = cur.cli;
          render();
        }
        return;
      }

      // Execute: Enter / Return
      if (key.name === 'return' || key.name === 'enter') {
        const cur = filtered[state.selectedIndex];
        if (!cur) return;

        if (cur.requiresArgs) {
          state.inputMode = 'prompt-args';
          state.activeCommand = cur;
          state.argPromptValue = cur.requiresArgs.defaultVal || '';
          render();
          return;
        }

        executeCommand(cur.cli, cur.interactive);
        return;
      }

      // Backspace in search
      if (key.name === 'backspace') {
        if (state.searchQuery.length > 0) {
          state.searchQuery = state.searchQuery.slice(0, -1);
          state.selectedIndex = 0;
          state.scrollOffset = 0;
          render();
        }
        return;
      }

      // Esc: clear search or exit
      if (key.name === 'escape') {
        if (state.searchQuery.length > 0) {
          state.searchQuery = '';
          state.selectedIndex = 0;
          state.scrollOffset = 0;
          render();
        } else {
          isRunning = false;
          leaveTui();
          if (opts?.onExit) opts.onExit();
          else process.exit(0);
          resolve();
        }
        return;
      }

      // Quit: q (when search is empty)
      if (str === 'q' && state.searchQuery === '') {
        isRunning = false;
        leaveTui();
        if (opts?.onExit) opts.onExit();
        else process.exit(0);
        resolve();
        return;
      }

      // Regular character typing into search
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        state.searchQuery += str;
        state.selectedIndex = 0;
        state.scrollOffset = 0;
        render();
        return;
      }
    }

    process.stdin.on('keypress', onKeypress);
  });
}

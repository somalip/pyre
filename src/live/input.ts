/**
 * Live dashboard input handling and session lifecycle.
 *
 * Contains `startLive`, `stopLive`, the keypress handler,
 * resize handling, and the ticker restart logic.
 *
 * Imported by `index.ts` as the public API of the live module.
 */
import readline from 'node:readline';
import chalk from 'chalk';
import { collectAll, StatsData } from '../monitors/index.js';
import { THEMES, type ThemeName, type VisibleItems } from '../formatters/index.js';
import { state, setStatus } from './state.js';
import { exportSnapshot, startLogging, stopLogging, toggleLogging, writeLogRow } from './export.js';
import { render, footerLine, checkAlerts, processRowBudget } from './render.js';
import type { LiveOptions, ExportFormat, InputMode, SortMode } from './types.js';

function handleInputModeKey(str: string, key: readline.Key) {
   if (key.name === 'escape') {
     state.inputMode = null;
     state.inputBuffer = '';
     render();
     return;
   }

   if (state.inputMode === 'customizer') {
     const themesList = Object.keys(THEMES) as ThemeName[];

     if (key.name === 'up' || str === 'k') {
       state.customizerIndex = (state.customizerIndex - 1 + state.CUSTOMIZER_OPTIONS.length) % state.CUSTOMIZER_OPTIONS.length;
     } else if (key.name === 'down' || str === 'j') {
       state.customizerIndex = (state.customizerIndex + 1) % state.CUSTOMIZER_OPTIONS.length;
     } else if (key.name === 'return' || str === ' ') {
       const selected = state.CUSTOMIZER_OPTIONS[state.customizerIndex];
       if (selected === 'Theme') {
         const nextIdx = (themesList.indexOf(state.currentTheme) + 1) % themesList.length;
         state.currentTheme = themesList[nextIdx];
       } else if (selected === 'Toggle Tree View') {
         state.treeView = !state.treeView;
       } else {
         const itemKey = selected.replace('Toggle ', '').toLowerCase() as keyof VisibleItems;
         state.visiblePanels[itemKey] = !state.visiblePanels[itemKey];
       }
     }
     render();
     return;
   }

   if (state.inputMode === 'signal') {
     if (key.name === 'up' || str === 'k') {
      const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer);
      state.inputBuffer = state.SIGNAL_OPTIONS[(idx - 1 + state.SIGNAL_OPTIONS.length) % state.SIGNAL_OPTIONS.length];
     } else if (key.name === 'down' || str === 'j') {
      const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer);
      state.inputBuffer = state.SIGNAL_OPTIONS[(idx + 1) % state.SIGNAL_OPTIONS.length];
     } else if (key.name === 'return' || str === ' ') {
       killProcess(state.inputBuffer.trim(), state.inputBuffer.trim());
       state.inputMode = null;
       state.inputBuffer = '';
       render();
       return;
     }
     render();
     return;
   }

   if (key.name === 'return') {
     if (state.inputMode === 'filter') {
       state.processFilter = state.inputBuffer.trim();
       setStatus(state.processFilter ? `Filtering: "${state.processFilter}"` : 'Filter cleared');
     } else if (state.inputMode === 'kill') {
       killProcess(state.inputBuffer.trim());
     }
     state.inputMode = null;
     state.inputBuffer = '';
     render();
     return;
   }

   if (key.name === 'backspace') {
     state.inputBuffer = state.inputBuffer.slice(0, -1);
     render();
     return;
   }

   if (str && str.length === 1 && !key.ctrl && !key.meta) {
     state.inputBuffer += str;
     render();
   }
 }

function killProcess(pidStr: string, signal: string = 'SIGTERM') {
   const pid = parseInt(pidStr, 10);
   if (!pid || pid <= 0) {
     setStatus(`Invalid PID: ${pidStr}`);
     return;
   }
   try {
     process.kill(pid, signal as NodeJS.Signals);
     setStatus(`Sent ${signal} to PID ${pid}`);
   } catch (err: any) {
     setStatus(`Failed to send ${signal} to ${pid}: ${err.message}`);
   }
  }

  function onResize() {
   state.termWidth = process.stdout.columns || 80;
   state.termHeight = process.stdout.rows || 24;
   state.history.setMaxLen(Math.max(20, Math.min(200, state.termWidth - 30)));
   render();
 }

 function restartTicker() {
   if (state.intervalHandle) clearInterval(state.intervalHandle);
   state.intervalHandle = setInterval(tick, state.interval * 1000);
 }

 async function tick() {
   if (state.paused) return;
   try {
     const data = await collectAll({ detailed: state.detailed, processLimit: processRowBudget() });
     state.lastData = data;

     const temp = data.cpu.temperature ?? data.thermal.temperatures?.cpu_die ?? null;
     state.history.push({
       cpuUsage: data.cpu.usage,
       memUsage: data.memory.usagePercent,
       temp,
       rxBytes: data.network.rxBytes,
       txBytes: data.network.txBytes,
       gpuUtil: data.gpu?.utilization,
     });

     writeLogRow(data);
     checkAlerts(data);
     render();
   } catch {
     // skip bad tick
   }
 }

 /**
  * Start the interactive live dashboard.
  *
  * Sets up raw TTY mode, keypress listeners, and the
  * rendering interval.  Idempotent — calling while already
  * running is a no-op.
  */
 export async function startLive(opts: LiveOptions) {
   if (state.running) return;
   state.running = true;
   state.paused = false;
   state.detailed = !!opts.detailed;
   state.interval = opts.interval;
   if (opts.exportDir) state.exportDir = opts.exportDir;
   state.termWidth = process.stdout.columns || 80;
   state.termHeight = process.stdout.rows || 24;
   state.history.reset();
   state.history.setMaxLen(Math.max(20, Math.min(200, state.termWidth - 30)));

   process.stdout.write('\x1b[?1049h');
   process.stdout.write('\x1b[?25l');
   process.stdout.write('\x1b[2J\x1b[H');
   process.title = 'pyre';

   await tick();
   restartTicker();

   if (opts.autoLog) startLogging();

   readline.emitKeypressEvents(process.stdin);
   if (process.stdin.isTTY) process.stdin.setRawMode(true);
   process.stdin.resume();

   process.stdout.on('resize', onResize);

   state.keypressHandler = (str: string, key: readline.Key) => {
     if (!key) return;

     if (key.ctrl && key.name === 'c') {
       stopLive();
       return;
     }

     if (state.inputMode) {
       handleInputModeKey(str, key);
       return;
     }

     switch (key.sequence) {
       case '+':
         state.interval += 1;
         restartTicker();
         setStatus(`Interval set to ${state.interval}s`);
         return;
       case '-':
         state.interval = Math.max(1, state.interval - 1);
         restartTicker();
         setStatus(`Interval set to ${state.interval}s`);
         return;
       case '/':
         state.inputMode = 'filter';
         state.inputBuffer = state.processFilter;
         render();
         return;
     }

     switch (key.name) {
       case 'q':
         stopLive();
         break;
       case 'c':
         state.inputMode = 'customizer';
         state.customizerIndex = 0;
         render();
         break;
       case 'p':
         state.paused = !state.paused;
         setStatus(state.paused ? 'Paused' : 'Resumed');
         render();
         break;
       case 'g':
         state.showGraphs = !state.showGraphs;
         render();
         break;
       case 'd':
         state.detailed = !state.detailed;
         setStatus(`Detailed sensor mode: ${state.detailed ? 'on' : 'off'}`);
         break;
       case 's':
         const sortCycle: SortMode[] = ['cpu', 'mem', 'pid', 'user', 'command', 'state', 'threads', 'runtime'];
         const curIdx = sortCycle.indexOf(state.sortMode);
         state.sortMode = sortCycle[(curIdx + 1) % sortCycle.length];
         setStatus(`Sorting by ${state.sortMode}`);
         render();
         break;
       case 'k':
         state.inputMode = 'kill';
         state.inputBuffer = '';
         render();
         break;
       case 'S':
         state.inputMode = 'signal';
         state.inputBuffer = 'SIGTERM';
         render();
         break;
       case 't':
         state.treeView = !state.treeView;
         setStatus(state.treeView ? 'Tree view enabled' : 'Flat view enabled');
         render();
         break;
       case 'e':
         exportSnapshot();
         render();
         break;
       case 'l':
         toggleLogging();
         render();
         break;
       case 'f':
         state.exportFormat = state.exportFormat === 'json' ? 'csv' : state.exportFormat === 'csv' ? 'tsv' : 'json';
         setStatus(`Export format: ${state.exportFormat}`);
         render();
         break;
     }
   };

   process.stdin.on('keypress', state.keypressHandler);
   process.once('SIGINT', () => stopLive());
 }

 export function stopLive() {
   if (state.intervalHandle) {
     clearInterval(state.intervalHandle);
     state.intervalHandle = null;
   }
   if (state.statusTimer) {
     clearTimeout(state.statusTimer);
     state.statusTimer = null;
   }
   if (state.logStream) {
     state.logStream.end();
     state.logStream = null;
   }
   if (state.keypressHandler) {
     process.stdin.removeListener('keypress', state.keypressHandler);
     state.keypressHandler = null;
   }
   process.stdout.removeListener('resize', onResize);

   state.running = false;
   state.logging = false;

   if (process.stdin.isTTY) process.stdin.setRawMode(false);
   process.stdin.pause();

   process.stdout.write('\x1b[?25h');
   process.stdout.write('\x1b[?1049l');
   process.stdout.write('\x1b[2J\x1b[H');

   process.exit(0);
 }
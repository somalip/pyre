/**
 * Live dashboard session state.
 *
 * All mutable state for the interactive live mode lives
 * in this module so that render, input, and export
 * sub-modules can share it without circular dependencies.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { History } from '../history.js';
import type { StatsData } from '../monitors/index.js';
import type { ExportFormat, InputMode, SortMode, ThemeName, VisibleItems } from './types.js';

export const SIGNAL_OPTIONS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT'] as const;

const state = {
   intervalHandle: null as NodeJS.Timeout | null,
   running: false,
   paused: false,
   detailed: false,
   interval: 2,
   showGraphs: true,
   exportFormat: 'json' as ExportFormat,
   exportDir: './pyre-exports',
   currentTheme: 'default' as ThemeName,
   visiblePanels: {
     cpu: true,
     mem: true,
     power: true,
     battery: true,
     thermal: true,
     network: true,
     disk: true,
     process: true,
   } as VisibleItems,
   logging: false,
   logStream: null as fs.WriteStream | null,
   statusMessage: '',
   statusTimer: null as NodeJS.Timeout | null,
   lastData: null as StatsData | null,
   history: new History(40),
   keypressHandler: null as ((str: string, key: readline.Key) => void) | null,
   termWidth: process.stdout.columns || 80,
   termHeight: process.stdout.rows || 24,
   sortMode: 'cpu' as SortMode,
   processFilter: '',
   inputMode: null as InputMode,
   inputBuffer: '',
   treeView: false,
   SIGNAL_OPTIONS,
   customizerIndex: 0,
   CUSTOMIZER_OPTIONS: [
     'Theme',
     'Toggle CPU',
     'Toggle Memory',
     'Toggle Power',
     'Toggle Battery',
     'Toggle Thermal',
     'Toggle Network',
     'Toggle Disk',
     'Toggle Processes',
     'Toggle Tree View',
   ],
   CPU_ALERT_PCT: 90,
   TEMP_ALERT_C: 95,
   alerted: false,
 };

function setStatus(msg: string, ms = 3000) {
  state.statusMessage = msg;
  if (state.statusTimer) clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    state.statusMessage = '';
  }, ms);
}

export { state, setStatus };
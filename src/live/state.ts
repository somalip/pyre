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
import type { ExportFormat, InputMode, SortMode, GraphMode } from './types.js';
import type { ThemeName, VisibleItems } from '../formatters/types.js';

export const SIGNAL_OPTIONS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT'] as const;

const state = {
   intervalHandle: null as NodeJS.Timeout | null,
   running: false,
   paused: false,
   detailed: false,
    interval: 2,
    showGraphs: true,
    graphMode: 'spark' as GraphMode,
    exportFormat: 'json' as ExportFormat,


   exportDir: './pyre-exports',
   currentTheme: 'default' as ThemeName,
    visiblePanels: {
      cpu: true,
      mem: true,
      gpu: true,
      power: true,
      battery: true,
      thermal: true,
      network: true,
      packets: true,
      tasks: true,
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
      'Graph Mode',
      'Toggle CPU',
      'Toggle Memory',
      'Toggle GPU',
      'Toggle Power',
      'Toggle Battery',
      'Toggle Thermal',
      'Toggle Network',
      'Toggle Packets',
      'Toggle Tasks',
      'Toggle Disk',
      'Toggle Processes',
      'Toggle Tree View',
    ],
   CPU_ALERT_PCT: 90,
   TEMP_ALERT_C: 95,
   alerted: false,
   activePanel: 'grid' as 'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process' | 'p2p',
    mouseEnabled: true,
      PANEL_TABS: [
        { id: 'cpu', label: 'CPU', key: '1' },
        { id: 'mem', label: 'Memory', key: '2' },
        { id: 'gpu', label: 'GPU', key: '3' },
        { id: 'power', label: 'Power', key: '4' },
        { id: 'battery', label: 'Battery', key: '5' },
        { id: 'thermal', label: 'Thermal', key: '6' },
        { id: 'network', label: 'Network', key: '7' },
        { id: 'packets', label: 'Packets', key: '8' },
        { id: 'tasks', label: 'Tasks', key: '9' },
        { id: 'disk', label: 'Disk', key: '0' },
        { id: 'process', label: 'Process', key: 'P' },
        { id: 'p2p', label: 'P2P', key: 'R' },
      ] as const,
     p2pEvents: [] as { type: string; detail: string; ts: number }[],
     p2pBind: '',
     p2pServer: null as { stop: () => void; peerEventHistory: { type: string; detail: string; ts: number }[] } | null,
     p2pServerRunning: false,
     p2pPort: 9876,
     p2pPassword: 'pyre',
  };

function setStatus(msg: string, ms = 3000) {
  state.statusMessage = msg;
  if (state.statusTimer) clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    state.statusMessage = '';
  }, ms);
}

export { state, setStatus };
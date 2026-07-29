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
import { readConfig, type PyreConfig } from '../state/config.js';

export const SIGNAL_OPTIONS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT'] as const;

import { type SplashColorScheme, type SplashAnimation } from '../splash.js';

export { type SplashColorScheme, type SplashAnimation };

const config = readConfig();

const state = {
   intervalHandle: null as NodeJS.Timeout | null,
   uiIntervalHandle: null as NodeJS.Timeout | null,
   running: false,
   paused: false,
   detailed: config.detailed,
    interval: config.interval,
    showGraphs: config.showGraphs,
    graphMode: config.graphMode as GraphMode,
    exportFormat: 'json' as ExportFormat,
    tempUnit: 'c' as 'c' | 'f',

    exportDir: config.exportDir,
    currentTheme: config.theme as ThemeName,
     visiblePanels: {
       cpu: config.visiblePanels.cpu,
       mem: config.visiblePanels.mem,
       gpu: config.visiblePanels.gpu,
       power: config.visiblePanels.power,
       battery: config.visiblePanels.battery,
       thermal: config.visiblePanels.thermal,
       network: config.visiblePanels.network,
       packets: config.visiblePanels.packets,
       tasks: config.visiblePanels.tasks,
       disk: config.visiblePanels.disk,
       process: config.visiblePanels.process,
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
    sortMode: config.sortMode as SortMode,
    processFilter: '',
    inputMode: null as InputMode,
    inputBuffer: '',
    targetPid: '',
    selectedSignal: 'SIGTERM' as typeof SIGNAL_OPTIONS[number],
    treeView: config.treeView,
    SIGNAL_OPTIONS,
     customizerIndex: 0,
     CUSTOMIZER_OPTIONS: [
       'Theme',
       'Graph Mode',
       'Splash Screen',
       'Splash Color',
       'Splash Animation',
       'Notifications',
       'Temperature Unit',
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
     CPU_ALERT_PCT: config.cpuAlertPct,
     TEMP_ALERT_C: config.tempAlertC,
     notificationsEnabled: config.notificationsEnabled,
      alerted: false,
      activePanel: 'grid' as 'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process' | 'p2p',
       mouseEnabled: config.mouseEnabled,
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
        p2pPort: config.p2pPort,
        p2pPassword: config.p2pPassword,
        splashEnabled: config.splashEnabled,
        splashColorScheme: config.splashColorScheme as SplashColorScheme,
        splashAnimation: config.splashAnimation as SplashAnimation,
    };

function setStatus(msg: string, ms = 3000) {
  state.statusMessage = msg;
  if (state.statusTimer) clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    state.statusMessage = '';
  }, ms);
}

function getToggleKey(opt: string): keyof VisibleItems | null {
  const map: Record<string, keyof VisibleItems> = {
    'Toggle CPU': 'cpu',
    'Toggle Memory': 'mem',
    'Toggle GPU': 'gpu',
    'Toggle Power': 'power',
    'Toggle Battery': 'battery',
    'Toggle Thermal': 'thermal',
    'Toggle Network': 'network',
    'Toggle Packets': 'packets',
    'Toggle Tasks': 'tasks',
    'Toggle Disk': 'disk',
    'Toggle Processes': 'process',
    'Toggle Tree View': 'tree',
  };
  return map[opt] ?? null;
}

export { state, setStatus, getToggleKey };
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
import { readConfig, type PyreConfig, type PyreBookmark } from '../state/config.js';

export const SIGNAL_OPTIONS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGSTOP', 'SIGCONT'] as const;

import { type SplashColorScheme, type SplashAnimation } from '../splash.js';

export { type SplashColorScheme, type SplashAnimation };

export const MENU_OPTIONS = ['Resume Dashboard', 'Settings (Customizer)', 'Readme', 'Credits', 'Quit pyre'] as const;

const PALETTE_COMMANDS = [
  { id: 'cpu', label: 'Switch to CPU panel', keys: '1', category: 'Navigation' },
  { id: 'mem', label: 'Switch to Memory panel', keys: '2', category: 'Navigation' },
  { id: 'gpu', label: 'Switch to GPU panel', keys: '3', category: 'Navigation' },
  { id: 'power', label: 'Switch to Power panel', keys: '4', category: 'Navigation' },
  { id: 'battery', label: 'Switch to Battery panel', keys: '5', category: 'Navigation' },
  { id: 'thermal', label: 'Switch to Thermal panel', keys: '6', category: 'Navigation' },
  { id: 'network', label: 'Switch to Network panel', keys: '7', category: 'Navigation' },
  { id: 'packets', label: 'Switch to Connections panel', keys: '8', category: 'Navigation' },
  { id: 'tasks', label: 'Switch to Tasks panel', keys: '9', category: 'Navigation' },
  { id: 'disk', label: 'Switch to Disk panel', keys: '0', category: 'Navigation' },
  { id: 'process', label: 'Switch to Process panel', keys: 'P', category: 'Navigation' },
  { id: 'containers', label: 'Switch to Containers panel', keys: 'C', category: 'Navigation' },
  { id: 'p2p', label: 'Switch to P2P panel', keys: 'R', category: 'Navigation' },
  { id: 'anomalies', label: 'Switch to Anomalies panel', keys: 'A', category: 'Navigation' },
  { id: 'blender', label: 'Switch to Blender panel', keys: 'B', category: 'Navigation' },
  { id: 'grid', label: 'Switch to Grid dashboard', keys: 'Esc', category: 'Navigation' },
  { id: 'graph-toggle', label: 'Toggle graphs on/off', keys: 'g', category: 'View' },
  { id: 'graph-mode', label: 'Cycle graph mode (spark/bar)', keys: 'b', category: 'View' },
  { id: 'pause', label: 'Pause / Resume dashboard', keys: 'p', category: 'View' },
  { id: 'detailed', label: 'Toggle detailed sensor mode', keys: 'd', category: 'View' },
  { id: 'tree', label: 'Toggle tree/flat process view', keys: 't', category: 'View' },
  { id: 'temp-unit', label: 'Toggle temperature unit (C/F)', keys: 'T', category: 'View' },
  { id: 'filter', label: 'Filter processes by name', keys: '/', category: 'Process' },
  { id: 'sort', label: 'Cycle process sort mode', keys: 's', category: 'Process' },
  { id: 'kill', label: 'Kill a process by PID', keys: 'k', category: 'Process' },
  { id: 'signal', label: 'Send signal to a process', keys: 'S', category: 'Process' },
  { id: 'follow', label: 'Follow selected process', keys: 'Space', category: 'Process' },
  { id: 'inspect', label: 'Inspect selected process', keys: 'Enter', category: 'Process' },
  { id: 'export', label: 'Export current snapshot', keys: 'e', category: 'Data' },
  { id: 'log', label: 'Start / stop CSV logging', keys: 'l', category: 'Data' },
  { id: 'format-cycle', label: 'Cycle export format', keys: 'f', category: 'Data' },
  { id: 'interval-inc', label: 'Increase refresh interval', keys: '+', category: 'Data' },
  { id: 'interval-dec', label: 'Decrease refresh interval', keys: '-', category: 'Data' },
  { id: 'customize', label: 'Open UI customizer', keys: 'c', category: 'Settings' },
  { id: 'ai-model', label: 'Change AI anomaly model', keys: 'm', category: 'Settings' },
  { id: 'bookmark-save', label: 'Save current view as bookmark', keys: 'Shift+M', category: 'Bookmarks' },
  { id: 'bookmark-recall', label: 'Recall next bookmark', keys: 'M', category: 'Bookmarks' },
  { id: 'zoom-in', label: 'Zoom in history graph', keys: '[', category: 'Graphs' },
  { id: 'zoom-out', label: 'Zoom out history graph', keys: ']', category: 'Graphs' },
  { id: 'quick-ref', label: 'Show keyboard shortcuts', keys: '?', category: 'Help' },
];

const config = readConfig();

const isDockerEnv = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');

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
        containers: config.visiblePanels.containers,
        blender: config.visiblePanels.blender,
      } as VisibleItems,
     panelLayout: config.panelLayout || ['mem', 'disk', 'net'],
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
    processSelectionIndex: 0,
    processScrollOffset: 0,
    trackedPid: null as number | null,
    inspectingProcess: null as any | null,
    inputMode: (isDockerEnv && !config.dockerModeConfirmed) ? 'docker-alert' as InputMode : null as InputMode,
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
        'AI Model',
        'Grid Panel Order',
        'Toggle CPU',
        'Toggle Memory',
        'Toggle GPU',
        'Toggle Power',
        'Toggle Battery',
        'Toggle Thermal',
        'Toggle Network',
        'Toggle Conns',
        'Toggle Tasks',
        'Toggle Disk',
        'Toggle Processes',
        'Toggle Containers',
        'Toggle Blender',
        'Toggle Tree View',
      ],
     CPU_ALERT_PCT: config.cpuAlertPct,
     TEMP_ALERT_C: config.tempAlertC,
     watchdogProcess: config.watchdogProcess || '',
     watchdogCpu: config.watchdogCpu || 80,
     watchdogMem: config.watchdogMem || 80,
     notificationsEnabled: config.notificationsEnabled,
     webhookUrl: config.webhookUrl || '',
     alertCmd: config.alertCmd || '',
      alerted: false,
       activePanel: 'grid' as 'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process' | 'p2p' | 'anomalies' | 'containers' | 'blender',
       mouseEnabled: config.mouseEnabled,
          PANEL_TABS: [
            { id: 'cpu', label: 'CPU', key: '1' },
            { id: 'mem', label: 'Memory', key: '2' },
            { id: 'gpu', label: 'GPU', key: '3' },
            { id: 'power', label: 'Power', key: '4' },
            { id: 'battery', label: 'Battery', key: '5' },
            { id: 'thermal', label: 'Thermal', key: '6' },
            { id: 'network', label: 'Network', key: '7' },
            { id: 'packets', label: 'Conns', key: '8' },
            { id: 'tasks', label: 'Tasks', key: '9' },
            { id: 'disk', label: 'Disk', key: '0' },
            { id: 'process', label: 'Process', key: 'P' },
            { id: 'containers', label: 'Containers', key: 'C' },
            { id: 'p2p', label: 'P2P', key: 'R' },
            { id: 'anomalies', label: 'Anomalies', key: 'A' },
            { id: 'blender', label: 'Blender', key: 'B' },
          ],
         p2pServer: null as import('../p2p/server.js').P2PServer | null,
         p2pClient: null as import('../p2p/client.js').P2PClient | null,
         p2pServerRunning: false,
         p2pClientConnected: false,
         p2pEvents: [] as any[],
         p2pBind: '',
         p2pPassword: config.p2pPassword,
         p2pPort: config.p2pPort,
         anomalyHistory: [] as import('../anomalies.js').AnomalyAlert[],
        splashEnabled: config.splashEnabled,
        splashColorScheme: config.splashColorScheme as SplashColorScheme,
        splashAnimation: config.splashAnimation as SplashAnimation,
        menuSelectionIndex: 0,
        readmeScrollOffset: 0,
        isDocker: isDockerEnv,
        dockerModeConfirmed: config.dockerModeConfirmed || false,
        dockerSelectionIndex: 0,
        aiModel: config.aiModel || 'expert-rules-v1',
        aiBackend: config.aiBackend || 'builtin',
        modelSelectionIndex: 0,
        // Power user tools state
        bookmarks: [] as PyreBookmark[],
        bookmarkRecallIndex: 0,
        graphZoomLevel: 1,
        panelHistory: [] as string[],
        paletteIndex: 0,
        paletteFilteredCommands: [...PALETTE_COMMANDS],
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
    'Toggle Conns': 'packets',
    'Toggle Tasks': 'tasks',
    'Toggle Disk': 'disk',
    'Toggle Processes': 'process',
    'Toggle Containers': 'containers',
    'Toggle Blender': 'blender',
    'Toggle Tree View': 'tree',
  };
  return map[opt] ?? null;
}

export { state, setStatus, getToggleKey, PALETTE_COMMANDS };
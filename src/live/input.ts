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
import { THEMES, type ThemeName, type VisibleItems, getTabHitboxes, TAB_BAR_ROW } from '../formatters/index.js';
import { state, setStatus } from './state.js';
import { exportSnapshot, startLogging, stopLogging, toggleLogging, writeLogRow } from './export.js';
import { render, footerLine, checkAlerts, processRowBudget } from './render.js';
import type { LiveOptions, ExportFormat, InputMode, SortMode, GraphMode } from './types.js';
import { startP2PServer } from '../p2p/index.js';

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
        } else if (selected === 'Graph Mode') {
          state.graphMode = state.graphMode === 'spark' ? 'bar' : 'spark';
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
       const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
       state.inputBuffer = state.SIGNAL_OPTIONS[(idx - 1 + state.SIGNAL_OPTIONS.length) % state.SIGNAL_OPTIONS.length];
      } else if (key.name === 'down' || str === 'j') {
       const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
       state.inputBuffer = state.SIGNAL_OPTIONS[(idx + 1) % state.SIGNAL_OPTIONS.length];
      } else if (key.name === 'return' || str === ' ') {
        killProcess(state.inputBuffer.trim(), state.inputBuffer.trim() as NodeJS.Signals);
        state.inputMode = null;
        state.inputBuffer = '';
        render();
        return;
      }
      render();
      return;
    }

     if (state.inputMode === 'p2p') {
      if (key.name === 'escape') {
        state.inputMode = null;
        state.inputBuffer = '';
        render();
        return;
      }
      if (key.name === 'return') {
        const password = state.inputBuffer.trim();
        if (password) {
          state.p2pPassword = password;
          startP2PServerFromTUI();
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

  async function startP2PServerFromTUI() {
    if (state.p2pServerRunning) return;
    try {
      const server = await startP2PServer({
        host: '0.0.0.0',
        port: state.p2pPort,
        password: state.p2pPassword,
        intervalMs: state.interval * 1000,
        detailed: state.detailed,
        onLog: (msg: string) => setStatus(msg, 5000),
        onPeerEvent: (evt) => {
          state.p2pEvents.push(evt);
          if (state.p2pEvents.length > 200) state.p2pEvents.shift();
        },
      });
      state.p2pServer = server as any;
      state.p2pServerRunning = true;
      state.p2pBind = (server as any).boundAddress || '0.0.0.0';
      state.p2pEvents = [];
      setStatus(`P2P server started on ${state.p2pBind}:${state.p2pPort}`);
      render();
    } catch (err: any) {
      setStatus(`P2P server failed: ${err.message}`);
      state.p2pServerRunning = false;
      state.p2pServer = null;
      state.p2pBind = '';
      render();
    }
  }

  function syncP2PEvents() {
    if (!state.p2pServer) return;
    const history = state.p2pServer.peerEventHistory;
    if (history && history !== state.p2pEvents) {
      state.p2pEvents = history;
    }
  }

  function stopP2PServer() {
    if (!state.p2pServer) return;
    try {
      state.p2pServer.stop();
    } catch {
      // ignore stop errors
    }
    state.p2pServer = null;
    state.p2pServerRunning = false;
    setStatus('P2P server stopped');
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
        powerWatts: data.power?.combinedWatts ?? data.power?.cpuWatts ?? 0,
        rxPackets: data.network.rxPackets,
        txPackets: data.network.txPackets,
        connections: data.network.connections ?? 0,
      });

      writeLogRow(data);
      checkAlerts(data);
      syncP2PEvents();
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

    if (state.mouseEnabled) {
      process.stdout.write('\x1b[?1000h');
    }

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

      if (key.mouse) {
        handleMouseClick(key.mouse);
        return;
      }

      if (key.sequence && key.sequence.startsWith('\x1b[M')) {
        handleNormalMouse(key.sequence);
        return;
      }

      if (key.sequence && key.sequence.startsWith('\x1b[<')) {
        handleSGRMouse(key.sequence);
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
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9': {
          const tabMap: Record<string, string> = {
            '0': 'disk', '1': 'cpu', '2': 'mem', '3': 'gpu', '4': 'power',
            '5': 'battery', '6': 'thermal', '7': 'network', '8': 'packets', '9': 'tasks'
          };
          const panelId = tabMap[key.sequence];
          if (panelId) {
            state.activePanel = state.activePanel === panelId ? 'grid' : panelId;
            setStatus(state.activePanel === 'grid' ? 'Grid view' : `${panelId} panel`);
            render();
          }
          return;
        }
        case 'P': {
          state.activePanel = state.activePanel === 'process' ? 'grid' : 'process';
          setStatus(state.activePanel === 'grid' ? 'Grid view' : 'Process panel');
          render();
          return;
        }
      }

      switch (key.name) {
        case 'r':
          if (state.p2pServerRunning) {
            stopP2PServer();
            setStatus('P2P server stopped');
            render();
          } else {
            state.inputMode = 'p2p';
            state.inputBuffer = state.p2pPassword;
            render();
          }
          return;
        case 'q':
          stopLive();
          break;
        case 'left': {
          const currentIdx = state.PANEL_TABS.findIndex(t => t.id === state.activePanel);
          if (currentIdx > 0) {
            state.activePanel = state.PANEL_TABS[currentIdx - 1].id;
          } else if (currentIdx === -1) {
            state.activePanel = state.PANEL_TABS[state.PANEL_TABS.length - 1].id;
          }
          setStatus(`Panel: ${state.activePanel}`);
          render();
          break;
        }
        case 'right': {
          const currentIdx = state.PANEL_TABS.findIndex(t => t.id === state.activePanel);
          if (currentIdx < state.PANEL_TABS.length - 1) {
            state.activePanel = state.PANEL_TABS[currentIdx + 1].id;
          } else if (currentIdx === -1) {
            state.activePanel = state.PANEL_TABS[0].id;
          }
          setStatus(`Panel: ${state.activePanel}`);
          render();
          break;
        }
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
         case 'b':
           state.graphMode = state.graphMode === 'spark' ? 'bar' : 'spark';
           setStatus(`Graph mode: ${state.graphMode}`);
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
        case 'tab':
          cycleTab(1);
          break;
        case 'left':
          cycleTab(-1);
          break;
        case 'right':
          cycleTab(1);
          break;
        default:
          if (str && str.length === 1) {
            const tabId = tabKeyToId(str);
            if (tabId) {
              state.activePanel = tabId;
              setStatus(`Panel: ${tabId.toUpperCase()}`);
              render();
            }
          }
      }
    };

    process.stdin.on('keypress', state.keypressHandler);
    process.once('SIGINT', () => stopLive());
  }

  function tabKeyToId(str: string): string | null {
    const map: Record<string, string> = { '1': 'cpu', '2': 'mem', '3': 'gpu', '4': 'power', '5': 'battery', '6': 'thermal', '7': 'network', '8': 'packets', '9': 'tasks', '0': 'disk', 'p': 'process', 'r': 'p2p' };
    return map[str] ?? null;
  }

  function cycleTab(direction: number) {
    const tabs = state.PANEL_TABS.map(t => t.id);
    const current = state.activePanel === 'grid' ? -1 : tabs.indexOf(state.activePanel);
    const next = (current + direction + tabs.length) % tabs.length;
    state.activePanel = tabs[next];
    setStatus(`Panel: ${state.activePanel.toUpperCase()}`);
    render();
  }

  function handleNormalMouse(seq: string) {
    if (seq.length < 6) return;
    const cb = seq.charCodeAt(3) - 32;
    const cx = seq.charCodeAt(4) - 32;
    const cy = seq.charCodeAt(5) - 32;
    if (cb === 0 || cb === 1) {
      handleMouseClick(cy, cx);
    }
  }

  function handleSGRMouse(seq: string) {
    const match = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (!match) return;
    const button = parseInt(match[1]);
    const cx = parseInt(match[2]);
    const cy = parseInt(match[3]);
    if (button === 0 || button === 1) {
      handleMouseClick(cy, cx);
    }
  }

  function handleMouseClick(y: number, x: number) {
    if (y !== TAB_BAR_ROW) return;
    const hitboxes = getTabHitboxes();
    const hit = hitboxes.find(h => x >= h.start && x < h.end);
    if (hit) {
      state.activePanel = state.activePanel === hit.id ? 'grid' : (hit.id as typeof state.activePanel);
      setStatus(state.activePanel === 'grid' ? 'Grid view' : `Panel: ${hit.id.toUpperCase()}`);
      render();
    }
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
    if (state.p2pServer) {
      state.p2pServer.stop();
      state.p2pServer = null;
      state.p2pServerRunning = false;
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

    if (state.mouseEnabled) {
      process.stdout.write('\x1b[?1000l');
    }
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[?1049l');
    process.stdout.write('\x1b[2J\x1b[H');

    process.exit(0);
  }
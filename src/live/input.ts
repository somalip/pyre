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
import { state, setStatus, getToggleKey, type SplashColorScheme, type SplashAnimation, MENU_OPTIONS } from './state.js';
import { exportSnapshot, startLogging, stopLogging, toggleLogging, writeLogRow } from './export.js';
import { render, footerLine, checkAlerts, invalidateTableCache, invalidateFrame } from './render.js';
import type { LiveOptions, ExportFormat, InputMode, SortMode, GraphMode, ActivePanel } from './types.js';
import { startP2PServer } from '../p2p/index.js';
import { writeConfig, readConfig } from '../state/config.js';
import { AVAILABLE_AI_MODELS } from '../ai/models.js';
import { loadPlugins, executePlugins } from '../plugins/index.js';
import { PALETTE_COMMANDS } from './state.js';

  function persistConfig() {
    writeConfig({
      theme: state.currentTheme,
      interval: state.interval,
      exportDir: state.exportDir,
      detailed: state.detailed,
      sortMode: state.sortMode,
      treeView: state.treeView,
      graphMode: state.graphMode,
      showGraphs: state.showGraphs,
      autoLog: state.logging,
      mouseEnabled: state.mouseEnabled,
      cpuAlertPct: state.CPU_ALERT_PCT,
      tempAlertC: state.TEMP_ALERT_C,
      p2pPort: state.p2pPort,
      p2pPassword: state.p2pPassword,
      splashEnabled: state.splashEnabled,
      splashColorScheme: state.splashColorScheme,
       splashAnimation: state.splashAnimation,
       visiblePanels: { ...state.visiblePanels },
       notificationsEnabled: state.notificationsEnabled,
       dockerModeConfirmed: state.dockerModeConfirmed,
       aiModel: state.aiModel,
       aiBackend: state.aiBackend,
       bookmarks: state.bookmarks.map(bm => ({ ...bm })),
       graphZoomLevel: state.graphZoomLevel,
       panelLayout: [...state.panelLayout],
    });
  }

  function isUpKey(key: readline.Key, str?: string): boolean {
  return key.name === 'up' || key.sequence === '\x1b[A' || key.sequence === '\x1bOA';
}
function isDownKey(key: readline.Key, str?: string): boolean {
  return key.name === 'down' || key.sequence === '\x1b[B' || key.sequence === '\x1bOB';
}
function isEnterKey(key: readline.Key, str?: string): boolean {
  return key.name === 'return' || key.name === 'enter' || key.sequence === '\r' || key.sequence === '\n' || str === '\r' || str === '\n';
}
function isEscKey(key: readline.Key, str?: string): boolean {
  return key.name === 'escape' || key.name === 'esc' || key.sequence === '\x1b' || str === '\x1b';
}

  function handleInputModeKey(str: string, key: readline.Key) {
   if (isEscKey(key, str)) {
     state.inputMode = null;
     state.inputBuffer = '';
     render();
     return;
   }

   if (state.inputMode === 'quick-ref') {
     render();
     return;
   }

   if (state.inputMode === 'bookmark-save') {
     if (key.name === 'backspace') {
       state.inputBuffer = state.inputBuffer.slice(0, -1);
       render();
       return;
     }
     if (isEnterKey(key, str)) {
       saveBookmark();
       return;
     }
     if (str && str.length === 1 && !key.ctrl && !key.meta) {
       state.inputBuffer += str;
       render();
     }
     return;
   }

   if (state.inputMode === 'command-palette') {
     if (isUpKey(key, str) || key.name === 'k') {
       state.paletteIndex = Math.max(0, state.paletteIndex - 1);
       render();
       return;
     }
     if (isDownKey(key, str) || key.name === 'j') {
       state.paletteIndex = Math.min(state.paletteFilteredCommands.length - 1, state.paletteIndex + 1);
       render();
       return;
     }
     if (isEnterKey(key, str)) {
       executePaletteCommand();
       return;
     }
     if (key.name === 'backspace') {
       state.inputBuffer = state.inputBuffer.slice(0, -1);
       updatePaletteFilter();
       state.paletteIndex = 0;
       render();
       return;
     }
     if (str && str.length === 1 && !key.ctrl && !key.meta) {
       state.inputBuffer += str;
       updatePaletteFilter();
       state.paletteIndex = 0;
       render();
     }
     return;
   }

   if (state.inputMode === 'customizer') {
     const themesList = Object.keys(THEMES) as ThemeName[];

     if (isUpKey(key, str)) {
       state.customizerIndex = (state.customizerIndex - 1 + state.CUSTOMIZER_OPTIONS.length) % state.CUSTOMIZER_OPTIONS.length;
     } else if (isDownKey(key, str)) {
       state.customizerIndex = (state.customizerIndex + 1) % state.CUSTOMIZER_OPTIONS.length;
     } else if (isEnterKey(key, str) || str === ' ') {
       const selected = state.CUSTOMIZER_OPTIONS[state.customizerIndex];
       if (selected === 'Theme') {
         const nextIdx = (themesList.indexOf(state.currentTheme) + 1) % themesList.length;
         state.currentTheme = themesList[nextIdx];
       } else if (selected === 'Graph Mode') {
         state.graphMode = state.graphMode === 'spark' ? 'bar' : 'spark';
        } else if (selected === 'Splash Screen') {
          state.splashEnabled = !state.splashEnabled;
          setStatus(state.splashEnabled ? 'Splash screen enabled' : 'Splash screen disabled');
        } else if (selected === 'Splash Color') {
          const schemes: SplashColorScheme[] = ['fire', 'ocean', 'forest', 'purple', 'monochrome'];
          const curIdx = schemes.indexOf(state.splashColorScheme);
          state.splashColorScheme = schemes[(curIdx + 1) % schemes.length];
          setStatus(`Splash color: ${state.splashColorScheme}`);
         } else if (selected === 'Splash Animation') {
           const animations: SplashAnimation[] = ['classic', 'wave', 'sparks'];
           const curIdx = animations.indexOf(state.splashAnimation);
           state.splashAnimation = animations[(curIdx + 1) % animations.length];
           setStatus(`Splash animation: ${state.splashAnimation}`);
          } else if (selected === 'Notifications') {
            state.notificationsEnabled = !state.notificationsEnabled;
            setStatus(`Notifications: ${state.notificationsEnabled ? 'on' : 'off'}`);
           } else if (selected === 'Temperature Unit') {
             state.tempUnit = state.tempUnit === 'c' ? 'f' : 'c';
             setStatus(`Temperature unit: ${state.tempUnit.toUpperCase()}`);
           } else if (selected === 'AI Model') {
             const curIdx = AVAILABLE_AI_MODELS.findIndex(m => m.id === state.aiModel);
             const nextIdx = (curIdx + 1) % AVAILABLE_AI_MODELS.length;
             state.aiModel = AVAILABLE_AI_MODELS[nextIdx].id;
             state.aiBackend = AVAILABLE_AI_MODELS[nextIdx].backend;
             setStatus(`AI Model: ${AVAILABLE_AI_MODELS[nextIdx].name}`);
           } else if (selected === 'Grid Panel Order') {
             // Rotate panelLayout
             const layouts = [
               ['mem', 'disk', 'net'],
               ['disk', 'mem', 'net'],
               ['net', 'mem', 'disk'],
               ['mem', 'net', 'disk'],
             ];
             const currentStr = state.panelLayout.join(',');
             const currentIdx = layouts.findIndex(l => l.join(',') === currentStr);
             const nextIdx = (currentIdx + 1) % layouts.length;
             state.panelLayout = layouts[nextIdx];
             setStatus(`Panel layout: ${state.panelLayout.join(' → ')}`);
           } else {
            const toggleKey = getToggleKey(selected);
            if (toggleKey) {
              if (toggleKey === 'tree') {
                state.treeView = !state.treeView;
                state.visiblePanels.tree = state.treeView;
              } else {
                const isVisible = state.visiblePanels[toggleKey] !== false;
                state.visiblePanels[toggleKey] = !isVisible;
              }
            }
          }
        invalidateTableCache();
        invalidateFrame();
        persistConfig();
      }
      render();
      return;
   }

    if (state.inputMode === 'menu') {
      if (isEscKey(key, str)) {
        state.inputMode = null;
        render();
        return;
      }
      if (isUpKey(key, str)) {
        state.menuSelectionIndex = (state.menuSelectionIndex - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length;
        render();
        return;
      }
      if (isDownKey(key, str)) {
        state.menuSelectionIndex = (state.menuSelectionIndex + 1) % MENU_OPTIONS.length;
        render();
        return;
      }
      if (isEnterKey(key, str) || str === ' ') {
        const option = MENU_OPTIONS[state.menuSelectionIndex];
        switch (option) {
          case 'Resume Dashboard':
            state.inputMode = null;
            break;
          case 'Settings (Customizer)':
            state.inputMode = 'customizer';
            state.customizerIndex = 0;
            break;
          case 'Readme':
            state.inputMode = 'readme';
            break;
          case 'Credits':
            state.inputMode = 'credits';
            break;
          case 'Quit pyre':
            process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
            process.exit(0);
        }
        render();
        return;
      }
      render();
      return;
    }

    if (state.inputMode === 'readme' || state.inputMode === 'credits') {
      if (isEscKey(key, str) || isEnterKey(key, str)) {
        state.inputMode = 'menu';
        render();
        return;
      }
      if (state.inputMode === 'readme') {
        if (isUpKey(key, str)) {
          state.readmeScrollOffset = Math.max(0, state.readmeScrollOffset - 1);
          render();
          return;
        }
        if (isDownKey(key, str)) {
          state.readmeScrollOffset += 1;
          render();
          return;
        }
      }
      return;
    }

    if (state.inputMode === 'docker-alert') {
      if (isEscKey(key, str)) {
        state.inputMode = null;
        state.dockerModeConfirmed = true;
        render();
        return;
      }
      if (isUpKey(key, str)) {
        state.dockerSelectionIndex = Math.max(0, state.dockerSelectionIndex - 1);
        render();
        return;
      }
      if (isDownKey(key, str)) {
        state.dockerSelectionIndex = Math.min(1, state.dockerSelectionIndex + 1);
        render();
        return;
      }
      if (isEnterKey(key, str) || str === ' ') {
        state.dockerModeConfirmed = true;
        state.inputMode = null;
        
        if (state.dockerSelectionIndex === 0) {
          // Docker Mode
          state.visiblePanels.battery = false;
          state.visiblePanels.thermal = false;
          state.visiblePanels.power = false;
          state.visiblePanels.gpu = false;
          state.detailed = false;
        } else {
          // Regular TUI
          state.visiblePanels.battery = true;
          state.visiblePanels.thermal = true;
          state.visiblePanels.power = true;
          state.visiblePanels.gpu = true;
        }
        
        invalidateTableCache();
        invalidateFrame();
        persistConfig();
        render();
        return;
      }
      return;
    }

    if (state.inputMode === 'ai-model') {
      if (isEscKey(key, str)) {
        state.inputMode = null;
        render();
        return;
      }
      if (isUpKey(key, str) || str === 'k') {
        state.modelSelectionIndex = (state.modelSelectionIndex - 1 + AVAILABLE_AI_MODELS.length) % AVAILABLE_AI_MODELS.length;
        render();
        return;
      }
      if (isDownKey(key, str) || str === 'j') {
        state.modelSelectionIndex = (state.modelSelectionIndex + 1) % AVAILABLE_AI_MODELS.length;
        render();
        return;
      }
      if (isEnterKey(key, str) || str === ' ') {
        const chosen = AVAILABLE_AI_MODELS[state.modelSelectionIndex];
        state.aiModel = chosen.id;
        state.aiBackend = chosen.backend;
        state.inputMode = null;
        setStatus(`Active AI Model: ${chosen.name}`, 4000);
        invalidateTableCache();
        invalidateFrame();
        persistConfig();
        render();
        return;
      }
      return;
    }

    if (state.inputMode === 'signal') {
      if (isUpKey(key, str)) {
       const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
       state.inputBuffer = state.SIGNAL_OPTIONS[(idx - 1 + state.SIGNAL_OPTIONS.length) % state.SIGNAL_OPTIONS.length];
       state.selectedSignal = state.inputBuffer as any;
      } else if (isDownKey(key, str)) {
       const idx = state.SIGNAL_OPTIONS.indexOf(state.inputBuffer as typeof state.SIGNAL_OPTIONS[number]);
       state.inputBuffer = state.SIGNAL_OPTIONS[(idx + 1) % state.SIGNAL_OPTIONS.length];
       state.selectedSignal = state.inputBuffer as any;
      } else if (isEnterKey(key, str) || str === ' ') {
        state.selectedSignal = state.inputBuffer.trim() as any;
        if (state.targetPid) {
          killProcess(state.targetPid, state.selectedSignal);
          state.inputMode = null;
          state.inputBuffer = '';
        } else {
          state.inputMode = 'kill';
          state.inputBuffer = '';
          setStatus(`Signal ${state.selectedSignal} selected. Enter target PID to kill:`, 5000);
        }
        render();
        return;
      }
      render();
      return;
    }

     if (state.inputMode === 'p2p') {
      if (isEscKey(key, str)) {
        state.inputMode = null;
        state.inputBuffer = '';
        render();
        return;
      }
      if (isEnterKey(key, str)) {
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

   if (isEnterKey(key, str)) {
     if (state.inputMode === 'filter') {
       state.processFilter = state.inputBuffer.trim();
       setStatus(state.processFilter ? `Filtering: "${state.processFilter}"` : 'Filter cleared');
     } else if (state.inputMode === 'kill') {
       const pidStr = state.inputBuffer.trim();
       state.targetPid = pidStr;
       killProcess(pidStr, state.selectedSignal);
     }
     state.inputMode = null;
     state.inputBuffer = '';
     render();
     return;
   }

   if (key.name === 'backspace') {
     state.inputBuffer = state.inputBuffer.slice(0, -1);
     if (state.inputMode === 'filter') {
       state.processFilter = state.inputBuffer;
       invalidateTableCache();
     }
     render();
     return;
   }

   if (str && str.length === 1 && !key.ctrl && !key.meta) {
     state.inputBuffer += str;
     if (state.inputMode === 'filter') {
       state.processFilter = state.inputBuffer;
       invalidateTableCache();
     }
     render();
   }
 }

let confirmKillPid: number | null = null;

function killProcess(pidStr: string, signal: string = 'SIGTERM') {
   const pid = parseInt(pidStr, 10);
   if (!pid || pid <= 0) {
     setStatus(`Invalid PID: ${pidStr}`);
     return;
   }

   const isProtected = pid === 1 || pid === process.pid || pid === process.ppid;
   if (isProtected && confirmKillPid !== pid) {
     confirmKillPid = pid;
     const name = pid === 1 ? 'launchd (system init)' : (pid === process.pid ? 'pyre itself' : 'parent process');
     setStatus(`⚠️ PROTECTED PID ${pid} (${name})! Re-enter PID ${pid} to confirm termination.`, 8000);
     return;
   }

   confirmKillPid = null;
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
   invalidateFrame();
   process.stdout.write('\x1b[2J\x1b[H');
   render();
 }

 function restartTicker() {
   if (state.intervalHandle) clearInterval(state.intervalHandle);
   state.intervalHandle = setInterval(tick, state.interval * 1000);
 }

  async function doWarmup() {
    try {
      const data = await collectAll({ detailed: state.detailed });
      state.lastData = data;
      invalidateTableCache();

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
    } catch {
      // skip bad warmup
    }
  }

  async function tick() {
    if (state.paused) return;
    try {
      const data = await collectAll({ detailed: state.detailed });
      state.lastData = data;
      invalidateTableCache();

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
    export async function startLive(opts: LiveOptions, splashPromise?: Promise<void>) {
      if (state.running) return;
      state.running = true;
      state.paused = false;
      state.detailed = !!opts.detailed;
      if (opts.theme) state.currentTheme = opts.theme;
      state.interval = opts.interval;
      if (opts.exportDir) state.exportDir = opts.exportDir;
      if (opts.alertCpu !== undefined) state.CPU_ALERT_PCT = opts.alertCpu;
      if (opts.alertTemp !== undefined) state.TEMP_ALERT_C = opts.alertTemp;
      if (opts.tempUnit) state.tempUnit = opts.tempUnit;
      state.termWidth = process.stdout.columns || 80;
      state.termHeight = process.stdout.rows || 24;
      state.history.reset();
      state.history.setMaxLen(Math.max(20, 40 * (readConfig().graphZoomLevel || 1)));
      state.bookmarks = readConfig().bookmarks || [];
      state.bookmarkRecallIndex = 0;
      state.graphZoomLevel = readConfig().graphZoomLevel || 1;
      state.panelHistory = [];
      state.paletteIndex = 0;
      state.paletteFilteredCommands = [...PALETTE_COMMANDS];

    await loadPlugins().catch(() => {});
    const warmupPromise = doWarmup();

    if (splashPromise) {
      await splashPromise;
    }

    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[?25l');
    process.stdout.write('\x1b[2J\x1b[H');
    process.title = 'pyre';

    if (state.mouseEnabled) {
      process.stdout.write('\x1b[?1000h');
    }

    await warmupPromise;
    render();

    restartTicker();

    if (opts.autoLog) startLogging();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdout.on('resize', onResize);

    if (state.uiIntervalHandle) clearInterval(state.uiIntervalHandle);
    state.uiIntervalHandle = setInterval(() => {
      if (state.running && !state.paused) render();
    }, 250);

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

      const mouse = (key as { mouse?: { x: number; y: number } }).mouse;
      if (mouse) {
        handleMouseClick(mouse.y, mouse.x);
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
        case '?':
          state.inputMode = state.inputMode === 'quick-ref' ? null : 'quick-ref';
          render();
          return;
        case ':':
          state.inputMode = state.inputMode === 'command-palette' ? null : 'command-palette';
          state.inputBuffer = '';
          state.paletteIndex = 0;
          state.paletteFilteredCommands = [...PALETTE_COMMANDS];
          render();
          return;
        case '[': {
          state.graphZoomLevel = Math.max(1, state.graphZoomLevel - 1);
          state.history.setMaxLen(Math.max(20, 40 * state.graphZoomLevel));
          setStatus(`History zoom: ${state.graphZoomLevel}x (${state.history.maxLen} points)`);
          return;
        }
        case ']': {
          state.graphZoomLevel = Math.min(5, state.graphZoomLevel + 1);
          state.history.setMaxLen(Math.max(20, 40 * state.graphZoomLevel));
          setStatus(`History zoom: ${state.graphZoomLevel}x (${state.history.maxLen} points)`);
          return;
        }
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9': {
          const tabMap: Record<string, ActivePanel> = {
            '0': 'disk', '1': 'cpu', '2': 'mem', '3': 'gpu', '4': 'power',
            '5': 'battery', '6': 'thermal', '7': 'network', '8': 'packets', '9': 'tasks'
          };
          const panelId = tabMap[key.sequence];
          if (panelId) {
            pushPanelHistory(panelId);
            state.activePanel = state.activePanel === panelId ? 'grid' : panelId;
            setStatus(state.activePanel === 'grid' ? 'Grid view' : `${panelId} panel`);
            render();
          }
          return;
        }
        case 'P': {
          pushPanelHistory('process');
          state.activePanel = state.activePanel === 'process' ? 'grid' : 'process';
          setStatus(state.activePanel === 'grid' ? 'Grid view' : 'Process panel');
          render();
          return;
        }
         case 'C': {
           pushPanelHistory('containers');
           state.activePanel = state.activePanel === 'containers' ? 'grid' : 'containers';
           setStatus(state.activePanel === 'grid' ? 'Grid view' : 'Containers panel');
           render();
           return;
         }
         case 'B': {
           pushPanelHistory('blender');
           state.activePanel = state.activePanel === 'blender' ? 'grid' : 'blender';
           setStatus(state.activePanel === 'grid' ? 'Grid view' : 'Blender panel');
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
        case 'left':
          cycleTab(-1);
          break;
        case 'right':
          cycleTab(1);
          break;
        case 'c':
          state.inputMode = 'customizer';
          state.customizerIndex = 0;
          render();
          break;
        case 'm':
          if (key.shift) {
            // Shift+M: save bookmark
            state.inputMode = 'bookmark-save';
            state.inputBuffer = '';
            render();
          } else {
            state.inputMode = 'ai-model';
            state.modelSelectionIndex = Math.max(0, AVAILABLE_AI_MODELS.findIndex(m => m.id === state.aiModel));
            render();
          }
          return;
        case 'M':
          // M (no shift): recall next bookmark
          recallNextBookmark();
          render();
          return;
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
         case 'T':
           state.tempUnit = state.tempUnit === 'c' ? 'f' : 'c';
           setStatus(`Temperature unit: ${state.tempUnit.toUpperCase()}`);
           invalidateTableCache();
           render();
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
           const fmtCycle: ExportFormat[] = ['json', 'csv', 'tsv', 'html', 'md'];
           const curFmt = fmtCycle.indexOf(state.exportFormat);
           state.exportFormat = fmtCycle[(curFmt + 1) % fmtCycle.length];
           setStatus(`Export format: ${state.exportFormat}`);
           render();
           break;
         case 'tab':
           if (key.shift) {
             // Shift+Tab: go back in panel history
             if (state.panelHistory.length > 0) {
               const prev = state.panelHistory.pop()!;
               state.activePanel = prev as any;
               setStatus(`Panel: ${prev.toUpperCase()} (back)`);
             } else {
               cycleTab(-1);
             }
           } else {
             pushPanelHistory(state.activePanel === 'grid' ? 'cpu' : state.activePanel);
             cycleTab(1);
           }
           break;
         case 'up':
           if (state.inputMode === 'command-palette') {
             state.paletteIndex = Math.max(0, state.paletteIndex - 1);
             render();
             return;
           }
           if (state.lastData?.processes?.length) {
             state.trackedPid = null;
             state.processSelectionIndex = Math.max(0, state.processSelectionIndex - 1);
             render();
           }
           break;
         case 'down':
           if (state.inputMode === 'command-palette') {
             state.paletteIndex = Math.min(state.paletteFilteredCommands.length - 1, state.paletteIndex + 1);
             render();
             return;
           }
           if (state.lastData?.processes?.length) {
             state.trackedPid = null;
             const count = state.lastData.processes.length;
             state.processSelectionIndex = Math.min(count - 1, state.processSelectionIndex + 1);
             render();
           }
           break;
         case 'space':
         case ' ':
           if (state.lastData?.processes?.length && state.processSelectionIndex >= 0) {
             const sorted = state.lastData.processes;
             const proc = sorted[state.processSelectionIndex];
             if (proc) {
               if (state.trackedPid === proc.pid) {
                 state.trackedPid = null;
                 setStatus(`Stopped following PID ${proc.pid}`);
               } else {
                 state.trackedPid = proc.pid;
                 setStatus(`Following PID ${proc.pid} (${proc.command})`);
               }
               render();
             }
           }
           break;
         case 'return':
         case 'enter':
           if (state.inputMode === 'command-palette') {
             executePaletteCommand();
             return;
           }
           if (state.inputMode === 'bookmark-save') {
             saveBookmark();
             return;
           }
           if (state.inspectingProcess) {
             state.inspectingProcess = null;
             render();
           } else if (state.lastData?.processes?.length && state.processSelectionIndex >= 0) {
             const sorted = state.lastData.processes;
             const proc = sorted[state.processSelectionIndex];
             if (proc) {
               state.inspectingProcess = proc;
               state.trackedPid = proc.pid;
               setStatus(`Inspecting & following PID ${proc.pid}`);
               render();
             }
           }
           break;
         case 'escape':
         case 'esc':
           if (state.inputMode === 'quick-ref' || state.inputMode === 'command-palette' || state.inputMode === 'bookmark-save') {
             state.inputMode = null;
             state.inputBuffer = '';
             render();
             return;
           }
           if (state.inspectingProcess) {
             state.inspectingProcess = null;
             render();
           } else if (state.trackedPid !== null) {
             state.trackedPid = null;
             setStatus('Stopped following process');
             render();
           } else if (state.activePanel !== 'grid') {
             state.activePanel = 'grid';
             setStatus('Grid view');
             render();
           } else {
             state.inputMode = 'menu';
             state.menuSelectionIndex = 0;
             render();
           }
           break;
         default:
           if (str && str.length === 1) {
             if (state.inputMode === 'command-palette' || state.inputMode === 'bookmark-save') {
               state.inputBuffer += str;
               if (state.inputMode === 'command-palette') {
                 updatePaletteFilter();
               }
               render();
               return;
             }
             const tabId = tabKeyToId(str);
             if (tabId) {
               pushPanelHistory(tabId);
               state.activePanel = tabId as ActivePanel;
               setStatus(`Panel: ${tabId.toUpperCase()}`);
               render();
             }
           }
      }
    };

    process.stdin.on('keypress', state.keypressHandler);
    process.once('SIGINT', () => stopLive());
  }

  function tabKeyToId(str: string): ActivePanel | null {
    const map: Record<string, ActivePanel> = { '1': 'cpu', '2': 'mem', '3': 'gpu', '4': 'power', '5': 'battery', '6': 'thermal', '7': 'network', '8': 'packets', '9': 'tasks', '0': 'disk', 'p': 'process', 'C': 'containers', 'r': 'p2p', 'A': 'anomalies', 'B': 'blender' };
    return map[str] ?? null;
  }

  function saveBookmark() {
    const name = state.inputBuffer.trim() || `view-${state.bookmarks.length + 1}`;
    const bookmark = {
      name,
      activePanel: state.activePanel,
      sortMode: state.sortMode,
      processFilter: state.processFilter,
      treeView: state.treeView,
      showGraphs: state.showGraphs,
      graphMode: state.graphMode,
      trackedPid: state.trackedPid,
      currentTheme: state.currentTheme,
      panelLayout: [...state.panelLayout],
      detailed: state.detailed,
    };
    state.bookmarks.push(bookmark);
    state.inputMode = null;
    state.inputBuffer = '';
    setStatus(`Bookmark saved: "${name}" (${state.bookmarks.length} total)`);
    invalidateTableCache();
    render();
  }

  function recallNextBookmark() {
    if (state.bookmarks.length === 0) {
      setStatus('No bookmarks saved. Press Shift+M to save current view.');
      return;
    }
    const idx = state.bookmarkRecallIndex % state.bookmarks.length;
    const bm = state.bookmarks[idx];
    state.activePanel = bm.activePanel as typeof state.activePanel;
    state.sortMode = bm.sortMode as typeof state.sortMode;
    state.processFilter = bm.processFilter;
    state.treeView = bm.treeView;
    state.showGraphs = bm.showGraphs;
    state.graphMode = bm.graphMode as typeof state.graphMode;
    state.trackedPid = bm.trackedPid;
    state.currentTheme = bm.currentTheme as typeof state.currentTheme;
    state.panelLayout = [...bm.panelLayout];
    state.detailed = bm.detailed;
    state.bookmarkRecallIndex = (idx + 1) % state.bookmarks.length;
    setStatus(`Recalled bookmark: "${bm.name}"`);
    invalidateTableCache();
    render();
  }

  function executePaletteCommand() {
    const cmds = state.paletteFilteredCommands;
    if (cmds.length === 0 || state.paletteIndex >= cmds.length) {
      state.inputMode = null;
      state.inputBuffer = '';
      state.paletteIndex = 0;
      render();
      return;
    }
    const cmd = cmds[state.paletteIndex];
    state.inputMode = null;
    state.inputBuffer = '';
    state.paletteIndex = 0;

    // Execute the command
    switch (cmd.id) {
      case 'cpu': case 'mem': case 'gpu': case 'power': case 'battery':
      case 'thermal': case 'network': case 'packets': case 'tasks': case 'disk':
      case 'process': case 'containers': case 'p2p': case 'anomalies': case 'blender':
        state.activePanel = state.activePanel === cmd.id ? 'grid' : cmd.id as any;
        setStatus(state.activePanel === 'grid' ? 'Grid view' : `Panel: ${cmd.id.toUpperCase()}`);
        break;
      case 'grid':
        state.activePanel = 'grid';
        setStatus('Grid view');
        break;
      case 'graph-toggle':
        state.showGraphs = !state.showGraphs;
        setStatus(state.showGraphs ? 'Graphs shown' : 'Graphs hidden');
        break;
      case 'graph-mode':
        state.graphMode = state.graphMode === 'spark' ? 'bar' : 'spark';
        setStatus(`Graph mode: ${state.graphMode}`);
        break;
      case 'pause':
        state.paused = !state.paused;
        setStatus(state.paused ? 'Paused' : 'Resumed');
        break;
      case 'detailed':
        state.detailed = !state.detailed;
        setStatus(`Detailed sensor mode: ${state.detailed ? 'on' : 'off'}`);
        break;
      case 'tree':
        state.treeView = !state.treeView;
        setStatus(state.treeView ? 'Tree view' : 'Flat view');
        break;
      case 'temp-unit':
        state.tempUnit = state.tempUnit === 'c' ? 'f' : 'c';
        setStatus(`Temperature unit: ${state.tempUnit.toUpperCase()}`);
        invalidateTableCache();
        break;
      case 'filter':
        state.inputMode = 'filter';
        state.inputBuffer = state.processFilter;
        render();
        return;
      case 'sort':
        const sortCycle: SortMode[] = ['cpu', 'mem', 'pid', 'user', 'command', 'state', 'threads', 'runtime'];
        state.sortMode = sortCycle[(sortCycle.indexOf(state.sortMode) + 1) % sortCycle.length];
        setStatus(`Sorting by ${state.sortMode}`);
        break;
      case 'kill':
        state.inputMode = 'kill';
        state.inputBuffer = '';
        render();
        return;
      case 'signal':
        state.inputMode = 'signal';
        state.inputBuffer = 'SIGTERM';
        render();
        return;
      case 'export':
        exportSnapshot();
        render();
        return;
      case 'log':
        toggleLogging();
        render();
        return;
      case 'format-cycle': {
        const fmtCycle: ExportFormat[] = ['json', 'csv', 'tsv', 'html', 'md'];
        state.exportFormat = fmtCycle[(fmtCycle.indexOf(state.exportFormat) + 1) % fmtCycle.length];
        setStatus(`Export format: ${state.exportFormat}`);
        break;
      }
      case 'interval-inc':
        state.interval += 1;
        restartTicker();
        setStatus(`Interval set to ${state.interval}s`);
        break;
      case 'interval-dec':
        state.interval = Math.max(1, state.interval - 1);
        restartTicker();
        setStatus(`Interval set to ${state.interval}s`);
        break;
      case 'customize':
        state.inputMode = 'customizer';
        state.customizerIndex = 0;
        render();
        return;
      case 'ai-model':
        state.inputMode = 'ai-model';
        state.modelSelectionIndex = Math.max(0, AVAILABLE_AI_MODELS.findIndex(m => m.id === state.aiModel));
        render();
        return;
      case 'bookmark-save':
        state.inputMode = 'bookmark-save';
        state.inputBuffer = '';
        render();
        return;
      case 'bookmark-recall':
        recallNextBookmark();
        render();
        return;
      case 'zoom-in':
        state.graphZoomLevel = Math.max(1, state.graphZoomLevel - 1);
        state.history.setMaxLen(Math.max(20, 40 * state.graphZoomLevel));
        setStatus(`History zoom: ${state.graphZoomLevel}x (${state.history.maxLen} points)`);
        break;
      case 'zoom-out':
        state.graphZoomLevel = Math.min(5, state.graphZoomLevel + 1);
        state.history.setMaxLen(Math.max(20, 40 * state.graphZoomLevel));
        setStatus(`History zoom: ${state.graphZoomLevel}x (${state.history.maxLen} points)`);
        break;
      case 'quick-ref':
        state.inputMode = state.inputMode === 'quick-ref' ? null : 'quick-ref';
        render();
        return;
    }
    invalidateTableCache();
    render();
  }

  function updatePaletteFilter() {
    const q = state.inputBuffer.toLowerCase().trim();
    if (!q) {
      state.paletteFilteredCommands = [...PALETTE_COMMANDS];
    } else {
      state.paletteFilteredCommands = PALETTE_COMMANDS.filter(cmd =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.keys.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q)
      );
    }
    state.paletteIndex = Math.max(0, Math.min(state.paletteIndex, state.paletteFilteredCommands.length - 1));
  }

  function cycleTab(direction: number) {
    const tabs = state.PANEL_TABS.map(t => t.id) as string[];
    const visibleTabs = tabs.filter(id => state.visiblePanels[id as keyof VisibleItems] !== false);
    const current = state.activePanel === 'grid' ? -1 : visibleTabs.indexOf(state.activePanel);
    const next = current === -1 ? 0 : (current + direction + visibleTabs.length) % visibleTabs.length;
    const prev = state.activePanel === 'grid' ? null : state.activePanel;
    state.activePanel = visibleTabs[next] as typeof state.activePanel;
    if (prev && prev !== state.activePanel) {
      pushPanelHistory(prev);
    }
    setStatus(`Panel: ${state.activePanel.toUpperCase()}`);
    render();
  }

  function pushPanelHistory(panelId: string) {
    const last = state.panelHistory.length > 0 ? state.panelHistory[state.panelHistory.length - 1] : null;
    if (panelId !== last) {
      state.panelHistory.push(panelId);
      if (state.panelHistory.length > 20) state.panelHistory.shift();
    }
  }

  function handleNormalMouse(seq: string) {
    if (seq.length < 6) return;
    const cb = seq.charCodeAt(3) - 32;
    const cx = seq.charCodeAt(4) - 32;
    const cy = seq.charCodeAt(5) - 32;
    if (cb === 0 || cb === 1) {
      handleMouseClick(cy, cx);
    } else if (cb === 64) {
      // scroll up
      scrollProcessSelection(-1);
    } else if (cb === 65) {
      // scroll down
      scrollProcessSelection(1);
    }
  }

  function handleSGRMouse(seq: string) {
    const match = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (!match) return;
    const button = parseInt(match[1]);
    const cx = parseInt(match[2]) - 1;
    const cy = parseInt(match[3]) - 1;
    if (button === 0 || button === 1) {
      handleMouseClick(cy, cx);
    } else if (button === 64) {
      scrollProcessSelection(-1);
    } else if (button === 65) {
      scrollProcessSelection(1);
    }
  }

  function scrollProcessSelection(dir: number) {
    if (state.lastData?.processes?.length) {
      state.trackedPid = null;
      const count = state.lastData.processes.length;
      state.processSelectionIndex = Math.max(0, Math.min(count - 1, state.processSelectionIndex + dir));
      render();
    }
  }

  function handleMouseClick(y: number, x: number) {
    if (y !== TAB_BAR_ROW) return;
    const hitboxes = getTabHitboxes(state.visiblePanels);
    const hit = hitboxes.find(h => x >= h.start && h.end > x);
    if (hit) {
      state.activePanel = state.activePanel === hit.id ? 'grid' : (hit.id as typeof state.activePanel);
      setStatus(state.activePanel === 'grid' ? 'Grid view' : `Panel: ${hit.id.toUpperCase()}`);
      render();
    }
  }

  export function stopLive() {
    persistConfig();
    if (state.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
    if (state.uiIntervalHandle) {
      clearInterval(state.uiIntervalHandle);
      state.uiIntervalHandle = null;
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
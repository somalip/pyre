/**
 * pyre config file module.
 *
 * Reads and writes `~/.config/pyre/config.json` to persist
 * user preferences across sessions.
 *
 * The config file stores theme, interval, panel visibility,
 * sort mode, tree view, graph mode, alert thresholds, P2P
 * defaults, export directory, and splash preferences.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'pyre');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface PyreConfig {
  theme?: string;
  interval?: number;
  exportDir?: string;
  detailed?: boolean;
  sortMode?: string;
  treeView?: boolean;
  graphMode?: string;
  showGraphs?: boolean;
  autoLog?: boolean;
   mouseEnabled?: boolean;
  cpuAlertPct?: number;
  tempAlertC?: number;
  notificationsEnabled?: boolean;
  p2pPort?: number;
  p2pPassword?: string;
  splashEnabled?: boolean;
  splashColorScheme?: string;
  splashAnimation?: string;
  visiblePanels?: {
    cpu?: boolean;
    mem?: boolean;
    gpu?: boolean;
    power?: boolean;
    battery?: boolean;
    thermal?: boolean;
    network?: boolean;
    packets?: boolean;
    tasks?: boolean;
    disk?: boolean;
    process?: boolean;
    tree?: boolean;
  };
}

export const DEFAULT_CONFIG: Required<PyreConfig> = {
  theme: 'default',
  interval: 2,
  exportDir: './pyre-exports',
  detailed: false,
  sortMode: 'cpu',
  treeView: false,
  graphMode: 'spark',
  showGraphs: true,
  autoLog: false,
  mouseEnabled: true,
  cpuAlertPct: 90,
  tempAlertC: 95,
  notificationsEnabled: true,
  p2pPort: 9876,
  p2pPassword: 'pyre',
  splashEnabled: true,
  splashColorScheme: 'fire',
  splashAnimation: 'classic',
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
    tree: false,
  },
};

export function readConfig(): Required<PyreConfig> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PyreConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: Partial<PyreConfig>): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const merged = deepMerge(readConfig(), config);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n');
  } catch {
    // ignore write errors
  }
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined && source[key] !== null) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export { CONFIG_FILE };

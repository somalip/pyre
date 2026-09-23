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
  electricityRateKwH?: number;
  notificationsEnabled?: boolean;
  p2pPort?: number;
  p2pPassword?: string;
  splashEnabled?: boolean;
  splashColorScheme?: string;
  splashAnimation?: string;
  watchdogProcess?: string;
  watchdogCpu?: number;
  watchdogMem?: number;
  webhookUrl?: string;
  alertCmd?: string;
  /** Slack incoming webhook URL for alert notifications */
  slackAlertUrl?: string;
  /** Discord webhook URL for alert notifications */
  discordAlertUrl?: string;
  /** Pushover application token for alert notifications */
  pushoverToken?: string;
  /** Pushover user key for alert notifications */
  pushoverUser?: string;
  /** ntfy.sh topic URL (e.g. https://ntfy.sh/my-pyre-alerts) for alert notifications */
  ntfyUrl?: string;
  /** AI backend: 'builtin' (heuristic / rule-based), 'ollama', or 'openai' */
  aiBackend?: string;
  /** Selected AI model identifier */
  aiModel?: string;
  /** Optional API key for external cloud providers */
  aiApiKey?: string;
  dockerModeConfirmed?: boolean;
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
    containers?: boolean;
    blender?: boolean;
    tree?: boolean;
  };
  panelLayout?: string[];
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
  electricityRateKwH: 0.15,
  watchdogProcess: '',
  watchdogCpu: 80,
  watchdogMem: 80,
  notificationsEnabled: true,
  p2pPort: 9876,
  p2pPassword: 'pyre',
  splashEnabled: true,
  splashColorScheme: 'fire',
  splashAnimation: 'classic',
  webhookUrl: '',
  alertCmd: '',
  slackAlertUrl: '',
  discordAlertUrl: '',
  pushoverToken: '',
  pushoverUser: '',
  ntfyUrl: '',
  aiBackend: 'builtin',
  aiModel: 'expert-rules-v1',
  aiApiKey: '',
  dockerModeConfirmed: false,
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
    containers: true,
    blender: true,
    tree: false,
  },
  panelLayout: ['mem', 'disk', 'net'],
};

export function getConfigDir(): string {
  return process.env.PYRE_CONFIG_DIR || path.join(os.homedir(), '.config', 'pyre');
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getProfilesDir(): string {
  return path.join(getConfigDir(), 'profiles');
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_FILE = getConfigFile();
export const PROFILES_DIR = getProfilesDir();

export function readConfig(): Required<PyreConfig> {
  try {
    const file = getConfigFile();
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PyreConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: Partial<PyreConfig>): void {
  try {
    const dir = getConfigDir();
    const file = getConfigFile();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const merged = deepMerge(readConfig(), config);
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  } catch {
    // ignore write errors
  }
}

export function saveProfile(name: string): void {
  if (!name || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid profile name.');
  }
  const profilesDir = getProfilesDir();
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  const currentConfig = readConfig();
  const profileFile = path.join(profilesDir, `${name}.json`);
  fs.writeFileSync(profileFile, JSON.stringify(currentConfig, null, 2) + '\n');
}

export function loadProfile(name: string): void {
  const profilesDir = getProfilesDir();
  const profileFile = path.join(profilesDir, `${name}.json`);
  if (!fs.existsSync(profileFile)) {
    throw new Error(`Profile '${name}' does not exist.`);
  }
  const raw = fs.readFileSync(profileFile, 'utf-8');
  const parsed = JSON.parse(raw);
  // Atomic write to main config
  writeConfig(parsed);
}

export function listProfiles(): string[] {
  const profilesDir = getProfilesDir();
  if (!fs.existsSync(profilesDir)) return [];
  const files = fs.readdirSync(profilesDir);
  return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
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
  return getConfigFile();
}


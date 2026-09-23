/**
 * pyre Plugin System.
 *
 * Discovers and executes custom user-authored metric collectors from
 * ~/.config/pyre/plugins/*.js (or .mjs).
 *
 * Plugin contract:
 * export default {
 *   name: 'my-metric',
 *   title: 'My Custom Metric',
 *   intervalSec: 5, // optional refresh interval
 *   collect: async () => {
 *     return {
 *       title: 'Custom Title', // optional override
 *       lines: ['Metric 1: 42', 'Status: OK']
 *     };
 *   }
 * };
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getConfigDir } from '../state/config.js';

export interface PyrePluginOutput {
  title?: string;
  lines: string[];
}

export interface PyrePlugin {
  name: string;
  title?: string;
  intervalSec?: number;
  collect: () => Promise<PyrePluginOutput | string[] | Record<string, any>>;
}

export interface LoadedPlugin {
  plugin: PyrePlugin;
  lastRun: number;
  lastOutput: PyrePluginOutput;
  error?: string;
}

const loadedPlugins: Map<string, LoadedPlugin> = new Map();

export function getPluginsDir(): string {
  return path.join(getConfigDir(), 'plugins');
}

export async function loadPlugins(): Promise<Map<string, LoadedPlugin>> {
  const pluginsDir = getPluginsDir();
  if (!fs.existsSync(pluginsDir)) {
    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
    } catch {
      return loadedPlugins;
    }
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
  } catch {
    return loadedPlugins;
  }

  for (const file of files) {
    const filePath = path.join(pluginsDir, file);
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(`${fileUrl}?t=${Date.now()}`);
      const plugin: PyrePlugin = mod.default || mod;
      if (plugin && typeof plugin.collect === 'function') {
        const name = plugin.name || path.basename(file, path.extname(file));
        if (!loadedPlugins.has(name)) {
          loadedPlugins.set(name, {
            plugin: { ...plugin, name },
            lastRun: 0,
            lastOutput: { title: plugin.title || name, lines: ['Collecting...'] },
          });
        }
      }
    } catch (err: any) {
      const name = path.basename(file, path.extname(file));
      loadedPlugins.set(name, {
        plugin: { name, collect: async () => ({ lines: [`Error loading plugin: ${err.message}`] }) },
        lastRun: Date.now(),
        lastOutput: { title: name, lines: [`Failed to load: ${err.message}`] },
        error: err.message,
      });
    }
  }

  return loadedPlugins;
}

export async function executePlugins(): Promise<LoadedPlugin[]> {
  const now = Date.now();
  const results: LoadedPlugin[] = [];

  for (const [, item] of loadedPlugins.entries()) {
    const intervalMs = (item.plugin.intervalSec || 5) * 1000;
    if (now - item.lastRun >= intervalMs) {
      try {
        const raw = await Promise.race([
          item.plugin.collect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (5s)')), 5000)),
        ]);

        let output: PyrePluginOutput;
        if (Array.isArray(raw)) {
          output = { title: item.plugin.title || item.plugin.name, lines: raw.map(String) };
        } else if (raw && typeof raw === 'object' && Array.isArray((raw as any).lines)) {
          output = {
            title: (raw as any).title || item.plugin.title || item.plugin.name,
            lines: (raw as any).lines.map(String),
          };
        } else if (raw && typeof raw === 'object') {
          output = {
            title: item.plugin.title || item.plugin.name,
            lines: Object.entries(raw).map(([k, v]) => `${k}: ${v}`),
          };
        } else {
          output = { title: item.plugin.title || item.plugin.name, lines: [String(raw)] };
        }

        item.lastOutput = output;
        item.lastRun = now;
        item.error = undefined;
      } catch (err: any) {
        item.lastOutput = {
          title: item.plugin.title || item.plugin.name,
          lines: [`Execution error: ${err.message}`],
        };
        item.error = err.message;
        item.lastRun = now;
      }
    }
    results.push(item);
  }

  return results;
}

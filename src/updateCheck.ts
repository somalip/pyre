import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import chalk from 'chalk';

const UPDATE_CACHE_FILE = path.join(os.homedir(), '.config', 'pyre', 'update-check.json');

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

export function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult | null> {
  return new Promise((resolve) => {
    try {
      if (fs.existsSync(UPDATE_CACHE_FILE)) {
        const raw = fs.readFileSync(UPDATE_CACHE_FILE, 'utf-8');
        const cached = JSON.parse(raw);
        // Check once every 24 hours
        if (Date.now() - (cached.lastChecked || 0) < 24 * 60 * 60 * 1000) {
          return resolve({
            currentVersion,
            latestVersion: cached.latestVersion || currentVersion,
            hasUpdate: isNewerVersion(currentVersion, cached.latestVersion),
          });
        }
      }
    } catch {
      // ignore cache errors
    }

    const req = https.get('https://registry.npmjs.org/pyre-cli/latest', { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const data = JSON.parse(body);
            const latestVersion = data.version || currentVersion;
            fs.mkdirSync(path.dirname(UPDATE_CACHE_FILE), { recursive: true });
            fs.writeFileSync(UPDATE_CACHE_FILE, JSON.stringify({ lastChecked: Date.now(), latestVersion }));
            return resolve({
              currentVersion,
              latestVersion,
              hasUpdate: isNewerVersion(currentVersion, latestVersion),
            });
          }
        } catch {
          // ignore parse errors
        }
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isNewerVersion(current: string, latest?: string): boolean {
  if (!latest) return false;
  const cParts = current.split('.').map(n => parseInt(n, 10));
  const lParts = latest.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(cParts.length, lParts.length); i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export async function printUpdateReport(currentVersion: string): Promise<void> {
  console.log(chalk.bold('\n  pyre update — Version Check\n'));
  console.log(`  Current Version: ${chalk.bold(currentVersion)}`);
  
  const result = await checkForUpdates(currentVersion);
  if (!result) {
    console.log(chalk.yellow('  ⚠ Unable to reach npm registry for update check.\n'));
    return;
  }

  if (result.hasUpdate) {
    console.log(chalk.green.bold(`  🚀 A new version of pyre is available: v${result.latestVersion}`));
    console.log(chalk.dim(`  Run "npm install -g pyre-cli" to update.\n`));
  } else {
    console.log(chalk.green(`  ✔ You are running the latest version of pyre (v${currentVersion}).\n`));
  }
}

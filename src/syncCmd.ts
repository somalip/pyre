/**
 * pyre sync — Cloud Configuration & Anomaly History Sync.
 *
 * Synchronizes configuration profiles (~/.config/pyre/profiles/),
 * alert rules, thresholds, and anomaly history across multiple Macs
 * via iCloud Drive or any user-defined sync folder.
 *
 * Commands:
 *   pyre sync status
 *   pyre sync push
 *   pyre sync pull
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { getConfigDir, getConfigFile, getProfilesDir, readConfig, writeConfig } from './state/config.js';

export interface SyncOptions {
  syncDir?: string;
  force?: boolean;
}

interface SyncManifest {
  version: number;
  lastUpdated: string;
  sourceHost: string;
  checksum: string;
  profilesCount: number;
}

function getDefaultSyncDir(): string {
  if (process.env.PYRE_SYNC_DIR) return process.env.PYRE_SYNC_DIR;

  // macOS native iCloud Drive path
  const icloudPath = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'PyreSync');
  if (fs.existsSync(path.dirname(icloudPath))) {
    return icloudPath;
  }

  // Fallback to cross-platform standard shared folder
  return path.join(os.homedir(), '.pyre-sync');
}

function computeDirChecksum(dirPath: string): string {
  const hash = crypto.createHash('sha256');
  if (!fs.existsSync(dirPath)) return '';

  const files = fs.readdirSync(dirPath).sort();
  for (const file of files) {
    const full = path.join(dirPath, file);
    if (fs.statSync(full).isFile()) {
      hash.update(file);
      hash.update(fs.readFileSync(full));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

export async function runSyncCommand(subcommand: string = 'status', opts: SyncOptions = {}): Promise<void> {
  const syncDir = opts.syncDir || getDefaultSyncDir();
  const manifestPath = path.join(syncDir, 'sync-manifest.json');
  const remoteProfilesDir = path.join(syncDir, 'profiles');
  const remoteConfigFile = path.join(syncDir, 'config.json');

  const localProfilesDir = getProfilesDir();
  const localConfigFile = getConfigFile();

  console.log(chalk.bold('\n  🔥 pyre sync — Configuration & Profile Cloud Sync\n'));
  console.log(`  Sync Target Directory: ${chalk.cyan(syncDir)}`);

  if (subcommand === 'status' || !subcommand) {
    const hasSyncDir = fs.existsSync(syncDir);
    const hasManifest = fs.existsSync(manifestPath);

    console.log(`  Local Profiles:        ${chalk.bold(String(fs.existsSync(localProfilesDir) ? fs.readdirSync(localProfilesDir).filter(f => f.endsWith('.json')).length : 0))}`);
    console.log(`  Sync Target Available: ${hasSyncDir ? chalk.green('YES') : chalk.yellow('NO (will be created on push)')}`);

    if (hasManifest) {
      try {
        const manifest: SyncManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        console.log(`  Remote Last Updated:   ${chalk.green(manifest.lastUpdated)} (from ${chalk.bold(manifest.sourceHost)})`);
        console.log(`  Remote Profiles Count: ${chalk.bold(String(manifest.profilesCount))}`);
        console.log(`  Remote Checksum:       ${chalk.dim(manifest.checksum)}`);
      } catch {
        console.log(chalk.yellow('  Remote manifest corrupted.'));
      }
    } else {
      console.log(chalk.dim('  No remote sync bundle detected yet. Run "pyre sync push" to initialize.'));
    }
    console.log();
    return;
  }

  if (subcommand === 'push') {
    if (!fs.existsSync(syncDir)) {
      fs.mkdirSync(syncDir, { recursive: true });
    }
    if (!fs.existsSync(remoteProfilesDir)) {
      fs.mkdirSync(remoteProfilesDir, { recursive: true });
    }

    // 1. Sync config.json
    if (fs.existsSync(localConfigFile)) {
      fs.copyFileSync(localConfigFile, remoteConfigFile);
    }

    // 2. Sync profiles/
    let profileCount = 0;
    if (fs.existsSync(localProfilesDir)) {
      const files = fs.readdirSync(localProfilesDir).filter(f => f.endsWith('.json'));
      profileCount = files.length;
      for (const f of files) {
        fs.copyFileSync(path.join(localProfilesDir, f), path.join(remoteProfilesDir, f));
      }
    }

    // 3. Write manifest
    const checksum = computeDirChecksum(remoteProfilesDir);
    const manifest: SyncManifest = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      sourceHost: os.hostname(),
      checksum,
      profilesCount: profileCount,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(chalk.green(`  ✔ Successfully pushed config and ${profileCount} profile(s) to sync target.`));
    console.log(`  Checksum: ${chalk.dim(checksum)}  |  Timestamp: ${chalk.dim(manifest.lastUpdated)}\n`);
    return;
  }

  if (subcommand === 'pull') {
    if (!fs.existsSync(manifestPath) || !fs.existsSync(remoteConfigFile)) {
      console.error(chalk.red(`  ✖ Error: No sync manifest found at ${syncDir}. Run "pyre sync push" first from another machine.\n`));
      process.exit(1);
    }

    // 1. Pull config.json
    if (fs.existsSync(remoteConfigFile)) {
      const remoteConfig = JSON.parse(fs.readFileSync(remoteConfigFile, 'utf-8'));
      writeConfig(remoteConfig);
    }

    // 2. Pull profiles
    let pulledCount = 0;
    if (fs.existsSync(remoteProfilesDir)) {
      if (!fs.existsSync(localProfilesDir)) {
        fs.mkdirSync(localProfilesDir, { recursive: true });
      }
      const files = fs.readdirSync(remoteProfilesDir).filter(f => f.endsWith('.json'));
      pulledCount = files.length;
      for (const f of files) {
        fs.copyFileSync(path.join(remoteProfilesDir, f), path.join(localProfilesDir, f));
      }
    }

    console.log(chalk.green(`  ✔ Successfully pulled latest configuration and ${pulledCount} profile(s).`));
    console.log(chalk.dim(`  Applied to ${localConfigFile}\n`));
    return;
  }

  console.log(chalk.yellow(`  Unknown subcommand: "${subcommand}". Available: status, push, pull\n`));
}

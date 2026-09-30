/**
 * pyre sync — Cloud Configuration & Anomaly History Sync.
 *
 * Synchronizes configuration profiles (~/.config/pyre/profiles/),
 * alert rules, thresholds, and anomaly history across multiple Macs
 * via iCloud Drive / any user-defined sync folder, OR via Firebase Firestore.
 *
 * Commands:
 *   pyre sync status
 *   pyre sync push
 *   pyre sync pull [hostname]
 *   pyre sync firebase <enable|disable|status>
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import chalk from 'chalk';
import {
  getConfigDir,
  getConfigFile,
  getProfilesDir,
  readConfig,
  writeConfig,
  PyreConfig,
} from './state/config.js';

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

// ─── Load profiles from disk ──────────────────────────────────────────────────

function loadLocalProfiles(): Record<string, PyreConfig> {
  const profilesDir = getProfilesDir();
  const profiles: Record<string, PyreConfig> = {};
  if (!fs.existsSync(profilesDir)) return profiles;
  for (const f of fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'))) {
    try {
      const name = f.replace(/\.json$/, '');
      profiles[name] = JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf-8'));
    } catch { /* skip corrupted profiles */ }
  }
  return profiles;
}

function saveLocalProfiles(profiles: Record<string, PyreConfig>): void {
  const profilesDir = getProfilesDir();
  if (!fs.existsSync(profilesDir)) fs.mkdirSync(profilesDir, { recursive: true });
  for (const [name, cfg] of Object.entries(profiles)) {
    fs.writeFileSync(path.join(profilesDir, `${name}.json`), JSON.stringify(cfg, null, 2) + '\n');
  }
}

// ─── Firebase subcommand ──────────────────────────────────────────────────────

async function runFirebaseSubcommand(action: string): Promise<void> {
  const config = readConfig();

  if (action === 'enable') {
    writeConfig({ firebaseSyncEnabled: true });
    console.log(chalk.green('  ✔ Firebase sync enabled.'));
    console.log(chalk.dim('  Run "pyre sync push" to upload your config and profiles to Firestore.\n'));
    return;
  }

  if (action === 'disable') {
    writeConfig({ firebaseSyncEnabled: false });
    console.log(chalk.yellow('  ✔ Firebase sync disabled. Falling back to local folder sync.\n'));
    return;
  }

  if (action === 'status' || !action) {
    console.log(chalk.bold(`  Firebase Sync: ${config.firebaseSyncEnabled ? chalk.green('ENABLED') : chalk.dim('DISABLED')}`));
    if (!config.firebaseSyncEnabled) {
      console.log(chalk.dim('  Run "pyre sync firebase enable" to activate.\n'));
      return;
    }
    const { firebaseStatus } = await import('./firebaseSync.js');
    const hosts = await firebaseStatus();
    if (hosts.length === 0) {
      console.log(chalk.dim('  No remote hosts found in Firestore. Run "pyre sync push" to upload.\n'));
      return;
    }
    console.log();
    for (const h of hosts) {
      console.log(`  ${chalk.bold(h.sourceHost)} (${chalk.cyan(h.hostId)})`);
      console.log(`    Last Updated:  ${chalk.green(h.lastUpdated)}`);
      console.log(`    Profiles:      ${chalk.bold(String(h.profilesCount))}`);
      console.log(`    Checksum:      ${chalk.dim(h.checksum)}\n`);
    }
    return;
  }

  console.log(chalk.yellow(`  Unknown firebase action: "${action}". Available: enable, disable, status\n`));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runSyncCommand(subcommand: string = 'status', opts: SyncOptions = {}): Promise<void> {
  const config = readConfig();

  console.log(chalk.bold('\n  🔥 pyre sync — Configuration & Profile Cloud Sync\n'));

  // ── Firebase subcommand ────────────────────────────────────────────────────
  if (subcommand === 'firebase') {
    const action = process.argv[process.argv.indexOf('firebase') + 1] || 'status';
    await runFirebaseSubcommand(action);
    return;
  }

  // ── Firebase backend ───────────────────────────────────────────────────────
  if (config.firebaseSyncEnabled) {
    console.log(`  Backend: ${chalk.cyan('Firebase Firestore')} (${chalk.dim('dearborn-internal-tool')})`);
    const hostId = config.firebaseHostId || undefined;

    if (subcommand === 'status') {
      const { firebaseStatus } = await import('./firebaseSync.js');
      const hosts = await firebaseStatus();
      if (hosts.length === 0) {
        console.log(chalk.dim('  No remote hosts found. Run "pyre sync push" to upload your config.\n'));
        return;
      }
      console.log();
      for (const h of hosts) {
        console.log(`  ${chalk.bold(h.sourceHost)} (${chalk.cyan(h.hostId)})`);
        console.log(`    Last Updated:  ${chalk.green(h.lastUpdated)}`);
        console.log(`    Profiles:      ${chalk.bold(String(h.profilesCount))}`);
        console.log(`    Checksum:      ${chalk.dim(h.checksum)}\n`);
      }
      return;
    }

    if (subcommand === 'push') {
      const { firebasePush } = await import('./firebaseSync.js');
      const profiles = loadLocalProfiles();
      const result = await firebasePush(config, profiles, hostId);
      const profileCount = Object.keys(profiles).length;
      console.log(chalk.green(`  ✔ Successfully pushed config and ${profileCount} profile(s) to Firestore.`));
      console.log(`  Host ID:   ${chalk.cyan(result.hostId)}`);
      console.log(`  Checksum:  ${chalk.dim(result.checksum)}  |  Timestamp: ${chalk.dim(result.lastUpdated)}\n`);
      return;
    }

    if (subcommand === 'pull') {
      // Optional: pyre sync pull <hostname>
      const targetHost = process.argv[process.argv.indexOf('pull') + 1];
      const resolvedTarget = (targetHost && !targetHost.startsWith('-')) ? targetHost : undefined;

      const { firebasePull } = await import('./firebaseSync.js');
      const result = await firebasePull(resolvedTarget);

      if (!result) {
        const hint = resolvedTarget ? `host "${resolvedTarget}"` : 'any host';
        console.error(chalk.red(`  ✖ No sync data found for ${hint} in Firestore. Run "pyre sync push" from another machine.\n`));
        process.exit(1);
      }

      writeConfig(result.doc.config);
      saveLocalProfiles(result.doc.profiles);

      const pulledCount = result.doc.profilesCount;
      console.log(chalk.green(`  ✔ Successfully pulled config and ${pulledCount} profile(s) from ${chalk.bold(result.doc.sourceHost)}.`));
      console.log(chalk.dim(`  Applied to ${getConfigFile()}\n`));
      return;
    }

    console.log(chalk.yellow(`  Unknown subcommand: "${subcommand}". Available: status, push, pull, firebase\n`));
    return;
  }

  // ── Folder-based backend (original behaviour) ──────────────────────────────
  const syncDir = opts.syncDir || getDefaultSyncDir();
  const manifestPath = path.join(syncDir, 'sync-manifest.json');
  const remoteProfilesDir = path.join(syncDir, 'profiles');
  const remoteConfigFile = path.join(syncDir, 'config.json');

  const localProfilesDir = getProfilesDir();
  const localConfigFile = getConfigFile();

  console.log(`  Backend:             ${chalk.cyan('Local Folder')}`);
  console.log(`  Sync Target:         ${chalk.cyan(syncDir)}`);

  if (subcommand === 'status' || !subcommand) {
    const hasSyncDir = fs.existsSync(syncDir);
    const hasManifest = fs.existsSync(manifestPath);

    console.log(`  Local Profiles:      ${chalk.bold(String(fs.existsSync(localProfilesDir) ? fs.readdirSync(localProfilesDir).filter(f => f.endsWith('.json')).length : 0))}`);
    console.log(`  Sync Target Exists:  ${hasSyncDir ? chalk.green('YES') : chalk.yellow('NO (will be created on push)')}`);

    if (hasManifest) {
      try {
        const manifest: SyncManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        console.log(`  Remote Last Updated: ${chalk.green(manifest.lastUpdated)} (from ${chalk.bold(manifest.sourceHost)})`);
        console.log(`  Remote Profiles:     ${chalk.bold(String(manifest.profilesCount))}`);
        console.log(`  Remote Checksum:     ${chalk.dim(manifest.checksum)}`);
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

  console.log(chalk.yellow(`  Unknown subcommand: "${subcommand}". Available: status, push, pull, firebase\n`));
}

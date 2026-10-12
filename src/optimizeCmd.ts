/**
 * pyre optimize — macOS optimizer.
 *
 * Finds GUI apps that are open but haven't been used recently and quits them
 * gracefully (apps still get their normal "Save changes?" prompt), plus a set
 * of housekeeping tools: memory pressure, caches, trash, startup items, DNS.
 *
 * "Recently used" is determined from two signals:
 *  1. `lsappinfo visibleProcessList` — apps ordered by most-recent activation
 *     (always available, gives a ranking but no timestamps).
 *  2. An optional background tracker (`pyre optimize track`) that polls the
 *     frontmost app and records real last-active timestamps in
 *     ~/.config/pyre/app-usage.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { getConfigDir, readConfig, writeConfig } from './state/config.js';

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunningApp {
  asn: string;
  name: string;
  bundleId: string;
  pid: number;
  /** Launch time (ms since epoch), from lsappinfo "checkin time" */
  launchedAt?: number;
  /** 0 = most recently activated */
  rank: number;
  cpu: number;
  rssKb: number;
  frontmost: boolean;
}

export interface UsageData {
  version: 1;
  /** Start of the current continuous tracking window (ms) */
  trackingSince: number;
  /** Last time the tracker wrote this file (ms) */
  updatedAt: number;
  apps: Record<string, { name: string; lastActive: number }>;
}

export interface SelectContext {
  now: number;
  idleThresholdMs: number;
  keepRecent: number;
  protectedApps: string[];
  selfPids: Set<number>;
  usage?: UsageData | null;
  cpuBusyPct?: number;
}

export interface IdleCandidate {
  app: RunningApp;
  /** Known idle time in ms (only when tracking data is fresh) */
  idleMs?: number;
}

export interface SkippedApp {
  app: RunningApp;
  reason: string;
}

export interface OptimizeOptions {
  idle?: string;
  keep?: string;
  yes?: boolean;
  force?: boolean;
  clean?: boolean;
  empty?: boolean;
  dryRun?: boolean;
  install?: boolean;
  uninstall?: boolean;
  autoQuit?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Apps that are never quit automatically, in addition to user-protected ones. */
export const BUILTIN_PROTECTED = [
  'com.apple.finder',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'dev.warp.Warp-Stable',
  'com.mitchellh.ghostty',
  'net.kovidgoyal.kitty',
  'com.github.wez.wezterm',
  'io.alacritty',
  'com.apple.systempreferences',
];

/** Media apps count as busy at a much lower CPU level (likely playing audio/video). */
const MEDIA_BUNDLES = new Set([
  'com.apple.music',
  'com.spotify.client',
  'com.apple.podcasts',
  'com.apple.tv',
  'com.colliderli.iina',
  'org.videolan.vlc',
]);

const DEFAULT_CPU_BUSY_PCT = 5;
const MEDIA_CPU_BUSY_PCT = 1;
const TRACK_INTERVAL_MS = 5000;
const TRACK_FRESH_MS = 120_000;
const TRACKER_LABEL = 'com.pyre.optimize-tracker';
const TRACKER_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${TRACKER_LABEL}.plist`);

function usageFile(): string {
  return path.join(getConfigDir(), 'app-usage.json');
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

/** Parse "2h", "30m", "90s", "1d", "1.5h". A bare number means minutes. Returns NaN if invalid. */
export function parseDuration(input: string | undefined, fallbackMs: number): number {
  if (input === undefined || input === null || String(input).trim() === '') return fallbackMs;
  const m = String(input).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? 'm';
  if (unit.startsWith('s')) return n * 1000;
  if (unit.startsWith('h')) return n * 3_600_000;
  if (unit.startsWith('d')) return n * 86_400_000;
  return n * 60_000;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatKb(kb: number): string {
  const bytes = kb * 1024;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(kb)} KB`;
}

/** Extract ASNs in order from `lsappinfo visibleProcessList` / `lsappinfo front` output. */
export function parseAsnList(raw: string): string[] {
  const out: string[] = [];
  const re = /ASN:(0x[0-9a-f]+-0x[0-9a-f]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const asn = `ASN:${m[1].toLowerCase()}`;
    if (!out.includes(asn)) out.push(asn);
  }
  return out;
}

/** Parse `lsappinfo list` output, returning only regular (Foreground/Dock) GUI apps. */
export function parseLsappinfoList(raw: string): Omit<RunningApp, 'rank' | 'cpu' | 'rssKb' | 'frontmost'>[] {
  const apps: Omit<RunningApp, 'rank' | 'cpu' | 'rssKb' | 'frontmost'>[] = [];
  const blocks = raw.split(/\r?\n(?=\s*\d+\)\s+")/);
  for (const block of blocks) {
    const header = block.match(/^\s*\d+\)\s+"(.*?)"\s+ASN:(0x[0-9a-f]+-0x[0-9a-f]+):/i);
    if (!header) continue;
    if (!/type="Foreground"/.test(block)) continue;
    const pidMatch = block.match(/\bpid\s*=\s*(\d+)/);
    if (!pidMatch) continue;
    const bundleMatch = block.match(/bundleID="([^"]+)"/);
    const checkin = block.match(/checkin time = (\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    let launchedAt: number | undefined;
    if (checkin) {
      const [, y, mo, d, h, mi, s] = checkin;
      launchedAt = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
    }
    apps.push({
      asn: `ASN:${header[2].toLowerCase()}`,
      name: header[1],
      bundleId: bundleMatch?.[1] ?? '',
      pid: parseInt(pidMatch[1], 10),
      launchedAt,
    });
  }
  return apps;
}

export function isTrackingFresh(usage: UsageData | null | undefined, now: number): boolean {
  return !!usage && now - usage.updatedAt < TRACK_FRESH_MS;
}

/**
 * Conservative idle time: the time since the app was last seen frontmost, where
 * "seen" can be no earlier than the start of continuous tracking or the app's launch.
 */
export function computeIdleMs(app: RunningApp, usage: UsageData | null | undefined, now: number): number | undefined {
  if (app.frontmost) return 0;
  if (!isTrackingFresh(usage, now)) return undefined;
  const last = usage!.apps[app.bundleId]?.lastActive ?? 0;
  const base = Math.max(usage!.trackingSince, app.launchedAt ?? 0);
  return Math.max(0, now - Math.max(last, base));
}

export function isProtected(app: RunningApp, protectedApps: string[]): boolean {
  const list = [...BUILTIN_PROTECTED, ...protectedApps].map(s => s.toLowerCase());
  return list.includes(app.bundleId.toLowerCase()) || list.includes(app.name.toLowerCase());
}

/** Decide which running apps are idle and safe to quit. */
export function selectIdleApps(apps: RunningApp[], ctx: SelectContext): { candidates: IdleCandidate[]; skipped: SkippedApp[] } {
  const candidates: IdleCandidate[] = [];
  const skipped: SkippedApp[] = [];
  const fresh = isTrackingFresh(ctx.usage, ctx.now);
  const busyPct = ctx.cpuBusyPct ?? DEFAULT_CPU_BUSY_PCT;

  for (const app of [...apps].sort((a, b) => a.rank - b.rank)) {
    if (app.frontmost) { skipped.push({ app, reason: 'frontmost' }); continue; }
    if (isProtected(app, ctx.protectedApps)) { skipped.push({ app, reason: 'protected' }); continue; }
    if (ctx.selfPids.has(app.pid)) { skipped.push({ app, reason: 'running pyre' }); continue; }
    if (app.rank < ctx.keepRecent) { skipped.push({ app, reason: `top ${ctx.keepRecent} recent` }); continue; }

    const threshold = MEDIA_BUNDLES.has(app.bundleId.toLowerCase()) ? MEDIA_CPU_BUSY_PCT : busyPct;
    if (app.cpu >= threshold) { skipped.push({ app, reason: `busy (${app.cpu.toFixed(1)}% CPU)` }); continue; }

    if (app.launchedAt && ctx.now - app.launchedAt < ctx.idleThresholdMs) {
      skipped.push({ app, reason: `launched ${formatDuration(ctx.now - app.launchedAt)} ago` });
      continue;
    }

    if (fresh) {
      const idleMs = computeIdleMs(app, ctx.usage, ctx.now)!;
      if (idleMs < ctx.idleThresholdMs) { skipped.push({ app, reason: `used ${formatDuration(idleMs)} ago` }); continue; }
      candidates.push({ app, idleMs });
    } else {
      candidates.push({ app });
    }
  }
  return { candidates, skipped };
}

// ─── System helpers ─────────────────────────────────────────────────────────

async function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    // Many tools (du, plutil) exit non-zero on partial failure but still print useful output.
    return typeof err?.stdout === 'string' ? err.stdout : '';
  }
}

export async function listRunningApps(): Promise<RunningApp[]> {
  const [listRaw, visibleRaw, frontRaw] = await Promise.all([
    run('lsappinfo', ['list']),
    run('lsappinfo', ['visibleProcessList']),
    run('lsappinfo', ['front']),
  ]);
  const base = parseLsappinfoList(listRaw);
  const order = parseAsnList(visibleRaw);
  const front = parseAsnList(frontRaw)[0];

  const stats = new Map<number, { cpu: number; rss: number }>();
  if (base.length) {
    // One ps call for the whole process table; sum each app's own usage plus its helper/child processes.
    const ps = await run('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=']);
    const children = new Map<number, number[]>();
    const own = new Map<number, { cpu: number; rss: number }>();
    for (const line of ps.split('\n')) {
      const [pid, ppid, cpu, rss] = line.trim().split(/\s+/);
      if (!pid) continue;
      const p = parseInt(pid, 10);
      const pp = parseInt(ppid, 10);
      own.set(p, { cpu: parseFloat(cpu) || 0, rss: parseInt(rss, 10) || 0 });
      if (!children.has(pp)) children.set(pp, []);
      children.get(pp)!.push(p);
    }
    for (const app of base) {
      if (!own.has(app.pid)) continue;
      let cpu = 0;
      let rss = 0;
      const stack = [app.pid];
      const seen = new Set<number>();
      while (stack.length) {
        const p = stack.pop()!;
        if (seen.has(p)) continue;
        seen.add(p);
        const s = own.get(p);
        if (s) { cpu += s.cpu; rss += s.rss; }
        stack.push(...(children.get(p) ?? []));
      }
      stats.set(app.pid, { cpu, rss });
    }
  }

  // Apps missing from the visible list (e.g. hidden with ⌘H) go to the end, oldest launch last.
  const unranked = base.filter(a => !order.includes(a.asn)).sort((a, b) => (b.launchedAt ?? 0) - (a.launchedAt ?? 0));
  return base
    .filter(a => stats.has(a.pid))
    .map(a => {
      const idx = order.indexOf(a.asn);
      const s = stats.get(a.pid)!;
      return {
        ...a,
        rank: idx >= 0 ? idx : order.length + unranked.indexOf(a),
        cpu: s.cpu,
        rssKb: s.rss,
        frontmost: a.asn === front,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** PIDs of this process and all its ancestors (protects the terminal/editor running pyre). */
async function getSelfPids(): Promise<Set<number>> {
  const raw = await run('ps', ['-axo', 'pid=,ppid=']);
  const parent = new Map<number, number>();
  for (const line of raw.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(n => parseInt(n, 10));
    if (pid) parent.set(pid, ppid);
  }
  const set = new Set<number>();
  let cur: number | undefined = process.pid;
  while (cur && cur > 1 && !set.has(cur)) {
    set.add(cur);
    cur = parent.get(cur);
  }
  return set;
}

export function loadUsage(): UsageData | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageFile(), 'utf-8'));
    if (parsed?.version === 1 && parsed.apps) return parsed as UsageData;
  } catch { /* none yet */ }
  return null;
}

function saveUsage(data: UsageData): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true });
    const tmp = usageFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, usageFile());
  } catch { /* ignore */ }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type QuitResult = 'quit' | 'forced' | 'still-open' | 'failed';

/** Ask an app to quit the normal way (same as ⌘Q), optionally SIGTERM if it doesn't. */
export async function quitApp(app: RunningApp, force = false, timeoutMs = 10_000): Promise<QuitResult> {
  const script = `ObjC.import('AppKit');
var a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${Math.trunc(app.pid)});
a.isNil() ? 'gone' : (a.terminate ? 'ok' : 'refused');`;
  const out = (await run('osascript', ['-l', 'JavaScript', '-e', script], 5000)).trim();
  if (out === 'gone') return 'quit';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(app.pid)) return 'quit';
    await sleep(250);
  }
  if (!force) return out === 'ok' || out === 'refused' ? 'still-open' : 'failed';
  try { process.kill(app.pid, 'SIGTERM'); } catch { return isAlive(app.pid) ? 'failed' : 'quit'; }
  await sleep(3000);
  return isAlive(app.pid) ? 'failed' : 'forced';
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase();
  } finally {
    rl.close();
  }
}

async function confirm(question: string, yes?: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const a = await ask(`  ${question} ${chalk.dim('[y/N]')} `);
  return a === 'y' || a === 'yes';
}

function notify(title: string, message: string): void {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  execFile('osascript', ['-e', `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length);
}

function header(title: string): void {
  console.log(chalk.bold(`\n  🔥 pyre optimize — ${title}\n`));
}

// ─── Idle apps ──────────────────────────────────────────────────────────────

interface ResolvedSettings {
  idleMs: number;
  keep: number;
  protectedApps: string[];
}

function resolveSettings(opts: OptimizeOptions): ResolvedSettings {
  const cfg = readConfig();
  const idleMs = parseDuration(opts.idle, parseDuration(cfg.optimizeIdleThreshold, 2 * 3_600_000));
  if (isNaN(idleMs)) {
    console.error(chalk.red(`  ✖ Invalid --idle value "${opts.idle}". Use e.g. 30m, 2h, 1d.`));
    process.exit(1);
  }
  const keepRaw = opts.keep !== undefined ? parseInt(opts.keep, 10) : cfg.optimizeKeepRecent;
  const keep = Number.isFinite(keepRaw) && keepRaw >= 0 ? keepRaw : 5;
  return { idleMs, keep, protectedApps: cfg.optimizeProtectedApps ?? [] };
}

async function analyzeApps(settings: ResolvedSettings) {
  const [apps, selfPids] = await Promise.all([listRunningApps(), getSelfPids()]);
  const usage = loadUsage();
  const now = Date.now();
  const result = selectIdleApps(apps, {
    now,
    idleThresholdMs: settings.idleMs,
    keepRecent: settings.keep,
    protectedApps: settings.protectedApps,
    selfPids,
    usage,
  });
  return { apps, usage, now, fresh: isTrackingFresh(usage, now), ...result };
}

function printCandidates(candidates: IdleCandidate[], fresh: boolean): void {
  console.log(chalk.dim(`  ${pad('App', 28)}${pad(fresh ? 'Idle' : 'Recency', 12)}${pad('RAM', 10)}CPU`));
  for (const c of candidates) {
    const when = c.idleMs !== undefined ? formatDuration(c.idleMs) : `#${c.app.rank + 1}`;
    console.log(`  ${pad(c.app.name, 28)}${chalk.yellow(pad(when, 12))}${pad(formatKb(c.app.rssKb), 10)}${c.app.cpu.toFixed(1)}%`);
  }
  const total = candidates.reduce((s, c) => s + c.app.rssKb, 0);
  console.log(chalk.dim(`\n  ${candidates.length} app(s) using ~${formatKb(total)} RAM`));
}

function trackingHint(fresh: boolean): void {
  if (!fresh) {
    console.log(chalk.dim('  ℹ No live usage tracking. Ranking is based on activation order only.'));
    console.log(chalk.dim('    For real idle times run: ') + chalk.cyan('pyre optimize track --install') + '\n');
  }
}

async function runApps(opts: OptimizeOptions): Promise<void> {
  header('Idle Apps');
  const settings = resolveSettings(opts);
  const { candidates, skipped, fresh } = await analyzeApps(settings);
  trackingHint(fresh);

  console.log(chalk.dim(`  Rules: idle ≥ ${formatDuration(settings.idleMs)}, keep ${settings.keep} most recent, skip busy/protected apps\n`));

  if (skipped.length) {
    console.log(chalk.dim('  Keeping:'));
    for (const s of skipped) console.log(chalk.dim(`    ${pad(s.app.name, 28)}${s.reason}`));
    console.log();
  }

  if (!candidates.length) {
    console.log(chalk.green('  ✔ No idle apps to quit.\n'));
    return;
  }

  console.log(chalk.bold('  Idle apps:'));
  printCandidates(candidates, fresh);
  console.log();

  if (opts.dryRun) {
    console.log(chalk.dim('  Dry run: nothing was quit.\n'));
    return;
  }

  let selected: IdleCandidate[] = [];
  if (opts.yes) {
    selected = candidates;
  } else if (!process.stdin.isTTY) {
    console.log(chalk.yellow('  Not an interactive terminal. Re-run with --yes to quit these apps.\n'));
    return;
  } else {
    const a = await ask(`  Quit these apps? ${chalk.dim('[a]ll / [s]elect / [N]one')} `);
    if (a === 'a' || a === 'all' || a === 'y' || a === 'yes') {
      selected = candidates;
    } else if (a === 's' || a === 'select') {
      for (const c of candidates) {
        if (await confirm(`Quit ${chalk.bold(c.app.name)} (${formatKb(c.app.rssKb)})?`)) selected.push(c);
      }
    }
  }

  if (!selected.length) {
    console.log(chalk.dim('  Nothing quit.\n'));
    return;
  }

  console.log();
  let freed = 0;
  for (const c of selected) {
    process.stdout.write(`  Quitting ${c.app.name}… `);
    const res = await quitApp(c.app, !!opts.force);
    if (res === 'quit' || res === 'forced') {
      freed += c.app.rssKb;
      console.log(res === 'forced' ? chalk.yellow('force-quit') : chalk.green('✔'));
    } else if (res === 'still-open') {
      console.log(chalk.yellow('still open (it may be waiting for you to save; use --force to terminate)'));
    } else {
      console.log(chalk.red('failed'));
    }
  }
  console.log(chalk.green(`\n  ✔ Freed ~${formatKb(freed)} RAM\n`));
}

// ─── Tracker ────────────────────────────────────────────────────────────────

async function frontApp(): Promise<{ bundleId: string; name: string } | null> {
  const asn = parseAsnList(await run('lsappinfo', ['front'], 3000))[0];
  if (!asn) return null;
  const info = await run('lsappinfo', ['info', '-only', 'bundleid', '-only', 'name', asn], 3000);
  const bundleId = info.match(/"CFBundleIdentifier"="([^"]+)"/)?.[1];
  const name = info.match(/"LSDisplayName"="([^"]+)"/)?.[1] ?? bundleId ?? '';
  return bundleId ? { bundleId, name } : null;
}

async function runTracker(opts: OptimizeOptions): Promise<void> {
  if (opts.install) return installTracker(opts);
  if (opts.uninstall) return uninstallTracker();

  const autoQuitMs = opts.autoQuit ? parseDuration(opts.autoQuit, NaN) : undefined;
  if (autoQuitMs !== undefined && (isNaN(autoQuitMs) || autoQuitMs < 60_000)) {
    console.error(chalk.red(`  ✖ Invalid --auto-quit value "${opts.autoQuit}". Use e.g. 2h (minimum 1m).`));
    process.exit(1);
  }

  const now = Date.now();
  let usage = loadUsage();
  if (!usage) {
    usage = { version: 1, trackingSince: now, updatedAt: now, apps: {} };
  } else if (now - usage.updatedAt > TRACK_FRESH_MS) {
    // Gap in tracking: we can't vouch for anything before now.
    usage.trackingSince = now;
  }
  usage.updatedAt = now;
  saveUsage(usage);

  console.log(chalk.bold('\n  🔥 pyre optimize — usage tracker'));
  console.log(chalk.dim(`  Recording frontmost app every ${TRACK_INTERVAL_MS / 1000}s → ${usageFile()}`));
  if (autoQuitMs) console.log(chalk.yellow(`  Auto-quit enabled: apps idle ≥ ${formatDuration(autoQuitMs)} will be asked to quit`));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

  let lastFront = '';
  let lastSave = 0;
  let lastAutoQuit = 0;
  const attempted = new Set<number>();
  const settings = resolveSettings({ ...opts, idle: opts.autoQuit });

  const stop = () => { saveUsage(usage!); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  for (;;) {
    const t = Date.now();
    const front = await frontApp();
    if (front) {
      usage.apps[front.bundleId] = { name: front.name, lastActive: t };
    }
    usage.updatedAt = t;
    const frontKey = front?.bundleId ?? '';
    if (frontKey !== lastFront || t - lastSave > 30_000) {
      saveUsage(usage);
      lastSave = t;
      if (frontKey !== lastFront && process.stdout.isTTY && front) {
        console.log(chalk.dim(`  ${new Date(t).toLocaleTimeString()}  `) + front.name);
      }
      lastFront = frontKey;
    }

    if (autoQuitMs && t - lastAutoQuit > 60_000) {
      lastAutoQuit = t;
      try {
        const { candidates } = await analyzeApps(settings);
        const quitNames: string[] = [];
        for (const c of candidates) {
          if (c.idleMs === undefined || attempted.has(c.app.pid)) continue;
          attempted.add(c.app.pid);
          const res = await quitApp(c.app, false, 8000);
          if (res === 'quit') quitNames.push(c.app.name);
          console.log(`  ${new Date().toLocaleTimeString()}  auto-quit ${c.app.name} (idle ${formatDuration(c.idleMs)}): ${res}`);
        }
        if (quitNames.length) {
          notify('pyre optimize', `Quit ${quitNames.length} idle app(s): ${quitNames.join(', ')}`);
        }
      } catch { /* keep tracking */ }
    }

    await sleep(TRACK_INTERVAL_MS);
  }
}

function installTracker(opts: OptimizeOptions): void {
  const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const args = [process.execPath, path.resolve(process.argv[1]), 'optimize', 'track', '--no-wizard'];
  if (opts.autoQuit) {
    if (isNaN(parseDuration(opts.autoQuit, NaN))) {
      console.error(chalk.red(`  ✖ Invalid --auto-quit value "${opts.autoQuit}".`));
      process.exit(1);
    }
    args.push('--auto-quit', opts.autoQuit);
  }
  const logDir = getConfigDir();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${TRACKER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args.map(a => `        <string>${xml(a)}</string>`).join('\n')}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(path.join(logDir, 'optimize-tracker.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(logDir, 'optimize-tracker.err'))}</string>
</dict>
</plist>
`;
  try {
    fs.mkdirSync(path.dirname(TRACKER_PLIST), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(TRACKER_PLIST, plist);
    spawnSyncQuiet('launchctl', ['unload', TRACKER_PLIST]);
    spawnSyncQuiet('launchctl', ['load', TRACKER_PLIST]);
    console.log(chalk.green(`\n  ✔ Usage tracker installed and started (${TRACKER_LABEL})`));
    if (opts.autoQuit) console.log(chalk.yellow(`  Auto-quit: apps idle ≥ ${opts.autoQuit} will be asked to quit`));
    console.log(chalk.dim(`  Plist: ${TRACKER_PLIST}`));
    console.log(chalk.dim('  Remove with: pyre optimize track --uninstall\n'));
  } catch (err: any) {
    console.log(chalk.red(`  ✖ Failed to install tracker: ${err.message}`));
  }
}

function uninstallTracker(): void {
  if (!fs.existsSync(TRACKER_PLIST)) {
    console.log(chalk.yellow(`\n  No tracker installed at ${TRACKER_PLIST}\n`));
    return;
  }
  spawnSyncQuiet('launchctl', ['unload', TRACKER_PLIST]);
  fs.unlinkSync(TRACKER_PLIST);
  console.log(chalk.green(`\n  ✔ Usage tracker uninstalled\n`));
}

function spawnSyncQuiet(cmd: string, args: string[]): void {
  try {
    spawnSync(cmd, args, { stdio: 'ignore' });
  } catch { /* ignore */ }
}

// ─── Memory ─────────────────────────────────────────────────────────────────

interface MemoryInfo {
  totalBytes: number;
  freePct?: number;
  swapUsedMb?: number;
  swapTotalMb?: number;
  compressedBytes?: number;
  top: { pid: number; name: string; rssKb: number }[];
}

async function collectMemory(): Promise<MemoryInfo> {
  const [pressure, swap, vm, ps] = await Promise.all([
    run('memory_pressure', ['-Q'], 5000),
    run('sysctl', ['-n', 'vm.swapusage']),
    run('vm_stat', []),
    run('ps', ['-axo', 'rss=,pid=,comm=']),
  ]);
  const freePct = pressure.match(/free percentage:\s*(\d+)%/i)?.[1];
  const swapTotal = swap.match(/total = ([\d.]+)M/)?.[1];
  const swapUsed = swap.match(/used = ([\d.]+)M/)?.[1];
  const pageSize = parseInt(vm.match(/page size of (\d+) bytes/)?.[1] ?? '16384', 10);
  const compressedPages = vm.match(/Pages occupied by compressor:\s+(\d+)/)?.[1];

  const top = ps.split('\n')
    .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => ({ rssKb: parseInt(m[1], 10), pid: parseInt(m[2], 10), name: path.basename(m[3]) }))
    .sort((a, b) => b.rssKb - a.rssKb)
    .slice(0, 10);

  return {
    totalBytes: os.totalmem(),
    freePct: freePct ? parseInt(freePct, 10) : undefined,
    swapUsedMb: swapUsed ? parseFloat(swapUsed) : undefined,
    swapTotalMb: swapTotal ? parseFloat(swapTotal) : undefined,
    compressedBytes: compressedPages ? parseInt(compressedPages, 10) * pageSize : undefined,
    top,
  };
}

function pressureLabel(freePct?: number): string {
  if (freePct === undefined) return chalk.dim('unknown');
  if (freePct >= 50) return chalk.green(`normal (${freePct}% free)`);
  if (freePct >= 25) return chalk.yellow(`elevated (${freePct}% free)`);
  return chalk.red(`high (${freePct}% free)`);
}

function printMemorySummary(m: MemoryInfo): void {
  console.log(`  Memory pressure:  ${pressureLabel(m.freePct)}`);
  if (m.swapUsedMb !== undefined) {
    const c = m.swapUsedMb > 2048 ? chalk.yellow : chalk.reset;
    console.log(`  Swap used:        ${c(formatKb(m.swapUsedMb * 1024))}${m.swapTotalMb ? chalk.dim(` / ${formatKb(m.swapTotalMb * 1024)}`) : ''}`);
  }
  if (m.compressedBytes !== undefined) console.log(`  Compressed:       ${formatKb(m.compressedBytes / 1024)}`);
}

async function runMemory(opts: OptimizeOptions): Promise<void> {
  header('Memory');
  const m = await collectMemory();
  console.log(`  Installed RAM:    ${formatKb(m.totalBytes / 1024)}`);
  printMemorySummary(m);
  console.log(chalk.bold('\n  Top memory users:'));
  for (const p of m.top) console.log(`    ${pad(p.name, 32)}${pad(formatKb(p.rssKb), 10)}${chalk.dim(`pid ${p.pid}`)}`);
  console.log();

  if (opts.dryRun) return;
  if (await confirm('Run `sudo purge` to flush inactive file cache? (asks for your password)', opts.yes)) {
    await runInherited('sudo', ['purge']);
    const after = await collectMemory();
    console.log(`\n  After purge:      ${pressureLabel(after.freePct)}\n`);
  }
}

function runInherited(cmd: string, args: string[]): Promise<number> {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', code => resolve(code ?? 1));
    p.on('error', () => resolve(1));
  });
}

// ─── Caches ─────────────────────────────────────────────────────────────────

interface CacheCategory {
  name: string;
  dir: string;
  /** Only delete these children (absolute paths); default = all children of dir */
  children?: string[];
  sizeKb: number;
  note?: string;
}

async function duKb(paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const existing = paths.filter(p => fs.existsSync(p));
  if (!existing.length) return out;
  const raw = await run('du', ['-sk', ...existing], 120_000);
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (m) out.set(m[2], parseInt(m[1], 10));
  }
  return out;
}

async function collectCaches(): Promise<CacheCategory[]> {
  const home = os.homedir();
  const libCaches = path.join(home, 'Library', 'Caches');
  const known: Omit<CacheCategory, 'sizeKb'>[] = [
    { name: 'Xcode DerivedData', dir: path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData') },
    { name: 'Homebrew downloads', dir: path.join(libCaches, 'Homebrew') },
    { name: 'npm cache', dir: path.join(home, '.npm', '_cacache') },
    { name: 'Yarn cache', dir: path.join(libCaches, 'Yarn') },
    { name: 'pnpm store', dir: path.join(home, 'Library', 'pnpm', 'store') },
    { name: 'pip cache', dir: path.join(libCaches, 'pip') },
  ];
  const knownDirs = new Set(known.map(k => k.dir));

  // Other per-app caches: skip Apple system caches and caches of currently running apps.
  const running = new Set((await listRunningApps()).map(a => a.bundleId.toLowerCase()).filter(Boolean));
  let otherChildren: string[] = [];
  let skippedRunning = 0;
  try {
    otherChildren = fs.readdirSync(libCaches)
      .map(n => path.join(libCaches, n))
      .filter(p => {
        const n = path.basename(p).toLowerCase();
        if (knownDirs.has(p) || n.startsWith('com.apple.') || n.startsWith('.')) return false;
        if (running.has(n)) { skippedRunning++; return false; }
        return true;
      });
  } catch { /* unreadable */ }

  const sizes = await duKb([...known.map(k => k.dir), ...otherChildren]);
  const cats: CacheCategory[] = known.map(k => ({ ...k, sizeKb: sizes.get(k.dir) ?? 0 }));
  cats.push({
    name: 'Other app caches',
    dir: libCaches,
    children: otherChildren,
    sizeKb: otherChildren.reduce((s, c) => s + (sizes.get(c) ?? 0), 0),
    note: skippedRunning ? `${skippedRunning} cache(s) of running apps skipped` : undefined,
  });
  return cats;
}

function removeContents(cat: CacheCategory): number {
  let failed = 0;
  let targets: string[] = cat.children ?? [];
  if (!cat.children) {
    try { targets = fs.readdirSync(cat.dir).map(n => path.join(cat.dir, n)); } catch { return 1; }
  }
  for (const t of targets) {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch { failed++; }
  }
  return failed;
}

async function runCaches(opts: OptimizeOptions): Promise<void> {
  header('Caches');
  process.stdout.write(chalk.dim('  Measuring cache sizes…\r'));
  const cats = await collectCaches();
  const total = cats.reduce((s, c) => s + c.sizeKb, 0);
  for (const c of cats) {
    const size = c.sizeKb > 1024 * 1024 ? chalk.yellow(formatKb(c.sizeKb)) : formatKb(c.sizeKb);
    console.log(`  ${pad(c.name, 24)}${pad(size, 12)}${chalk.dim(c.note ?? '')}`);
  }
  console.log(chalk.bold(`\n  Total: ${formatKb(total)}\n`));

  if (!opts.clean) {
    console.log(chalk.dim('  To delete caches: ') + chalk.cyan('pyre optimize caches --clean') + '\n');
    return;
  }
  if (opts.dryRun) { console.log(chalk.dim('  Dry run: nothing was deleted.\n')); return; }
  if (!opts.yes && !process.stdin.isTTY) {
    console.log(chalk.yellow('  Not an interactive terminal. Re-run with --yes to delete.\n'));
    return;
  }

  console.log(chalk.dim('  Tip: quit the related apps first. Caches are rebuilt automatically when needed.\n'));
  let freed = 0;
  for (const c of cats) {
    if (c.sizeKb < 1024) continue;
    if (!(await confirm(`Delete ${c.name} (${formatKb(c.sizeKb)})?`, opts.yes))) continue;
    const failed = removeContents(c);
    const after = c.children ? 0 : (await duKb([c.dir])).get(c.dir) ?? 0;
    freed += Math.max(0, c.sizeKb - after);
    console.log(failed ? chalk.yellow(`    ✔ cleaned (${failed} item(s) could not be removed)`) : chalk.green('    ✔ cleaned'));
  }
  console.log(chalk.green(`\n  ✔ Freed ~${formatKb(freed)}\n`));
}

// ─── Trash ──────────────────────────────────────────────────────────────────

async function trashSizeKb(): Promise<number | undefined> {
  const trash = path.join(os.homedir(), '.Trash');
  try { fs.readdirSync(trash); } catch { return undefined; }
  return (await duKb([trash])).get(trash) ?? 0;
}

async function runTrash(opts: OptimizeOptions): Promise<void> {
  header('Trash');
  const size = await trashSizeKb();
  console.log(`  Trash size: ${size === undefined ? chalk.dim('unknown (grant your terminal Full Disk Access to measure)') : formatKb(size)}\n`);
  if (!opts.empty) {
    console.log(chalk.dim('  To empty: ') + chalk.cyan('pyre optimize trash --empty') + '\n');
    return;
  }
  if (size === 0) { console.log(chalk.green('  ✔ Trash is already empty.\n')); return; }
  if (opts.dryRun) { console.log(chalk.dim('  Dry run: nothing was deleted.\n')); return; }
  if (!(await confirm('Permanently delete everything in the Trash?', opts.yes))) return;

  const trash = path.join(os.homedir(), '.Trash');
  let ok = false;
  if (size !== undefined) {
    let failed = 0;
    for (const n of fs.readdirSync(trash)) {
      try { fs.rmSync(path.join(trash, n), { recursive: true, force: true }); } catch { failed++; }
    }
    ok = failed === 0;
  }
  if (!ok) {
    // Fall back to Finder (handles locked items / no Full Disk Access).
    ok = (await runInherited('osascript', ['-e', 'tell application "Finder" to empty trash'])) === 0;
  }
  console.log(ok ? chalk.green('\n  ✔ Trash emptied\n') : chalk.red('\n  ✖ Could not empty the Trash\n'));
}

// ─── Startup items ──────────────────────────────────────────────────────────

interface LaunchItem {
  label: string;
  file: string;
  scope: string;
  program?: string;
  missing: boolean;
  disabled: boolean;
  loaded: boolean;
}

async function collectLaunchItems(): Promise<LaunchItem[]> {
  const dirs: [string, string][] = [
    [path.join(os.homedir(), 'Library', 'LaunchAgents'), 'user agent'],
    ['/Library/LaunchAgents', 'global agent'],
    ['/Library/LaunchDaemons', 'daemon'],
  ];
  const loadedRaw = await run('launchctl', ['list']);
  const loaded = new Set(loadedRaw.split('\n').slice(1).map(l => l.trim().split(/\s+/)[2]).filter(Boolean));

  const jobs: Promise<LaunchItem | null>[] = [];
  for (const [dir, scope] of dirs) {
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.plist')); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      jobs.push((async () => {
        const raw = await run('plutil', ['-convert', 'json', '-o', '-', file], 3000);
        let j: any = {};
        try { j = JSON.parse(raw); } catch { /* binary/unreadable */ }
        const label = j.Label ?? f.replace(/\.plist$/, '');
        const program: string | undefined = j.Program ?? (Array.isArray(j.ProgramArguments) ? j.ProgramArguments[0] : undefined);
        const missing = !!program && path.isAbsolute(program) && !fs.existsSync(program);
        return { label, file, scope, program, missing, disabled: j.Disabled === true, loaded: loaded.has(label) };
      })());
    }
  }
  return (await Promise.all(jobs)).filter((x): x is LaunchItem => !!x);
}

async function runStartup(): Promise<void> {
  header('Startup Items');
  const loginRaw = await run('osascript', ['-e', 'tell application "System Events" to get the name of every login item'], 8000);
  const loginItems = loginRaw.trim() ? loginRaw.trim().split(/,\s*/) : [];
  console.log(chalk.bold('  Login items:'));
  if (loginItems.length) for (const li of loginItems) console.log(`    • ${li}`);
  else console.log(chalk.dim('    none found (or System Events access was denied)'));

  const items = await collectLaunchItems();
  console.log(chalk.bold(`\n  Launch agents & daemons (${items.length}):`));
  console.log(chalk.dim(`    ${pad('Label', 52)}${pad('Scope', 14)}Status`));
  for (const it of items.sort((a, b) => a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label))) {
    const status = it.missing ? chalk.red('broken: program missing')
      : it.disabled ? chalk.dim('disabled')
      : it.loaded ? chalk.green('loaded')
      : chalk.dim('not loaded');
    console.log(`    ${pad(it.label, 52)}${pad(it.scope, 14)}${status}`);
  }
  const broken = items.filter(i => i.missing);
  if (broken.length) {
    console.log(chalk.yellow(`\n  ⚠ ${broken.length} item(s) point to programs that no longer exist (leftovers from uninstalled apps):`));
    for (const b of broken) console.log(chalk.dim(`    ${b.file}`));
    console.log(chalk.dim('  Review and delete these plist files manually if you no longer need them.'));
  }
  console.log(chalk.dim('\n  Manage login items in System Settings → General → Login Items.\n'));
}

// ─── DNS ────────────────────────────────────────────────────────────────────

async function runDns(opts: OptimizeOptions): Promise<void> {
  header('DNS Cache');
  if (opts.dryRun) { console.log(chalk.dim('  Dry run: would run `sudo dscacheutil -flushcache` and `sudo killall -HUP mDNSResponder`.\n')); return; }
  if (!(await confirm('Flush the DNS cache? (asks for your password)', opts.yes))) return;
  const a = await runInherited('sudo', ['dscacheutil', '-flushcache']);
  const b = a === 0 ? await runInherited('sudo', ['killall', '-HUP', 'mDNSResponder']) : 1;
  console.log(a === 0 && b === 0 ? chalk.green('\n  ✔ DNS cache flushed\n') : chalk.red('\n  ✖ Failed to flush DNS cache\n'));
}

// ─── Protect list ───────────────────────────────────────────────────────────

function runProtect(add: boolean, names: string[]): void {
  const cfg = readConfig();
  const list = new Set(cfg.optimizeProtectedApps ?? []);
  if (!names.length) {
    console.log(chalk.bold('\n  Protected apps (never quit):\n'));
    for (const b of BUILTIN_PROTECTED) console.log(chalk.dim(`    ${b}  (built-in)`));
    for (const p of list) console.log(`    ${p}`);
    console.log(chalk.dim('\n  Add with: pyre optimize protect "<App Name or bundle id>"\n'));
    return;
  }
  for (const n of names) {
    if (add) list.add(n);
    else {
      for (const existing of [...list]) if (existing.toLowerCase() === n.toLowerCase()) list.delete(existing);
      if (BUILTIN_PROTECTED.some(b => b.toLowerCase() === n.toLowerCase())) {
        console.log(chalk.yellow(`  ⚠ ${n} is built-in protected and can't be removed.`));
      }
    }
  }
  writeConfig({ optimizeProtectedApps: [...list] });
  console.log(chalk.green(`  ✔ ${add ? 'Protected' : 'Unprotected'}: ${names.join(', ')}`));
}

// ─── Overview report ────────────────────────────────────────────────────────

async function runOverview(opts: OptimizeOptions): Promise<void> {
  header('Overview');
  const settings = resolveSettings(opts);
  const [analysis, mem, trash, launch] = await Promise.all([
    analyzeApps(settings),
    collectMemory(),
    trashSizeKb(),
    collectLaunchItems(),
  ]);
  const { candidates, fresh, apps } = analysis;

  console.log(chalk.bold('  Apps'));
  console.log(`  Open apps:        ${apps.length}`);
  console.log(`  Usage tracker:    ${fresh ? chalk.green('running') : fs.existsSync(TRACKER_PLIST) ? chalk.yellow('installed, not reporting') : chalk.dim('off')}`);
  if (candidates.length) {
    const ram = candidates.reduce((s, c) => s + c.app.rssKb, 0);
    console.log(`  Idle apps:        ${chalk.yellow(String(candidates.length))} ${chalk.dim(`(~${formatKb(ram)} RAM)`)}: ${candidates.map(c => c.app.name).join(', ')}`);
  } else {
    console.log(`  Idle apps:        ${chalk.green('none')}`);
  }

  console.log(chalk.bold('\n  Memory'));
  printMemorySummary(mem);

  console.log(chalk.bold('\n  Storage'));
  console.log(`  Trash:            ${trash === undefined ? chalk.dim('unknown') : formatKb(trash)}`);
  console.log(chalk.dim('  Caches:           run `pyre optimize caches` to measure'));

  const broken = launch.filter(i => i.missing).length;
  console.log(chalk.bold('\n  Startup'));
  console.log(`  Launch items:     ${launch.length}${broken ? chalk.yellow(` (${broken} broken)`) : ''}`);

  const tips: string[] = [];
  if (candidates.length) tips.push(`${chalk.cyan('pyre optimize apps')}           quit ${candidates.length} idle app(s)`);
  if (!fresh) tips.push(`${chalk.cyan('pyre optimize track --install')} track real app idle times`);
  if (mem.freePct !== undefined && mem.freePct < 25) tips.push(`${chalk.cyan('pyre optimize memory')}         memory pressure is high`);
  if (trash !== undefined && trash > 1024 * 1024) tips.push(`${chalk.cyan('pyre optimize trash --empty')}  free ${formatKb(trash)}`);
  if (broken) tips.push(`${chalk.cyan('pyre optimize startup')}        review ${broken} broken launch item(s)`);
  tips.push(`${chalk.cyan('pyre optimize caches')}         see reclaimable cache space`);

  console.log(chalk.bold('\n  Suggestions'));
  for (const t of tips) console.log(`  • ${t}`);
  console.log();
}

// ─── Entry point ────────────────────────────────────────────────────────────

const USAGE = `
  Usage: pyre optimize [subcommand] [options]

  Subcommands:
    (none)                 Overview report with suggestions (changes nothing)
    apps                   Quit apps that are open but haven't been used recently
    track                  Record app usage for real idle times (--install / --uninstall / --auto-quit <dur>)
    memory                 Memory pressure, swap, top RAM users, optional purge
    caches                 Measure caches (--clean to delete after confirmation)
    trash                  Trash size (--empty to empty after confirmation)
    startup                Login items and launch agents, flags broken leftovers
    dns                    Flush the DNS cache
    protect [app]          List or add apps that are never quit
    unprotect <app>        Remove an app from the protected list

  Options:
    --idle <dur>           Idle threshold, e.g. 30m, 2h (default from config: 2h)
    --keep <n>             Always keep the N most recently used apps (default 5)
    --dry-run              Show what would happen without changing anything
    -y, --yes              Don't ask for confirmation
    --force                Terminate apps that don't quit within 10s
`;

async function runWindowsDns(): Promise<void> {
  console.log(chalk.bold('\n  pyre optimize dns — Flush DNS Resolver Cache\n'));
  try {
    const { execSync } = await import('node:child_process');
    execSync('ipconfig /flushdns', { stdio: 'inherit' });
    console.log(chalk.green('\n  ✔ Windows DNS Resolver Cache flushed successfully.\n'));
  } catch (err: any) {
    console.log(chalk.red(`\n  ✖ Failed to flush DNS cache: ${err.message}\n`));
  }
}

async function runWindowsTrash(opts: OptimizeOptions): Promise<void> {
  console.log(chalk.bold('\n  pyre optimize trash — Windows Recycle Bin\n'));
  if (opts.empty || opts.yes) {
    try {
      const { runPowerShell } = await import('./monitors/run.js');
      await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', '');
      console.log(chalk.green('  ✔ Emptied Recycle Bin.\n'));
    } catch (err: any) {
      console.log(chalk.red(`  ✖ Could not empty Recycle Bin: ${err.message}\n`));
    }
  } else {
    console.log(chalk.cyan('  Pass --empty or -y to empty the Recycle Bin.\n'));
  }
}

async function runWindowsCaches(opts: OptimizeOptions): Promise<void> {
  console.log(chalk.bold('\n  pyre optimize caches — Windows Temporary Files\n'));
  const tempDir = os.tmpdir();
  let totalBytes = 0;
  let fileCount = 0;
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(tempDir, f));
          if (stat.isFile()) {
            totalBytes += stat.size;
            fileCount++;
          }
        } catch {}
      }
    }
  } catch {}

  const mb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
  console.log(`  Temporary files: ${chalk.bold(String(fileCount))} files (${chalk.yellow(`${mb} MB`)}) in ${chalk.dim(tempDir)}`);

  if (opts.clean || opts.yes) {
    let deleted = 0;
    try {
      const files = fs.readdirSync(tempDir);
      for (const f of files) {
        try {
          const full = path.join(tempDir, f);
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            fs.unlinkSync(full);
            deleted++;
          }
        } catch {}
      }
    } catch {}
    console.log(chalk.green(`  ✔ Cleaned ${deleted} temporary cache files.\n`));
  } else {
    console.log(chalk.dim('  Run with --clean or -y to remove temporary cache files.\n'));
  }
}

async function runWindowsStartup(): Promise<void> {
  console.log(chalk.bold('\n  pyre optimize startup — Windows Startup Applications\n'));
  try {
    const { runPowerShell } = await import('./monitors/run.js');
    const raw = await runPowerShell(
      `$hkcu = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; $hklm = Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; if ($hkcu) { $hkcu.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "User|$($_.Name)|$($_.Value)" } }; if ($hklm) { $hklm.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "System|$($_.Name)|$($_.Value)" } }`,
      ''
    );
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      console.log(chalk.dim('  No registry startup entries found.\n'));
      return;
    }
    for (const l of lines) {
      const [scope, name, val] = l.split('|');
      console.log(`  • ${chalk.bold(name)} [${chalk.cyan(scope)}]`);
      console.log(`    ${chalk.dim(val)}`);
    }
    console.log();
  } catch {
    console.log(chalk.dim('  Could not query startup entries.\n'));
  }
}

export async function runOptimizeCommand(sub: string | undefined, args: string[], opts: OptimizeOptions): Promise<void> {
  if (process.platform === 'win32') {
    switch (sub) {
      case 'dns':
        return runWindowsDns();
      case 'caches':
      case 'cache':
        return runWindowsCaches(opts);
      case 'trash':
        return runWindowsTrash(opts);
      case 'startup':
        return runWindowsStartup();
      case 'protect':
        return runProtect(true, args);
      case 'unprotect':
        return runProtect(false, args);
      case 'help':
        console.log(USAGE);
        return;
      case undefined:
      case 'report':
        console.log(chalk.bold('\n  pyre optimize — Windows Housekeeping\n'));
        console.log('  Available subcommands on Windows:');
        console.log(`    ${chalk.cyan('pyre optimize dns')}      Flush DNS Resolver Cache`);
        console.log(`    ${chalk.cyan('pyre optimize caches')}   Scan and clean temporary files (%TEMP%)`);
        console.log(`    ${chalk.cyan('pyre optimize trash')}    Inspect and empty Recycle Bin`);
        console.log(`    ${chalk.cyan('pyre optimize startup')}  Inspect Windows startup items\n`);
        return;
      default:
        console.log(chalk.yellow(`  Subcommand "${sub}" requires macOS WindowServer APIs.`));
        console.log('  On Windows, use: dns, caches, trash, startup, protect, unprotect.\n');
        return;
    }
  }

  if (process.platform !== 'darwin') {
    console.log(chalk.yellow('  pyre optimize is only available on macOS and Windows.'));
    return;
  }
  switch (sub) {
    case undefined:
    case 'report':
      return runOverview(opts);
    case 'apps':
      return runApps(opts);
    case 'track':
      return runTracker(opts);
    case 'memory':
    case 'mem':
      return runMemory(opts);
    case 'caches':
    case 'cache':
      return runCaches(opts);
    case 'trash':
      return runTrash(opts);
    case 'startup':
      return runStartup();
    case 'dns':
      return runDns(opts);
    case 'protect':
      return runProtect(true, args);
    case 'unprotect':
      return runProtect(false, args);
    case 'help':
      console.log(USAGE);
      return;
    default:
      console.log(chalk.red(`  ✖ Unknown subcommand "${sub}"`));
      console.log(USAGE);
      process.exitCode = 1;
  }
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

process.env.PYRE_CONFIG_DIR = path.join(process.cwd(), 'node_modules', '.test-pyre-config');

import { parseSystemExtensionsOutput } from './extensions.js';
import { saveProfile, loadProfile, listProfiles } from './state/config.js';
import { sparkline } from './sparkline.js';

describe('System Extensions Parser (Feature A7)', () => {
  it('should parse system extensions categories and active extensions', () => {
    const mockOutput = `
--- category com.apple.system_extension.network_extension
* * UBF8T346G9 com.crowdstrike.falcon.Agent (1.0/1) [activated enabled]
`;
    const result = parseSystemExtensionsOutput(mockOutput);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].category, 'com.apple.system_extension.network_extension');
    assert.strictEqual(result[0].extensions.length, 1);
    assert.strictEqual(result[0].extensions[0].bundleId, 'com.crowdstrike.falcon.Agent');
    assert.strictEqual(result[0].extensions[0].teamId, 'UBF8T346G9');
  });

  it('should handle empty extensions output without crashing', () => {
    const result = parseSystemExtensionsOutput('');
    assert.ok(Array.isArray(result));
  });
});

describe('Config Profiles (Feature D5)', () => {
  it('should save, list, and load profiles', () => {
    const testName = 'unit-test-profile';
    saveProfile(testName);
    const profiles = listProfiles();
    assert.ok(profiles.includes(testName));

    loadProfile(testName);
  });
});

describe('Plain text sparkline (Feature F3)', () => {
  it('should format sparkline in plain text mode', () => {
    const res = sparkline([10, 20, 30], { plainText: true });
    assert.strictEqual(res, '[10.0 -> 30.0 (Δ:+20.0)]');
  });
});

describe('Cross-Platform Support', () => {
  it('should generate valid PowerShell completions script', async () => {
    const { generatePowerShellCompletions } = await import('./completions.js');
    const ps = generatePowerShellCompletions();
    assert.ok(ps.includes('Register-ArgumentCompleter'));
    assert.ok(ps.includes('CommandName pyre'));
    assert.ok(ps.includes('live'));
    assert.ok(ps.includes('--json'));
  });

  it('should run doctor diagnostics without crashing on any platform', async () => {
    const { runDoctor } = await import('./doctor.js');
    const checks = await runDoctor();
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
    for (const c of checks) {
      assert.ok(['ok', 'warn', 'error'].includes(c.status));
      assert.ok(typeof c.name === 'string');
      assert.ok(typeof c.message === 'string');
    }
  });

  it('should collect telemetry across subsystems without crashing', async () => {
    const { collectAll } = await import('./monitors/index.js');
    const data = await collectAll();
    assert.ok(data.header.hostname.length > 0);
    assert.ok(data.header.os.length > 0);
    assert.ok(data.cpu.cores >= 1);
    assert.ok(data.memory.total > 0);
    assert.ok(Array.isArray(data.disk));
    assert.ok(typeof data.network.interface === 'string');
  });

  it('should run synthetic stress test workers without crashing', async () => {
    const { runStressCommand } = await import('./stressCmd.js');
    const start = Date.now();
    await runStressCommand({ durationSec: 0.1, cores: 2 });
    assert.ok(Date.now() - start >= 80);
  });
});

describe('Web and UI Security (LAN exposure & flags)', () => {
  it('should parse --host, --lan, and --no-lan CLI flags in commander help', async () => {
    const { execSync } = await import('node:child_process');
    const help = execSync('node dist/index.js --help', { encoding: 'utf-8' });
    assert.ok(help.includes('--host <host>'));
    assert.ok(help.includes('--lan'));
    assert.ok(help.includes('--no-lan'));
  });

  it('should bind to localhost and suppress Network URL when --no-lan is passed', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn('node', ['dist/index.js', 'web', '--port', '34881', '--no-lan']);
    let output = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (d) => {
        output += d.toString();
        if (output.includes('SSE Stream:')) {
          resolve();
        }
      });
    });
    child.kill('SIGINT');
    assert.ok(output.includes('Network:     Disabled (localhost only for security)'));
    assert.ok(!output.includes('Accessible on same Wi-Fi / LAN'));
  });

  it('should expose Network URL when --lan is passed', async () => {
    const { spawn } = await import('node:child_process');
    const child = spawn('node', ['dist/index.js', 'web', '--port', '34882', '--lan']);
    let output = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (d) => {
        output += d.toString();
        if (output.includes('SSE Stream:')) {
          resolve();
        }
      });
    });
    child.kill('SIGINT');
    assert.ok(output.includes('Accessible on same Wi-Fi / LAN'));
  });
});

describe('Pyre-UI Logging and Recording Features', () => {
  it('should render HTML dashboard containing Logs tab, session recorder, and export dropdown', async () => {
    const { getDashboardHtml } = await import('./formatters/index.js');
    const html = getDashboardHtml();
    assert.ok(html.includes('data-tab="logs"'));
    assert.ok(html.includes('id="btn-record"'));
    assert.ok(html.includes('id="export-menu"'));
    assert.ok(html.includes('id="logs-view"'));
    assert.ok(html.includes('id="panel-logs"'));
    assert.ok(html.includes('switchTab(\'logs\')'));
    assert.ok(html.includes('toggleWebRecording'));
    assert.ok(html.includes('downloadSnapshot'));
    assert.ok(html.includes('analyzeAndLog'));
  });

  it('should register and export all logging REST endpoints and stop cleanly on SIGINT', async () => {
    const fs = await import('node:fs');
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    assert.ok(indexSrc.includes('/api/logging/status'));
    assert.ok(indexSrc.includes('/api/logging/start'));
    assert.ok(indexSrc.includes('/api/logging/stop'));
    assert.ok(indexSrc.includes('/api/logging/history'));
    assert.ok(indexSrc.includes('/api/logging/download'));
    assert.ok(indexSrc.includes('/api/export'));
    assert.ok(indexSrc.includes('stopWebLogging()'));

    const { spawn } = await import('node:child_process');
    const testPort = '34883';
    const child = spawn('node', ['dist/index.js', 'web', '--port', testPort, '--no-lan']);
    let output = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (d) => {
        output += d.toString();
        if (output.includes('SSE Stream:')) {
          resolve();
        }
      });
    });
    assert.ok(output.includes(`running on port ${testPort}`));
    child.kill('SIGINT');
  });
});

describe('Pyre Preferences, Autostart Service, and Settings UI', () => {
  it('should query service status and installation without crashing', async () => {
    const { getServiceStatus, isServiceInstalled } = await import('./service.js');
    const status = getServiceStatus();
    assert.strictEqual(typeof status.installed, 'boolean');
    assert.strictEqual(typeof status.platform, 'string');
    assert.strictEqual(typeof status.serviceLabel, 'string');
    assert.ok(status.serviceLabel.includes('pyre'));
    assert.strictEqual(typeof isServiceInstalled(), 'boolean');
  });

  it('should render HTML dashboard containing Settings modal, tabs, and controls', async () => {
    const { getDashboardHtml } = await import('./formatters/index.js');
    const html = getDashboardHtml();
    assert.ok(html.includes('id="modal-settings"'));
    assert.ok(html.includes('id="btn-settings"'));
    assert.ok(html.includes('openSettingsModal'));
    assert.ok(html.includes('closeSettingsModal'));
    assert.ok(html.includes('switchSettingsTab'));
    assert.ok(html.includes('id="spane-general"'));
    assert.ok(html.includes('id="spane-autostart"'));
    assert.ok(html.includes('id="spane-alerts"'));
    assert.ok(html.includes('id="spane-appearance"'));
    assert.ok(html.includes('id="spane-diagnostics"'));
    assert.ok(html.includes('toggleAutostartFromUI'));
    assert.ok(html.includes('sendTestAlertFromUI'));
    assert.ok(html.includes('runDoctorFromUI'));
    assert.ok(html.includes('resetConfigFromUI'));
    assert.ok(html.includes('onDensityChange'));
    assert.ok(html.includes('density-compact'));
  });

  it('should read, write, and reset configuration with web preferences', async () => {
    const { readConfig, writeConfig, resetConfig } = await import('./state/config.js');
    const initial = readConfig();
    assert.strictEqual(typeof initial.port, 'number');
    assert.strictEqual(typeof initial.tableDensity, 'string');

    writeConfig({ tableDensity: 'compact', compact: true, port: 8080 });
    const updated = readConfig();
    assert.strictEqual(updated.tableDensity, 'compact');
    assert.strictEqual(updated.compact, true);
    assert.strictEqual(updated.port, 8080);

    const reset = resetConfig();
    assert.strictEqual(reset.tableDensity, 'standard');
    assert.strictEqual(reset.compact, false);
    assert.strictEqual(reset.port, 3000);
  });

  it('should register settings REST endpoints in web server', () => {
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    assert.ok(indexSrc.includes('/api/config'));
    assert.ok(indexSrc.includes('/api/config/reset'));
    assert.ok(indexSrc.includes('/api/service/status'));
    assert.ok(indexSrc.includes('/api/service/toggle'));
    assert.ok(indexSrc.includes('/api/alerts/test'));
    assert.ok(indexSrc.includes('/api/doctor'));
  });
});



describe('Mac Optimizer (pyre optimize)', async () => {
  const opt = await import('./optimizeCmd.js');

  it('parses durations', () => {
    assert.strictEqual(opt.parseDuration('2h', 0), 7_200_000);
    assert.strictEqual(opt.parseDuration('30m', 0), 1_800_000);
    assert.strictEqual(opt.parseDuration('90s', 0), 90_000);
    assert.strictEqual(opt.parseDuration('1d', 0), 86_400_000);
    assert.strictEqual(opt.parseDuration('15', 0), 900_000);
    assert.strictEqual(opt.parseDuration(undefined, 42), 42);
    assert.ok(Number.isNaN(opt.parseDuration('soon', 0)));
  });

  it('parses lsappinfo list output (Foreground apps only)', () => {
    const raw = ` 1) "loginwindow" ASN:0x0-0x3003: 
    bundleID="com.apple.loginwindow"
    pid = 414 type="UIElement" flavor=3
 4) "Terminal" ASN:0x0-0xa00a: 
    bundleID="com.apple.Terminal"
    pid = 615 type="Foreground" flavor=3 Version="470.2"
    checkin time = 2026/10/10 09:07:09 ( 2 days ago )
 5) "Safari" ASN:0x0-0xb00b: 
    bundleID="com.apple.Safari"
    pid = 619 type="Foreground" flavor=3
`;
    const apps = opt.parseLsappinfoList(raw);
    assert.strictEqual(apps.length, 2);
    assert.deepStrictEqual(apps.map(a => a.bundleId), ['com.apple.Terminal', 'com.apple.Safari']);
    assert.strictEqual(apps[0].pid, 615);
    assert.strictEqual(apps[0].asn, 'ASN:0x0-0xa00a');
    assert.strictEqual(apps[0].launchedAt, new Date(2026, 9, 10, 9, 7, 9).getTime());
  });

  it('parses visible process order', () => {
    const order = opt.parseAsnList('ASN:0x0-0xb00b-"Safari": ASN:0x0-0x598598-"Antigravity": ASN:0x0-0xb00b-"Safari":');
    assert.deepStrictEqual(order, ['ASN:0x0-0xb00b', 'ASN:0x0-0x598598']);
  });

  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const H = 3_600_000;
  const mk = (name: string, rank: number, extra: Partial<import('./optimizeCmd.js').RunningApp> = {}) => ({
    asn: `ASN:0x0-0x${rank}`, name, bundleId: `com.test.${name.toLowerCase()}`, pid: 1000 + rank,
    launchedAt: now - 24 * H, rank, cpu: 0, rssKb: 100_000, frontmost: false, ...extra,
  });
  const baseCtx = { now, idleThresholdMs: 2 * H, keepRecent: 2, protectedApps: [] as string[], selfPids: new Set<number>() };

  it('selects by rank when no tracking data, honoring keep/protected/busy/self', () => {
    const apps = [
      mk('Front', 0, { frontmost: true }),
      mk('Recent', 1),
      mk('Finder', 2, { bundleId: 'com.apple.finder' }),
      mk('Busy', 3, { cpu: 30 }),
      mk('Mine', 4, { pid: 777 }),
      mk('Fresh', 5, { launchedAt: now - 10 * 60_000 }),
      mk('Music', 6, { bundleId: 'com.apple.Music', cpu: 2 }),
      mk('Old', 7),
      mk('Custom', 8),
    ];
    const { candidates, skipped } = opt.selectIdleApps(apps, { ...baseCtx, protectedApps: ['custom'], selfPids: new Set([777]) });
    assert.deepStrictEqual(candidates.map(c => c.app.name), ['Old']);
    assert.strictEqual(candidates[0].idleMs, undefined);
    assert.strictEqual(skipped.length, 8);
  });

  it('uses fresh tracking data for real idle times', () => {
    const usage = {
      version: 1 as const, trackingSince: now - 10 * H, updatedAt: now - 5000,
      apps: { 'com.test.used': { name: 'Used', lastActive: now - 30 * 60_000 }, 'com.test.stale': { name: 'Stale', lastActive: now - 5 * H } },
    };
    const apps = [mk('A', 0), mk('B', 1), mk('Used', 2), mk('Stale', 3), mk('Never', 4)];
    const { candidates } = opt.selectIdleApps(apps, { ...baseCtx, usage });
    assert.deepStrictEqual(candidates.map(c => c.app.name), ['Stale', 'Never']);
    assert.strictEqual(candidates[0].idleMs, 5 * H);
    // Never seen since tracking began 10h ago → idle bounded by trackingSince
    assert.strictEqual(candidates[1].idleMs, 10 * H);
  });

  it('ignores stale tracking data (tracker not running)', () => {
    const usage = { version: 1 as const, trackingSince: now - 10 * H, updatedAt: now - 3 * H, apps: {} };
    assert.strictEqual(opt.isTrackingFresh(usage, now), false);
    assert.strictEqual(opt.computeIdleMs(mk('X', 5), usage, now), undefined);
  });
});

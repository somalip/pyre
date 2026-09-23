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
});


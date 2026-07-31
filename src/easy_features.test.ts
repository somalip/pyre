import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

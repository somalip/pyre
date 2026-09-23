import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Linux Telemetry Parsers', () => {
  it('should parse Linux memory info structure correctly', async () => {
    const { collectLinuxMemory } = await import('./monitors/platform/linux.js');
    const mem = await collectLinuxMemory();
    assert.ok(typeof mem.total === 'number');
    assert.ok(typeof mem.used === 'number');
    assert.ok(typeof mem.free === 'number');
    assert.ok(typeof mem.usagePercent === 'number');
    assert.ok(mem.pageSize === 4096);
  });

  it('should collect Linux system info', async () => {
    const { collectLinuxSystem } = await import('./monitors/platform/linux.js');
    const sys = await collectLinuxSystem();
    assert.ok(typeof sys.hostname === 'string');
    assert.ok(typeof sys.os === 'string');
    assert.ok(typeof sys.uptime === 'string');
  });

  it('should collect Linux disk structure', async () => {
    const { collectLinuxDisk } = await import('./monitors/platform/linux.js');
    const disks = await collectLinuxDisk();
    assert.ok(Array.isArray(disks));
    assert.ok(disks.length > 0);
    assert.ok(typeof disks[0].filesystem === 'string');
    assert.ok(typeof disks[0].mountpoint === 'string');
  });

  it('should collect Linux thermal structure gracefully', async () => {
    const { collectLinuxThermal } = await import('./monitors/platform/linux.js');
    const thermal = await collectLinuxThermal();
    assert.ok(typeof thermal.state === 'string');
    assert.ok(typeof thermal.pressureLevel === 'number');
  });
});

describe('Windows Telemetry Parsers', () => {
  it('should collect Windows system info with Windows OS mapping', async () => {
    const { collectWindowsSystem } = await import('./monitors/platform/windows.js');
    const sys = await collectWindowsSystem();
    assert.ok(typeof sys.hostname === 'string');
    assert.ok(sys.os.startsWith('Windows'));
    assert.ok(typeof sys.uptime === 'string');
  });

  it('should collect Windows memory structure', async () => {
    const { collectWindowsMemory } = await import('./monitors/platform/windows.js');
    const mem = await collectWindowsMemory();
    assert.ok(typeof mem.total === 'number');
    assert.ok(typeof mem.used === 'number');
    assert.ok(typeof mem.free === 'number');
    assert.ok(typeof mem.usagePercent === 'number');
    assert.ok(mem.pageSize === 4096);
  });

  it('should collect Windows CPU structure with simulated load average', async () => {
    const { collectWindowsCpu } = await import('./monitors/platform/windows.js');
    const cpuRef = { current: null };
    const cpu = await collectWindowsCpu(cpuRef);
    assert.ok(typeof cpu.brand === 'string');
    assert.ok(cpu.cores >= 1);
    assert.ok(Array.isArray(cpu.loadAvg));
    assert.strictEqual(cpu.loadAvg.length, 3);
  });

  it('should return Windows disk fallback structure', async () => {
    const { collectWindowsDisk } = await import('./monitors/platform/windows.js');
    const disks = await collectWindowsDisk();
    assert.ok(Array.isArray(disks));
    assert.ok(disks.length > 0);
    assert.ok(disks[0].mountpoint.includes(':'));
  });

  it('should collect Windows thermal structure with pressure level', async () => {
    const { collectWindowsThermal } = await import('./monitors/platform/windows.js');
    const thermal = await collectWindowsThermal();
    assert.ok(typeof thermal.state === 'string');
    assert.ok([0, 1, 2, 3].includes(thermal.pressureLevel));
  });
});

describe('Cross-Platform Service & Package Management', () => {
  it('should report package manager health without crashing', async () => {
    const { getBrewHealth } = await import('./brewHealth.js');
    const health = await getBrewHealth();
    assert.ok(typeof health.managerName === 'string');
    assert.ok(typeof health.brewAvailable === 'boolean');
    assert.ok(typeof health.installedCount === 'number');
  });

  it('should query system extensions / drivers without crashing', async () => {
    const { getSystemExtensions } = await import('./extensions.js');
    const extensions = await getSystemExtensions();
    assert.ok(Array.isArray(extensions));
  });
});

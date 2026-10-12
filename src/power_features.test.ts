import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { FlightRecorder, FlightFrame } from './flightRecorder.js';
import { BUILTIN_PLAYBOOKS } from './playbookCmd.js';
import { parseBytesString, formatBytes, runWithBudget } from './budgetCmd.js';
import { formatStatusline, StatuslineMetrics } from './statuslineCmd.js';
import { detectContainerEngine, collectContainerStats } from './containersCmd.js';
import { inspectProcess } from './inspectCmd.js';
import { generateXbarPlugin } from './xbar.js';

describe('Power-User Features', () => {
  describe('In-Memory Flight Recorder (Black Box)', () => {
    it('should push telemetry frames and respect max capacity', () => {
      const recorder = new FlightRecorder(3);
      assert.strictEqual(recorder.size(), 0);

      const makeFrame = (cpuUsage: number, memUsage: number): FlightFrame => ({
        timestamp: new Date().toISOString(),
        cpu: { usage: cpuUsage, loadAvg: [1, 1, 1], temp: 45 },
        memory: { usagePercent: memUsage, usedBytes: 1024 * 1024 * 500, totalBytes: 1024 * 1024 * 1000 },
        network: { rxPackets: 100, txPackets: 80 },
        topProcesses: [
          { pid: 101, name: 'node', cpu: cpuUsage, mem: memUsage },
          { pid: 102, name: 'ffmpeg', cpu: 12.5, mem: 5.0 },
        ],
      });

      recorder.push(makeFrame(20, 30));
      recorder.push(makeFrame(50, 60));
      recorder.push(makeFrame(85, 75));
      assert.strictEqual(recorder.size(), 3);

      // Pushing 4th item should evict first frame (usage 20)
      recorder.push(makeFrame(95, 80));
      assert.strictEqual(recorder.size(), 3);

      const frames = recorder.getFrames();
      assert.strictEqual(frames[0].cpu.usage, 50);
      assert.strictEqual(frames[2].cpu.usage, 95);
    });

    it('should generate structured forensic report with peak metrics', () => {
      const recorder = new FlightRecorder(10);
      recorder.push({
        timestamp: '2026-10-12T10:00:00.000Z',
        cpu: { usage: 40, loadAvg: [1.2], temp: 50 },
        memory: { usagePercent: 55, usedBytes: 4000, totalBytes: 8000 },
        network: { rxPackets: 10, txPackets: 5 },
        topProcesses: [{ pid: 100, name: 'worker1', cpu: 35, mem: 20 }],
      });
      recorder.push({
        timestamp: '2026-10-12T10:00:05.000Z',
        cpu: { usage: 98, loadAvg: [3.5], temp: 88 },
        memory: { usagePercent: 82, usedBytes: 7000, totalBytes: 8000 },
        network: { rxPackets: 50, txPackets: 40 },
        topProcesses: [
          { pid: 200, name: 'runaway_app', cpu: 92, mem: 65 },
          { pid: 100, name: 'worker1', cpu: 5, mem: 15 },
        ],
      });

      const report = recorder.generateReport();
      assert.strictEqual(report.frameCount, 2);
      assert.strictEqual(report.timeSpanSec, 5);
      assert.strictEqual(report.summary.peakCpuUsage, 98);
      assert.strictEqual(report.summary.peakMemUsage, 82);
      assert.strictEqual(report.summary.peakTempC, 88);
      assert.strictEqual(report.summary.highestCpuProcess?.name, 'runaway_app');
      assert.strictEqual(report.summary.highestCpuProcess?.pid, 200);
      assert.strictEqual(report.summary.highestMemProcess?.name, 'runaway_app');
    });

    it('should dump forensic report to file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyre-flight-test-'));
      const recorder = new FlightRecorder(5);
      recorder.push({
        timestamp: new Date().toISOString(),
        cpu: { usage: 10, loadAvg: [0.5] },
        memory: { usagePercent: 20, usedBytes: 200, totalBytes: 1000 },
        network: { rxPackets: 1, txPackets: 1 },
        topProcesses: [{ pid: 1, name: 'init', cpu: 1, mem: 1 }],
      });

      const dumpPath = recorder.dump(tmpDir);
      assert.ok(fs.existsSync(dumpPath));
      const parsed = JSON.parse(fs.readFileSync(dumpPath, 'utf-8'));
      assert.strictEqual(parsed.frameCount, 1);
      assert.strictEqual(parsed.summary.peakCpuUsage, 10);

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('Multi-Step Playbooks & Recipes', () => {
    it('should provide built-in playbooks for audit, clean, triage, and bench', () => {
      assert.ok(BUILTIN_PLAYBOOKS.length >= 4);
      const ids = BUILTIN_PLAYBOOKS.map((p) => p.id);
      assert.ok(ids.includes('audit'));
      assert.ok(ids.includes('clean'));
      assert.ok(ids.includes('triage'));
      assert.ok(ids.includes('bench'));

      for (const pb of BUILTIN_PLAYBOOKS) {
        assert.ok(pb.name.length > 0);
        assert.ok(pb.description.length > 0);
        assert.ok(Array.isArray(pb.steps));
        assert.ok(pb.steps.length > 0);
        for (const s of pb.steps) {
          assert.ok(s.name.length > 0);
          assert.ok(s.command.length > 0);
        }
      }
    });
  });

  describe('Performance Budgeting Runner (pyre run)', () => {
    it('should parse human-readable byte strings accurately', () => {
      assert.strictEqual(parseBytesString('500MB'), 500 * 1024 * 1024);
      assert.strictEqual(parseBytesString('500m'), 500 * 1024 * 1024);
      assert.strictEqual(parseBytesString('2GB'), 2 * 1024 * 1024 * 1024);
      assert.strictEqual(parseBytesString('64KB'), 64 * 1024);
      assert.strictEqual(parseBytesString('1024'), 1024);
      assert.strictEqual(parseBytesString('invalid'), 0);
    });

    it('should format bytes cleanly', () => {
      assert.strictEqual(formatBytes(1024 * 1024 * 1024 * 1.5), '1.50 GB');
      assert.strictEqual(formatBytes(1024 * 1024 * 250), '250.00 MB');
      assert.strictEqual(formatBytes(1024 * 45), '45.0 KB');
      assert.strictEqual(formatBytes(512), '512 B');
    });

    it('should execute command and track duration and exit code', async () => {
      const res = await runWithBudget([process.execPath, '-e', 'process.exit(0)'], {});
      assert.strictEqual(res.exitCode, 0);
      assert.ok(res.durationSec >= 0);
      assert.strictEqual(res.violations.length, 0);
    });

    it('should detect budget violations when thresholds are exceeded', async () => {
      // Artificial violation: 0.0001 seconds time budget for a 50ms command
      const res = await runWithBudget(
        [process.execPath, '-e', 'setTimeout(() => {}, 50)'],
        { maxTimeSec: 0.0001 }
      );
      assert.ok(res.violations.length > 0);
      assert.ok(res.violations.some((v) => v.includes('Runtime exceeded budget')));
    });
  });

  describe('Headless Terminal Statusline Emitter', () => {
    const mockMetrics: StatuslineMetrics = {
      cpuUsage: 14.2,
      memUsage: 62.8,
      tempC: 48.0,
      batteryPct: 95,
      batteryCharging: true,
    };

    it('should format statusline for JSON', () => {
      const json = formatStatusline(mockMetrics, 'json');
      const parsed = JSON.parse(json);
      assert.strictEqual(parsed.cpu, 14.2);
      assert.strictEqual(parsed.mem, 62.8);
      assert.strictEqual(parsed.temp, 48.0);
      assert.strictEqual(parsed.battery, 95);
      assert.strictEqual(parsed.charging, true);
    });

    it('should format statusline for tmux with ANSI/tmux color styling', () => {
      const tmux = formatStatusline(mockMetrics, 'tmux');
      assert.ok(tmux.includes('#[fg=cyan]CPU: 14%'));
      assert.ok(tmux.includes('#[fg=magenta]RAM: 63%'));
      assert.ok(tmux.includes('#[fg=yellow]48°C'));
      assert.ok(tmux.includes('⚡95%'));
    });

    it('should format statusline for starship and plain text', () => {
      const plain = formatStatusline(mockMetrics, 'plain');
      assert.strictEqual(plain, '🔥 14% | 63% | 48°C | ⚡95%');

      const starship = formatStatusline(mockMetrics, 'starship');
      assert.ok(starship.includes('14%'));
      assert.ok(starship.includes('63%'));
    });

    it('should format statusline for pango markup', () => {
      const pango = formatStatusline(mockMetrics, 'pango');
      assert.ok(pango.includes('<span color='));
      assert.ok(pango.includes('CPU: 14%'));
    });
  });

  describe('Container & Micro-VM Telemetry', () => {
    it('should detect container engine or return null safely', () => {
      const engine = detectContainerEngine();
      assert.ok(engine === 'docker' || engine === 'podman' || engine === null);
    });

    it('should collect container stats safely without throwing', () => {
      const stats = collectContainerStats();
      assert.ok(Array.isArray(stats));
    });
  });

  describe('Deep-Dive Process Inspector', () => {
    it('should inspect current node process metadata', () => {
      const details = inspectProcess(process.pid);
      assert.strictEqual(details.pid, process.pid);
      assert.ok(details.name.length > 0);
      assert.ok(details.threads >= 1);
      assert.ok(details.memRssBytes > 0);
      assert.ok(Array.isArray(details.openFiles));
      assert.ok(Array.isArray(details.sockets));
    });

    it('should throw an informative error when inspecting non-existent PID', () => {
      assert.throws(() => {
        inspectProcess(999999999);
      }, /not found or permission denied/);
    });
  });

  describe('Temperature Unit Support', () => {
    it('should format temperatures with custom units without reference errors', () => {
      const outC = execSync(`node dist/index.js --once --temp-unit c`, { encoding: 'utf-8' });
      assert.ok(outC.includes('PYRE'));
      const outF = execSync(`node dist/index.js --once --temp-unit f`, { encoding: 'utf-8' });
      assert.ok(outF.includes('PYRE'));
    });
  });

  describe('Menu Bar Plugin Generator (pyre xbar)', () => {
    it('should generate xbar plugin script into a specified directory', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyre-xbar-test-'));
      const outPath = await generateXbarPlugin({ dir: tmpDir, install: true });
      assert.ok(fs.existsSync(outPath));
      const content = fs.readFileSync(outPath, 'utf-8');
      assert.ok(content.includes('# <xbar.title>Pyre Monitor</xbar.title>'));
      assert.ok(content.includes('--once --json'));

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});

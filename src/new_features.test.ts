import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.PYRE_CONFIG_DIR = path.join(process.cwd(), 'node_modules', '.test-pyre-config');
fs.mkdirSync(process.env.PYRE_CONFIG_DIR, { recursive: true });

// Feature 1: Sleep Audit
import {
  parseDurationToMs,
  parsePmsetAssertions,
  parsePmsetLog,
  computeSleepAudit,
} from './sleepAuditCmd.js';

// Feature 2: Sweep
import {
  scanForCruft,
  getDirSizeBytes,
  checkGitStatus,
  KNOWN_TARGETS,
} from './sweepCmd.js';

// Feature 3: Awake
import {
  parseByteRate,
} from './awakeCmd.js';

// Feature 4: Net Audit
import {
  isLanAddress,
  categorizePort,
  parseLsofOutput,
  generatePfRules,
} from './netAuditCmd.js';

// Feature 5: Focus
import {
  CANDIDATE_PATTERNS,
  readFocusState,
  writeFocusState,
  type FocusState,
} from './focusCmd.js';

// Feature 6: Home Assistant
import {
  generateHaDiscoveryConfigs,
  getHaTelemetryPayload,
} from './haCmd.js';

describe('New Pyre Features (Retro ASCII UI & Telemetry Suite)', () => {

  describe('Standby & Sleep Diagnostics (pyre sleep-audit)', () => {
    it('should parse human duration strings to milliseconds', () => {
      assert.strictEqual(parseDurationToMs('1h'), 3600000);
      assert.strictEqual(parseDurationToMs('2d'), 172800000);
      assert.strictEqual(parseDurationToMs('30m'), 1800000);
      assert.strictEqual(parseDurationToMs('45s'), 45000);
      assert.strictEqual(parseDurationToMs(''), 86400000); // default 24h
    });

    it('should parse pmset assertions output correctly', () => {
      const sample = `
Listing Idle system sleep assertions:
   pid 128(coreaudiod): [0x0000000100018001] 00:01:23 PreventUserIdleSystemSleep named: "com.apple.audio.context"
   pid 345(backupd): [0x0000000200028002] 00:05:10 PreventUserIdleDisplaySleep named: "Time Machine Backup"
      `;
      const assertions = parsePmsetAssertions(sample);
      assert.strictEqual(assertions.length, 2);
      assert.strictEqual(assertions[0].pid, 128);
      assert.strictEqual(assertions[0].processName, 'coreaudiod');
      assert.strictEqual(assertions[0].type, 'PreventUserIdleSystemSleep');
      assert.strictEqual(assertions[0].details, 'com.apple.audio.context');
      assert.strictEqual(assertions[1].pid, 345);
      assert.strictEqual(assertions[1].processName, 'backupd');
    });

    it('should parse pmset sleep/wake log entries and calculate darkwakes', () => {
      const sample = `
2026-10-13 01:00:00 -0400 Sleep Entering Sleep state due to 'Clamshell Sleep': Using Batt (Charge:90%)
2026-10-13 03:00:00 -0400 DarkWake DarkWake from Deep Idle [CDNVA] due to 'RTC/Maintenance': Using Batt (Charge:88%)
2026-10-13 07:00:00 -0400 Wake Wake from Deep Idle [CDNVA] due to 'EC.LidOpen': Using Batt (Charge:85%)
      `;
      const { intervals, darkWakeCount } = parsePmsetLog(sample, 365 * 24 * 3600 * 1000);
      assert.strictEqual(darkWakeCount, 1);
      assert.strictEqual(intervals.length, 2);
      assert.strictEqual(intervals[0].drainPct, 2);
      assert.strictEqual(intervals[0].isDarkWake, true);
      assert.strictEqual(intervals[1].drainPct, 3);
      assert.strictEqual(intervals[1].isDarkWake, false);
    });

    it('should compute sleep audit report structure cleanly', () => {
      const report = computeSleepAudit({ since: '12h' });
      assert.ok(['Good', 'Fair', 'Poor'].includes(report.sleepScore));
      assert.ok(typeof report.drainRatePctPerHour === 'number');
      assert.ok(Array.isArray(report.activeAssertions));
    });
  });

  describe('Developer Cruft Sweeper (pyre sweep)', () => {
    it('should correctly measure directory sizes recursively', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyre-sweep-test-'));
      const subDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'package.json'), '{"name": "test"}');
      fs.writeFileSync(path.join(subDir, 'index.js'), 'console.log("hello world");');

      const size = getDirSizeBytes(subDir);
      assert.ok(size > 20);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should find targets and respect exclusions', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyre-sweep-scan-'));
      const targetDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(targetDir);
      fs.writeFileSync(path.join(targetDir, 'dummy.txt'), 'hello');

      const items = scanForCruft(tmpDir, { maxDepth: 2 });
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].targetName, 'node_modules');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should check git status without crashing', () => {
      const status = checkGitStatus(process.cwd());
      assert.ok(typeof status.isGitRepo === 'boolean');
      assert.ok(typeof status.isGitDirty === 'boolean');
    });
  });

  describe('Guardrailed Keep-Awake (pyre awake)', () => {
    it('should parse byte rate thresholds', () => {
      assert.strictEqual(parseByteRate('500KB/s'), 500 * 1024);
      assert.strictEqual(parseByteRate('10MB/s'), 10 * 1024 * 1024);
      assert.strictEqual(parseByteRate('1GB'), 1024 * 1024 * 1024);
      assert.strictEqual(parseByteRate('100B'), 100);
      assert.strictEqual(parseByteRate(''), 0);
    });
  });

  describe('Outbound Network & Privacy Flow Inspector (pyre net-audit)', () => {
    it('should accurately identify local LAN vs external Internet addresses', () => {
      assert.strictEqual(isLanAddress('127.0.0.1'), true);
      assert.strictEqual(isLanAddress('::1'), true);
      assert.strictEqual(isLanAddress('192.168.1.100'), true);
      assert.strictEqual(isLanAddress('10.0.0.5'), true);
      assert.strictEqual(isLanAddress('172.20.0.1'), true);
      assert.strictEqual(isLanAddress('1.1.1.1'), false);
      assert.strictEqual(isLanAddress('142.250.190.46'), false);
    });

    it('should categorize network ports and flag cleartext HTTP', () => {
      assert.strictEqual(categorizePort(80), 'HTTP (Cleartext)');
      assert.strictEqual(categorizePort(443), 'HTTPS (Encrypted)');
      assert.strictEqual(categorizePort(53), 'DNS');
      assert.strictEqual(categorizePort(22), 'SSH');
    });

    it('should parse lsof output lines into structured sockets', () => {
      const sample = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
curl 4567 user 5u IPv4 0x1234 0t0 TCP 192.168.1.10:50123->93.184.216.34:80 (ESTABLISHED)
Slack 8901 user 6u IPv4 0x5678 0t0 TCP 192.168.1.10:50124->140.82.112.4:443 (ESTABLISHED)`;

      const sockets = parseLsofOutput(sample);
      assert.strictEqual(sockets.length, 2);
      assert.strictEqual(sockets[0].pid, 4567);
      assert.strictEqual(sockets[0].processName, 'curl');
      assert.strictEqual(sockets[0].remotePort, 80);
      assert.strictEqual(sockets[0].isCleartextHttp, true);
      assert.strictEqual(sockets[0].isLocalLan, false);

      assert.strictEqual(sockets[1].pid, 8901);
      assert.strictEqual(sockets[1].processName, 'Slack');
      assert.strictEqual(sockets[1].remotePort, 443);
      assert.strictEqual(sockets[1].isCleartextHttp, false);
    });

    it('should generate PF packet filter blocking rules for cleartext HTTP', () => {
      const sampleReport = {
        timestamp: new Date().toISOString(),
        totalSockets: 1,
        cleartextHttpWarnings: 1,
        externalConnectionsCount: 1,
        apps: [],
        connections: [{
          pid: 1234,
          processName: 'test',
          protocol: 'TCP',
          localAddress: '192.168.1.2',
          localPort: 50000,
          remoteAddress: '93.184.216.34',
          remotePort: 80,
          state: 'ESTABLISHED',
          isCleartextHttp: true,
          isLocalLan: false,
          category: 'HTTP (Cleartext)',
        }],
      };
      const pfRules = generatePfRules(sampleReport);
      assert.ok(pfRules.includes('block out proto tcp to any port 80'));
      assert.ok(pfRules.includes('block out quick to 93.184.216.34'));
    });
  });

  describe('Turbo Focus & Process QoS Shield (pyre focus)', () => {
    it('should recognize background candidate processes', () => {
      const candidates = [
        'Dropbox',
        'OneDrive.exe',
        'Google Drive Helper',
        'Slack Helper (Renderer)',
        'Discord Helper',
        'mds_stores',
        'photolibraryd',
      ];
      for (const name of candidates) {
        const matches = CANDIDATE_PATTERNS.some(re => re.test(name));
        assert.strictEqual(matches, true, `Expected ${name} to match candidate patterns`);
      }
    });

    it('should persist and load focus state cleanly', () => {
      const testState: FocusState = {
        isActive: true,
        activatedAt: new Date().toISOString(),
        throttledProcesses: [{ pid: 99999, name: 'dummy_daemon', originalNice: 0, wasSuspended: false }],
      };
      writeFocusState(testState);
      const read = readFocusState();
      assert.strictEqual(read.isActive, true);
      assert.strictEqual(read.throttledProcesses.length, 1);
      assert.strictEqual(read.throttledProcesses[0].pid, 99999);

      // Clean up
      writeFocusState({ isActive: false, activatedAt: '', throttledProcesses: [] });
    });
  });

  describe('Home Assistant Telemetry Bridge (pyre ha)', () => {
    it('should generate valid Home Assistant MQTT Discovery topics and configurations', () => {
      const configs = generateHaDiscoveryConfigs('test_host');
      assert.strictEqual(configs.length, 4);
      assert.ok(configs.some(c => c.topic.includes('cpu_usage')));
      assert.ok(configs.some(c => c.topic.includes('cpu_temp')));
      assert.ok(configs.some(c => c.topic.includes('memory_usage')));
      assert.ok(configs.some(c => c.topic.includes('battery_level')));

      const cpuConfig = configs.find(c => c.topic.includes('cpu_usage'))!;
      assert.strictEqual(cpuConfig.payload.name, 'CPU Usage');
      assert.strictEqual(cpuConfig.payload.state_topic, 'pyre/test_host/state');
    });

    it('should gather valid Home Assistant telemetry payload', async () => {
      const payload = await getHaTelemetryPayload();
      assert.ok(typeof payload.hostname === 'string');
      assert.ok(typeof payload.cpu_pct === 'number');
      assert.ok(typeof payload.memory_pct === 'number');
      assert.ok(typeof payload.uptime_sec === 'number');
    });
  });

  describe('CLI Command Flag Aliases (--live, --ui, --check, etc.)', async () => {
    const { normalizeArgv } = await import('./index.js');
    const dummyOptions = [
      { long: '--interval', required: true },
      { long: '--theme', required: true },
      { long: '--detailed', required: false, optional: false },
      { long: '--compact', required: false, optional: false },
    ];

    it('should convert leading --command flags into subcommands', () => {
      const input = ['node', 'pyre', '--live'];
      const normalized = normalizeArgv(input, dummyOptions);
      assert.deepStrictEqual(normalized, ['node', 'pyre', 'live']);
    });

    it('should convert --ui and preserve downstream options', () => {
      const input = ['node', 'pyre', '--ui', '--compact'];
      const normalized = normalizeArgv(input, dummyOptions);
      assert.deepStrictEqual(normalized, ['node', 'pyre', 'ui', '--compact']);
    });

    it('should handle options placed before the --command flag', () => {
      const input = ['node', 'pyre', '--theme', 'dracula', '--live'];
      const normalized = normalizeArgv(input, dummyOptions);
      assert.deepStrictEqual(normalized, ['node', 'pyre', '--theme', 'dracula', 'live']);
    });

    it('should not alter commands after double-dash', () => {
      const input = ['node', 'pyre', 'run', '--', 'node', '--live'];
      const normalized = normalizeArgv(input, dummyOptions);
      assert.deepStrictEqual(normalized, ['node', 'pyre', 'run', '--', 'node', '--live']);
    });

    it('should convert --ports, --gpu, --leaks, and --zombies into subcommands', () => {
      assert.deepStrictEqual(normalizeArgv(['node', 'pyre', '--ports'], dummyOptions), ['node', 'pyre', 'ports']);
      assert.deepStrictEqual(normalizeArgv(['node', 'pyre', '--gpu'], dummyOptions), ['node', 'pyre', 'gpu']);
      assert.deepStrictEqual(normalizeArgv(['node', 'pyre', '--leaks'], dummyOptions), ['node', 'pyre', 'leaks']);
      assert.deepStrictEqual(normalizeArgv(['node', 'pyre', '--zombies'], dummyOptions), ['node', 'pyre', 'zombies']);
    });
  });

  describe('Listening Port, Socket & Local Dev Server Manager (pyre ports)', async () => {
    const {
      detectExposure,
      classifyServiceStack,
      parseListeningLsof,
      parseWindowsListeningNetstat,
      formatPortsPanelLines,
      killPortProcesses,
    } = await import('./portsCmd.js');

    it('should accurately classify LOCAL vs LAN bind addresses', () => {
      assert.strictEqual(detectExposure('127.0.0.1'), 'LOCAL');
      assert.strictEqual(detectExposure('::1'), 'LOCAL');
      assert.strictEqual(detectExposure('localhost'), 'LOCAL');
      assert.strictEqual(detectExposure('0.0.0.0'), 'LAN');
      assert.strictEqual(detectExposure('*'), 'LAN');
      assert.strictEqual(detectExposure('::'), 'LAN');
      assert.strictEqual(detectExposure('192.168.1.42'), 'LAN');
    });

    it('should detect popular developer service stacks and AI servers', () => {
      assert.strictEqual(classifyServiceStack(11434, 'ollama', 'ollama serve'), 'Ollama (LLM)');
      assert.strictEqual(classifyServiceStack(5173, 'node', 'node vite'), 'Vite Dev');
      assert.strictEqual(classifyServiceStack(3000, 'node', 'next-server'), 'Next.js');
      assert.strictEqual(classifyServiceStack(5432, 'postgres', 'postgres'), 'PostgreSQL');
      assert.strictEqual(classifyServiceStack(6379, 'redis-server', 'redis-server'), 'Redis');
      assert.strictEqual(classifyServiceStack(8080, 'com.docker.backend', 'com.docker.backend'), 'Container');
      assert.strictEqual(classifyServiceStack(8000, 'uvicorn', 'uvicorn app:main'), 'Python/API');
    });

    it('should parse lsof listening output and enrich with CPU/MEM stats', () => {
      const sampleLsof = [
        'COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
        'node      14200   dev   22u  IPv6 0x1111111111111111      0t0  TCP *:5173 (LISTEN)',
        'postgres   8421   dev    7u  IPv4 0x2222222222222222      0t0  TCP 127.0.0.1:5432 (LISTEN)',
        'ollama    29104   dev    3u  IPv4 0x3333333333333333      0t0  TCP 127.0.0.1:11434 (LISTEN)',
      ].join('\n');

      const procStats = new Map([
        [14200, { cpuPct: 12.4, memPct: 3.1, command: 'vite' }],
        [8421, { cpuPct: 0.5, memPct: 1.8, command: 'postgres' }],
        [29104, { cpuPct: 85.0, memPct: 24.5, command: 'ollama serve' }],
      ]);

      const ports = parseListeningLsof(sampleLsof, procStats);
      assert.strictEqual(ports.length, 3);
      assert.strictEqual(ports[0].port, 5173);
      assert.strictEqual(ports[0].exposure, 'LAN');
      assert.strictEqual(ports[0].serviceStack, 'Vite Dev');
      assert.strictEqual(ports[0].cpuPct, 12.4);

      assert.strictEqual(ports[1].port, 5432);
      assert.strictEqual(ports[1].exposure, 'LOCAL');
      assert.strictEqual(ports[1].serviceStack, 'PostgreSQL');

      assert.strictEqual(ports[2].port, 11434);
      assert.strictEqual(ports[2].serviceStack, 'Ollama (LLM)');
      assert.strictEqual(ports[2].memPct, 24.5);

      const panelLines = formatPortsPanelLines(ports, 100).map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
      assert.ok(panelLines.some(l => l.includes('PORT') && l.includes('STACK')));
      assert.ok(panelLines.some(l => l.includes(':5173') && l.includes('Vite Dev')));
    });

    it('should parse Windows netstat -ano listening output', () => {
      const sampleNetstat = [
        'Active Connections',
        '  Proto  Local Address          Foreign Address        State           PID',
        '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4320',
        '  TCP    127.0.0.1:6379         0.0.0.0:0              LISTENING       8812',
      ].join('\n');

      const procStats = new Map([
        [4320, { cpuPct: 4.2, memPct: 2.0, command: 'node.exe' }],
        [8812, { cpuPct: 0.1, memPct: 0.5, command: 'redis-server.exe' }],
      ]);

      const ports = parseWindowsListeningNetstat(sampleNetstat, procStats);
      assert.strictEqual(ports.length, 2);
      assert.strictEqual(ports[0].port, 3000);
      assert.strictEqual(ports[0].exposure, 'LAN');
      assert.strictEqual(ports[1].port, 6379);
      assert.strictEqual(ports[1].exposure, 'LOCAL');
      assert.strictEqual(ports[1].serviceStack, 'Redis');
    });

    it('should refuse to kill protected system PIDs on a port', () => {
      const entries = [{
        port: 80,
        protocol: 'TCP' as const,
        bindAddress: '0.0.0.0',
        exposure: 'LAN' as const,
        pid: 1,
        processName: 'launchd',
        user: 'root',
        cpuPct: 0.1,
        memPct: 0.1,
        command: '/sbin/launchd',
        serviceStack: 'HTTP/TLS',
      }];
      const res = killPortProcesses(80, { entries });
      assert.strictEqual(res.killedPids.length, 0);
      assert.deepStrictEqual(res.skippedProtected, [1]);
    });
  });

  describe('Deep GPU, Unified Memory & AI/LLM Workload Inspector (pyre gpu)', async () => {
    const {
      classifyGpuProcess,
      extractGpuProcesses,
      computeUnifiedMemoryBudget,
      evaluateLlmCapacity,
    } = await import('./gpuCmd.js');

    it('should classify AI/LLM, 3D, Media, and Compositor GPU workloads', () => {
      assert.strictEqual(classifyGpuProcess('ollama runner --model llama3'), 'LLM / GenAI');
      assert.strictEqual(classifyGpuProcess('python3 train_pytorch.py'), 'ML / Compute');
      assert.strictEqual(classifyGpuProcess('Blender --background'), '3D / Render');
      assert.strictEqual(classifyGpuProcess('VTDecoderXPCService'), 'Media / Video');
      assert.strictEqual(classifyGpuProcess('Google Chrome Helper (GPU)'), 'Browser GPU');
      assert.strictEqual(classifyGpuProcess('WindowServer'), 'Compositor / UI');
      assert.strictEqual(classifyGpuProcess('zsh'), null);
    });

    it('should compute Unified Memory 75% wired budget and LLM quantization fit matrix', () => {
      const totalRam = 32 * 1024 ** 3; // 32 GB
      const wiredRam = 6 * 1024 ** 3;  // 6 GB wired
      const usedRam = 10 * 1024 ** 3;  // 10 GB used
      const budget = computeUnifiedMemoryBudget(totalRam, wiredRam, usedRam);
      // 75% of 32 GB = 24 GB max wired; 24 - 6 = 18 GB remaining wired ceiling
      assert.strictEqual(budget.maxGpuWiredBytes, 24 * 1024 ** 3);
      assert.strictEqual(budget.availableForGpuBytes, 18 * 1024 ** 3);

      const matrix = evaluateLlmCapacity(budget.availableForGpuBytes, budget.maxGpuWiredBytes);
      const fit8b = matrix.find(m => m.modelSize === '7B / 8B' && m.quant === 'Q4_K_M')!;
      const fit70b = matrix.find(m => m.modelSize === '70B')!;
      assert.strictEqual(fit8b.status, 'FAST');
      assert.strictEqual(fit70b.status, 'SWAP_RISK');
    });

    it('should extract and rank active GPU processes', () => {
      const procs = extractGpuProcesses([
        { pid: 101, command: 'ollama serve', cpu: 140.0, mem: 25.0, user: 'dev' },
        { pid: 102, command: 'WindowServer', cpu: 18.5, mem: 2.0, user: '_windowserver' },
        { pid: 103, command: 'bash', cpu: 0.1, mem: 0.1, user: 'dev' },
      ], 16 * 1024 ** 3);
      assert.strictEqual(procs.length, 2);
      assert.strictEqual(procs[0].pid, 101);
      assert.strictEqual(procs[0].category, 'LLM / GenAI');
      assert.strictEqual(procs[0].estMemoryBytes, 4 * 1024 ** 3);
    });
  });

  describe('Real-Time Process Memory Leak Detector (pyre leaks)', async () => {
    const {
      computeLinearRegression,
      analyzeProcessMemorySeries,
    } = await import('./leaksCmd.js');

    it('should compute exact linear regression slope and R2 for monotonic growth', () => {
      const reg = computeLinearRegression([
        { xSec: 0, yBytes: 100 },
        { xSec: 1, yBytes: 110 },
        { xSec: 2, yBytes: 120 },
        { xSec: 3, yBytes: 130 },
        { xSec: 4, yBytes: 140 },
      ]);
      assert.ok(Math.abs(reg.slopeBytesPerSec - 10) < 1e-6);
      assert.ok(Math.abs(reg.rSquared - 1.0) < 1e-6);
    });

    it('should distinguish monotonic memory leaks from flat/GC sawtooth processes', () => {
      const mb = 1024 * 1024;
      const map = new Map([
        [5001, [
          { timestampMs: 0, pid: 5001, command: 'leaky-worker', user: 'dev', rssBytes: 200 * mb },
          { timestampMs: 10000, pid: 5001, command: 'leaky-worker', user: 'dev', rssBytes: 210 * mb },
          { timestampMs: 20000, pid: 5001, command: 'leaky-worker', user: 'dev', rssBytes: 220 * mb },
          { timestampMs: 30000, pid: 5001, command: 'leaky-worker', user: 'dev', rssBytes: 230 * mb },
          { timestampMs: 40000, pid: 5001, command: 'leaky-worker', user: 'dev', rssBytes: 240 * mb },
        ]],
        [5002, [
          { timestampMs: 0, pid: 5002, command: 'stable-server', user: 'dev', rssBytes: 150 * mb },
          { timestampMs: 10000, pid: 5002, command: 'stable-server', user: 'dev', rssBytes: 152 * mb },
          { timestampMs: 20000, pid: 5002, command: 'stable-server', user: 'dev', rssBytes: 149 * mb },
          { timestampMs: 30000, pid: 5002, command: 'stable-server', user: 'dev', rssBytes: 151 * mb },
          { timestampMs: 40000, pid: 5002, command: 'stable-server', user: 'dev', rssBytes: 150 * mb },
        ]],
      ]);

      const candidates = analyzeProcessMemorySeries(map, 16 * 1024 * mb);
      const leaky = candidates.find(c => c.pid === 5001)!;
      const stable = candidates.find(c => c.pid === 5002)!;
      assert.strictEqual(leaky.severity, 'CRITICAL');
      assert.ok(Math.abs(leaky.growthMbPerMin - 60) < 0.5);
      assert.ok(leaky.rSquared > 0.99);
      assert.ok(leaky.estimatedOomMinutes !== null && leaky.estimatedOomMinutes > 0);
      assert.strictEqual(stable.severity, 'STABLE');
    });
  });

  describe('Zombie, Stuck I/O & Orphan Hunter (pyre zombies)', async () => {
    const {
      parseElapsedToSeconds,
      isDevOrphanCandidate,
      parseZombieScanPsOutput,
      reapAndCleanProcesses,
    } = await import('./zombiesCmd.js');

    it('should parse ps elapsed time strings accurately', () => {
      assert.strictEqual(parseElapsedToSeconds('45'), 45);
      assert.strictEqual(parseElapsedToSeconds('05:30'), 330);
      assert.strictEqual(parseElapsedToSeconds('02:10:00'), 7800);
      assert.strictEqual(parseElapsedToSeconds('1-00:00:00'), 86400);
    });

    it('should classify zombies, stuck I/O, detached dev orphans, and spinlocks', () => {
      assert.strictEqual(isDevOrphanCandidate('node /project/node_modules/.bin/vitest', 1, 300), true);
      assert.strictEqual(isDevOrphanCandidate('playwright-core', 1, 120), true);
      assert.strictEqual(isDevOrphanCandidate('launchd', 1, 300), false);

      const samplePs = [
        '  PID  PPID USER     STAT   %CPU  %MEM     ELAPSED COMMAND',
        '    1     0 root     Ss      0.1   0.1  2-00:00:00 /sbin/launchd',
        ' 3100  1000 dev      S       0.5   1.0    01:20:00 /usr/local/bin/parent-daemon',
        ' 3105  3100 dev      Z       0.0   0.0       10:00 <defunct>',
        ' 4200     1 dev      R      45.0   2.1       05:00 node /app/node_modules/.bin/vitest',
        ' 5100  1000 dev      U       0.0   0.4       02:00 nfs-mount-helper',
      ].join('\n');

      const entries = parseZombieScanPsOutput(samplePs);
      assert.strictEqual(entries.length, 3);
      const zombie = entries.find(e => e.pid === 3105)!;
      assert.strictEqual(zombie.category, 'ZOMBIE');
      assert.strictEqual(zombie.ppid, 3100);
      assert.strictEqual(zombie.parentCommand, '/usr/local/bin/parent-daemon');

      const orphan = entries.find(e => e.pid === 4200)!;
      assert.strictEqual(orphan.category, 'DEV_ORPHAN');

      const stuck = entries.find(e => e.pid === 5100)!;
      assert.strictEqual(stuck.category, 'STUCK_IO');

      const dryRunRes = reapAndCleanProcesses(entries, { dryRun: true });
      assert.deepStrictEqual(dryRunRes.reapedParentPids, [3100]);
      assert.deepStrictEqual(dryRunRes.terminatedOrphanPids, [4200]);
    });
  });

  describe('BTOP++ Formatter Upgrades (Reverse Sort, Sort Indicators, Sparklines, Ports Panel)', async () => {
    const { formatTable, sortProcesses } = await import('./formatters/index.js');

    it('should reverse process sort order when sortReverse is true', () => {
      const sampleProcs = [
        { pid: 10, command: 'alpha', cpu: 50, mem: 10, user: 'root' },
        { pid: 20, command: 'beta', cpu: 5, mem: 40, user: 'dev' },
        { pid: 30, command: 'gamma', cpu: 90, mem: 20, user: 'dev' },
      ];
      const descCpu = sortProcesses(sampleProcs, 'cpu', false);
      assert.deepStrictEqual(descCpu.map(p => p.pid), [30, 10, 20]);

      const ascCpu = sortProcesses(sampleProcs, 'cpu', true);
      assert.deepStrictEqual(ascCpu.map(p => p.pid), [20, 10, 30]);

      const descCmd = sortProcesses(sampleProcs, 'command', false);
      assert.strictEqual(descCmd[0].command, 'alpha');
      const ascCmd = sortProcesses(sampleProcs, 'command', true);
      assert.strictEqual(ascCmd[0].command, 'gamma');
    });

    it('should render directional sort arrows and per-process sparkline in FOLLOWING banner', () => {
      const dummyData: any = {
        timestamp: new Date().toISOString(),
        header: { hostname: 'test-mac', os: 'macOS', uptime: '1d', arch: 'arm64' },
        cpu: { brand: 'Apple M3 Max', cores: 16, physicalCores: 16, usage: 25, frequency: 3500, loadAvg: [1.5, 1.2, 1.0], temperature: 52, perCore: [20, 30] },
        memory: { total: 32e9, used: 16e9, free: 16e9, active: 12e9, available: 16e9, swapTotal: 0, swapUsed: 0, usagePercent: 50 },
        gpu: null,
        disk: [{ filesystem: 'apfs', size: 500e9, used: 200e9, available: 300e9, capacity: '40%', mountpoint: '/' }],
        network: { iface: 'en0', rxBytes: 1000, txBytes: 1000, rxSec: 500, txSec: 200, topConnections: [] },
        battery: null,
        thermal: { state: 'nominal', temperatures: {}, fans: [] },
        power: null,
        tasks: { total: 200, running: 3, sleeping: 197, threads: 900 },
        processes: [
          { pid: 4242, command: 'node server.js', cpu: 34.5, mem: 4.2, user: 'dev', state: 'R', threads: 12, runtime: '10:00' },
        ],
      };

      const out = formatTable(dummyData, {
        width: 110,
        sortBy: 'cpu',
        sortReverse: true,
        trackedPid: 4242,
        trackedPidHistory: { cpu: [10, 20, 30, 34.5], mem: [4.0, 4.1, 4.2, 4.2] },
      }).replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(out.includes('CPU%▲'), 'Expected ascending sort indicator CPU%▲ in process header');
      assert.ok(out.includes('PID 4242'), 'Expected tracked PID 4242 banner');
      assert.ok(out.includes('34.5%'), 'Expected live CPU percentage in FOLLOWING banner');
    });
  });

});


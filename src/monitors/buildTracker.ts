/**
 * Build System Tracker.
 *
 * Scans active processes for compiler invocations (xcodebuild, msbuild, cargo, rustc,
 * clang, cl.exe, make, ninja, bazel, cmake, go build), tracking compiler
 * parallelism, CPU/RAM usage, and estimated elapsed time across macOS, Linux, and Windows.
 */
import { run } from './run.js';
import { collectWindowsProcesses } from './platform/windows.js';

export interface ActiveBuild {
  tool: 'xcodebuild' | 'cargo' | 'swift' | 'make' | 'ninja' | 'bazel' | 'go' | 'clang' | 'compiler' | 'msbuild' | 'cmake';
  rootPid: number;
  command: string;
  compilerProcesses: number;
  totalCpu: number;
  totalMem: number;
  elapsedSec: number;
  target?: string;
}

export async function collectBuilds(): Promise<ActiveBuild[]> {
  try {
    const builds: Map<string, ActiveBuild> = new Map();

    const buildToolPatterns: { name: ActiveBuild['tool']; match: RegExp }[] = [
      { name: 'msbuild', match: /\b(msbuild|devenv)\b/i },
      { name: 'xcodebuild', match: /xcodebuild/i },
      { name: 'cargo', match: /\bcargo\s+(build|check|test|run)?\b/i },
      { name: 'swift', match: /\bswift\s+(build|test)\b/i },
      { name: 'make', match: /\b(make|nmake)\b/i },
      { name: 'ninja', match: /\bninja\b/i },
      { name: 'cmake', match: /\bcmake\b/i },
      { name: 'bazel', match: /\bbazel\b/i },
      { name: 'go', match: /\bgo\s+(build|test|run)\b/i },
    ];

    const compilerMatch = /(clang|swift-frontend|rustc|go tool compile|gcc|g\+\+|ghc|cl\.exe|csc\.exe|link\.exe)/i;

    interface ProcEntry {
      pid: number;
      cpu: number;
      mem: number;
      elapsedSec: number;
      cmd: string;
    }

    const procList: ProcEntry[] = [];

    if (process.platform === 'win32') {
      const winProcs = await collectWindowsProcesses();
      for (const p of winProcs) {
        procList.push({
          pid: p.pid,
          cpu: p.cpu,
          mem: p.mem,
          elapsedSec: p.runtime || 0,
          cmd: p.command,
        });
      }
    } else {
      const raw = await run('ps -eo pid,ppid,pcpu,pmem,etime,command -r 2>/dev/null', '');
      if (!raw) return [];
      const lines = raw.split('\n').slice(1);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const pid = parseInt(parts[0], 10);
        const cpu = parseFloat(parts[2]) || 0;
        const mem = parseFloat(parts[3]) || 0;
        const etimeStr = parts[4];
        const cmd = parts.slice(5).join(' ');

        let elapsedSec = 0;
        const etimeParts = etimeStr.split(':').map(Number);
        if (etimeParts.length === 2) elapsedSec = etimeParts[0] * 60 + etimeParts[1];
        else if (etimeParts.length === 3) elapsedSec = etimeParts[0] * 3600 + etimeParts[1] * 60 + etimeParts[2];

        procList.push({ pid, cpu, mem, elapsedSec, cmd });
      }
    }

    // First pass: identify build roots
    for (const p of procList) {
      for (const pattern of buildToolPatterns) {
        if (pattern.match.test(p.cmd)) {
          builds.set(pattern.name, {
            tool: pattern.name,
            rootPid: p.pid,
            command: p.cmd.slice(0, 80),
            compilerProcesses: 1,
            totalCpu: p.cpu,
            totalMem: p.mem,
            elapsedSec: p.elapsedSec,
            target: p.cmd.split(' ').slice(1, 4).join(' '),
          });
          break;
        }
      }
    }

    // Second pass: associate child compiler processes
    for (const p of procList) {
      if (compilerMatch.test(p.cmd)) {
        if (builds.size > 0) {
          const firstBuild = builds.values().next().value;
          if (firstBuild) {
            firstBuild.compilerProcesses += 1;
            firstBuild.totalCpu += p.cpu;
            firstBuild.totalMem += p.mem;
          }
        } else {
          const key = 'compiler';
          const existing = builds.get(key);
          if (existing) {
            existing.compilerProcesses += 1;
            existing.totalCpu += p.cpu;
            existing.totalMem += p.mem;
          } else {
            builds.set(key, {
              tool: 'compiler',
              rootPid: p.pid,
              command: p.cmd.slice(0, 80),
              compilerProcesses: 1,
              totalCpu: p.cpu,
              totalMem: p.mem,
              elapsedSec: p.elapsedSec,
            });
          }
        }
      }
    }

    return Array.from(builds.values());
  } catch {
    return [];
  }
}

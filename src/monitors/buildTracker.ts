/**
 * Build System Tracker.
 *
 * Scans active processes for compiler invocations (xcodebuild, cargo, rustc,
 * clang, swift-frontend, make, ninja, bazel, go build), tracking compiler
 * parallelism, CPU/RAM usage, and estimated elapsed time.
 */
import { run } from './run.js';

export interface ActiveBuild {
  tool: 'xcodebuild' | 'cargo' | 'swift' | 'make' | 'ninja' | 'bazel' | 'go' | 'clang' | 'compiler';
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
    const raw = await run('ps -eo pid,ppid,pcpu,pmem,etime,command -r', '');
    if (!raw) return [];

    const lines = raw.split('\n').slice(1);
    const builds: Map<string, ActiveBuild> = new Map();

    const buildToolPatterns: { name: ActiveBuild['tool']; match: RegExp }[] = [
      { name: 'xcodebuild', match: /xcodebuild/i },
      { name: 'cargo', match: /\bcargo\s+(build|check|test|run)\b/i },
      { name: 'swift', match: /\bswift\s+(build|test)\b/i },
      { name: 'make', match: /\bmake\b/i },
      { name: 'ninja', match: /\bninja\b/i },
      { name: 'bazel', match: /\bbazel\b/i },
      { name: 'go', match: /\bgo\s+(build|test|run)\b/i },
    ];

    const compilerMatch = /(clang|swift-frontend|rustc|go tool compile|gcc|g\+\+|ghc)/i;

    // First pass: identify build roots
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const pid = parseInt(parts[0], 10);
      const cpu = parseFloat(parts[2]) || 0;
      const mem = parseFloat(parts[3]) || 0;
      const etimeStr = parts[4];
      const cmd = parts.slice(5).join(' ');

      for (const pattern of buildToolPatterns) {
        if (pattern.match.test(cmd)) {
          let elapsedSec = 0;
          const etimeParts = etimeStr.split(':').map(Number);
          if (etimeParts.length === 2) elapsedSec = etimeParts[0] * 60 + etimeParts[1];
          else if (etimeParts.length === 3) elapsedSec = etimeParts[0] * 3600 + etimeParts[1] * 60 + etimeParts[2];

          builds.set(pattern.name, {
            tool: pattern.name,
            rootPid: pid,
            command: cmd.slice(0, 80),
            compilerProcesses: 1,
            totalCpu: cpu,
            totalMem: mem,
            elapsedSec,
            target: cmd.split(' ').slice(1, 4).join(' '),
          });
          break;
        }
      }
    }

    // Second pass: associate child compiler processes
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;

      const cpu = parseFloat(parts[2]) || 0;
      const mem = parseFloat(parts[3]) || 0;
      const cmd = parts.slice(5).join(' ');

      if (compilerMatch.test(cmd)) {
        // If an active build was found, associate this compiler worker
        if (builds.size > 0) {
          const firstBuild = builds.values().next().value;
          if (firstBuild) {
            firstBuild.compilerProcesses += 1;
            firstBuild.totalCpu += cpu;
            firstBuild.totalMem += mem;
          }
        } else {
          // Standalone compiler invocation
          const key = 'compiler';
          const existing = builds.get(key);
          if (existing) {
            existing.compilerProcesses += 1;
            existing.totalCpu += cpu;
            existing.totalMem += mem;
          } else {
            builds.set(key, {
              tool: 'compiler',
              rootPid: parseInt(parts[0], 10),
              command: cmd.slice(0, 80),
              compilerProcesses: 1,
              totalCpu: cpu,
              totalMem: mem,
              elapsedSec: 0,
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

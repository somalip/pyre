/**
 * pyre containers — Container & Micro-VM Telemetry.
 *
 * Discovers running containers across Docker, Podman, and OrbStack,
 * reporting container names, CPU load, memory consumption, and network I/O.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export interface ContainerStats {
  id: string;
  name: string;
  engine: 'docker' | 'podman' | 'orbstack';
  cpuPct: string;
  memUsage: string;
  memPct: string;
  netIO: string;
}

export function detectContainerEngine(): 'docker' | 'podman' | null {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return 'docker';
  } catch {
    try {
      execSync('podman --version', { stdio: 'ignore' });
      return 'podman';
    } catch {
      return null;
    }
  }
}

export function collectContainerStats(): ContainerStats[] {
  const engine = detectContainerEngine();
  if (!engine) return [];

  try {
    const raw = execSync(`${engine} stats --no-stream --format "{{.ID}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    });

    const lines = raw.trim().split('\n').filter(Boolean);
    const stats: ContainerStats[] = [];

    for (const l of lines) {
      const parts = l.split('\t');
      if (parts.length >= 6) {
        stats.push({
          id: parts[0]?.trim() || '',
          name: parts[1]?.trim() || '',
          engine,
          cpuPct: parts[2]?.trim() || '0%',
          memUsage: parts[3]?.trim() || '0B',
          memPct: parts[4]?.trim() || '0%',
          netIO: parts[5]?.trim() || '0B/0B',
        });
      }
    }

    return stats;
  } catch {
    // Engine daemon might not be running
    return [];
  }
}

export async function runContainersCommand(opts?: { json?: boolean }): Promise<void> {
  const stats = collectContainerStats();
  const engine = detectContainerEngine();

  if (opts?.json) {
    console.log(JSON.stringify({ engine: engine || 'none', containers: stats }, null, 2));
    return;
  }

  console.log(chalk.bold('\n  🔥 pyre containers — Container & Micro-VM Telemetry\n'));

  if (!engine) {
    console.log(chalk.yellow('  No container engine (Docker / Podman) detected in PATH.'));
    console.log(chalk.dim('  Install Docker or Podman to enable container performance telemetry.\n'));
    return;
  }

  if (stats.length === 0) {
    console.log(chalk.dim(`  Engine: ${engine} (Active, 0 running containers detected)\n`));
    return;
  }

  console.log(chalk.dim(`  Engine: ${engine} (${stats.length} active containers)\n`));

  console.log(`  ${'ID'.padEnd(14)} ${'Name'.padEnd(24)} ${'CPU %'.padEnd(10)} ${'Memory Usage'.padEnd(22)} ${'Net I/O'}`);
  console.log(chalk.dim('  ─'.repeat(40)));

  for (const c of stats) {
    const idCol = chalk.dim(c.id.padEnd(14));
    const nameCol = chalk.bold.cyan(c.name.slice(0, 22).padEnd(24));
    const cpuCol = chalk.yellow(c.cpuPct.padEnd(10));
    const memCol = chalk.magenta(`${c.memUsage} (${c.memPct})`.padEnd(22));
    const netCol = chalk.dim(c.netIO);
    console.log(`  ${idCol} ${nameCol} ${cpuCol} ${memCol} ${netCol}`);
  }

  console.log();
}

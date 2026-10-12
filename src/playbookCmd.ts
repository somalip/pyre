/**
 * pyre playbook — Multi-Step Macro Recipes & Playbooks.
 *
 * Runs sequenced Pyre diagnostic, optimization, and benchmark workflows
 * with progress reporting and consolidated summary logs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { getConfigDir } from './state/config.js';

export interface PlaybookStep {
  name: string;
  command: string; // e.g. "check --detailed"
  description?: string;
  allowFailure?: boolean;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  category: 'audit' | 'bench' | 'maintenance' | 'triage';
  steps: PlaybookStep[];
}

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: 'audit',
    name: 'Full System Health Audit',
    description: 'Run health check, diagnostic doctor, drive S.M.A.R.T., and package manager audit',
    category: 'audit',
    steps: [
      { name: 'System Health Check', command: 'check' },
      { name: 'Doctor Diagnostics', command: 'doctor' },
      { name: 'Drive S.M.A.R.T. Health', command: 'smart', allowFailure: true },
      { name: 'Package Manager Health', command: 'brew', allowFailure: true },
    ],
  },
  {
    id: 'clean',
    name: 'Complete Mac Maintenance & Cleanup',
    description: 'Quit long-idle background apps, purge inactive memory, clean caches, flush DNS',
    category: 'maintenance',
    steps: [
      { name: 'Quit Idle Apps', command: 'optimize apps --idle 2h -y' },
      { name: 'Purge Inactive Memory', command: 'optimize memory -y' },
      { name: 'Clean Application Caches', command: 'optimize caches --clean -y' },
      { name: 'Flush DNS Resolver Cache', command: 'optimize dns -y' },
    ],
  },
  {
    id: 'triage',
    name: 'Performance Spike & Incident Triage',
    description: 'Detect historical anomalies, inspect active network usage, and audit drivers',
    category: 'triage',
    steps: [
      { name: 'Z-Score Anomaly Digest', command: 'anomalies --since 1d' },
      { name: 'Per-Application Network Usage', command: 'netusage --top 10' },
      { name: 'System Extensions Audit', command: 'extensions', allowFailure: true },
    ],
  },
  {
    id: 'bench',
    name: 'Quick Compute & Storage Baseline',
    description: 'Execute CPU Pi benchmark and query physical disk health',
    category: 'bench',
    steps: [
      { name: 'CPU Pi Benchmark', command: 'benchmark' },
      { name: 'Physical Disk Health', command: 'smart', allowFailure: true },
    ],
  },
];

export function getCustomPlaybooks(): Playbook[] {
  const filePath = path.join(getConfigDir(), 'playbooks.json');
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getAllPlaybooks(): Playbook[] {
  return [...BUILTIN_PLAYBOOKS, ...getCustomPlaybooks()];
}

export async function runPlaybook(playbookId: string): Promise<boolean> {
  const all = getAllPlaybooks();
  const playbook = all.find((p) => p.id === playbookId || p.name.toLowerCase() === playbookId.toLowerCase());

  if (!playbook) {
    console.error(chalk.red(`\n  ✖ Unknown playbook: '${playbookId}'`));
    console.log(chalk.dim(`  Available playbooks: ${all.map((p) => p.id).join(', ')}\n`));
    return false;
  }

  console.log(chalk.bold(`\n  🔥 pyre playbook: ${chalk.hex('#ff6a39')(playbook.name)}`));
  console.log(chalk.dim(`  ${playbook.description}`));
  console.log(chalk.dim(`  Steps (${playbook.steps.length}):`));
  playbook.steps.forEach((step, idx) => {
    console.log(chalk.dim(`    ${idx + 1}. ${step.name} (pyre ${step.command})`));
  });
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────\n'));

  const scriptPath = process.argv[1];
  const startTime = Date.now();
  let stepIndex = 1;
  let allSuccess = true;

  for (const step of playbook.steps) {
    console.log(chalk.bold.cyan(`\n▶ [${stepIndex}/${playbook.steps.length}] ${step.name} ...`));
    console.log(chalk.dim(`  $ pyre ${step.command}\n`));

    const tokens = step.command.trim().split(/\s+/).filter(Boolean);
    const result = spawnSync(process.argv[0], [scriptPath, ...tokens], {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.status !== 0 && !step.allowFailure) {
      console.log(chalk.red(`\n  ✖ Step '${step.name}' failed with exit code ${result.status}`));
      allSuccess = false;
      break;
    } else if (result.status !== 0 && step.allowFailure) {
      console.log(chalk.yellow(`\n  ⚠ Step '${step.name}' failed but marked as optional — continuing...`));
    } else {
      console.log(chalk.green(`\n  ✔ Step '${step.name}' completed.`));
    }
    stepIndex++;
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.dim('\n  ─────────────────────────────────────────────────────────────'));
  if (allSuccess) {
    console.log(chalk.bold.green(`  ✔ Playbook '${playbook.name}' completed successfully in ${durationSec}s\n`));
  } else {
    console.log(chalk.bold.red(`  ✖ Playbook '${playbook.name}' aborted after ${durationSec}s\n`));
  }

  return allSuccess;
}

export function listPlaybooks(): void {
  const all = getAllPlaybooks();
  console.log(chalk.bold('\n  🔥 pyre Playbooks & Macro Recipes:\n'));
  for (const p of all) {
    console.log(`  • ${chalk.bold.hex('#ff6a39')(p.id.padEnd(12))} ${p.name}`);
    console.log(chalk.dim(`    ${p.description}`));
    console.log(chalk.dim(`    Steps: ${p.steps.map((s) => s.command).join(' ➔ ')}\n`));
  }
}

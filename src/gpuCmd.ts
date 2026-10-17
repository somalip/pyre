/**
 * pyre gpu — Deep GPU, Unified Memory, ANE & AI/LLM Workload Inspector.
 *
 * Inspects GPU utilization, power draw (GPU / ANE / CPU Watts), Apple Silicon
 * Unified Memory / VRAM allocation budgets, active GPU/Metal/CUDA/ML processes,
 * and evaluates real-time local LLM quantization fit (3B to 70B models).
 */
import chalk from 'chalk';
import { collectAll } from './monitors/index.js';
import { formatBytes, gaugeBar } from './formatters/render.js';

export type GpuWorkloadCategory =
  | 'LLM / GenAI'
  | 'ML / Compute'
  | '3D / Render'
  | 'Media / Video'
  | 'Compositor / UI'
  | 'Browser GPU';

export interface GpuProcessEntry {
  pid: number;
  command: string;
  user: string;
  cpuPct: number;
  memPct: number;
  estMemoryBytes: number;
  category: GpuWorkloadCategory;
}

export interface LlmFitEntry {
  modelSize: string;
  quant: string;
  requiredGb: number;
  status: 'FAST' | 'TIGHT' | 'SWAP_RISK';
  headroomGb: number;
}

export interface UnifiedMemoryBudget {
  totalSystemBytes: number;
  maxGpuWiredBytes: number;
  currentWiredBytes: number;
  availableForGpuBytes: number;
  wiredUtilizationPct: number;
}

/**
 * Classify a process command string if it is a known GPU, Metal, CUDA, ML, or LLM workload.
 */
export function classifyGpuProcess(command: string): GpuWorkloadCategory | null {
  const c = command.toLowerCase();

  if (
    c.includes('ollama') ||
    c.includes('llama-server') ||
    c.includes('llama-cli') ||
    c.includes('llama.cpp') ||
    c.includes('lm studio') ||
    c.includes('lmstudio') ||
    c.includes('vllm') ||
    c.includes('mlx_lm') ||
    c.includes('koboldcpp') ||
    c.includes('text-generation')
  ) {
    return 'LLM / GenAI';
  }

  if (
    c.includes('comfyui') ||
    c.includes('stable-diffusion') ||
    c.includes('torch') ||
    c.includes('pytorch') ||
    c.includes('tensorflow') ||
    c.includes('jax') ||
    c.includes('triton') ||
    c.includes('ane') ||
    c.includes('coreml') ||
    c.includes('jupyter')
  ) {
    return 'ML / Compute';
  }

  if (
    c.includes('blender') ||
    c.includes('unreal') ||
    c.includes('unity') ||
    c.includes('maya') ||
    c.includes('cinema 4d') ||
    c.includes('houdini') ||
    c.includes('godot') ||
    c.includes('metal')
  ) {
    return '3D / Render';
  }

  if (
    c.includes('ffmpeg') ||
    c.includes('handbrake') ||
    c.includes('davinci') ||
    c.includes('resolve') ||
    c.includes('final cut') ||
    c.includes('premiere') ||
    c.includes('after effects') ||
    c.includes('obs') ||
    c.includes('vtdecoder') ||
    c.includes('vtencoder') ||
    c.includes('medianalysisd')
  ) {
    return 'Media / Video';
  }

  if (
    c.includes('gpu-process') ||
    c.includes('helper (gpu)') ||
    c.includes('--type=gpu-process') ||
    c.includes('webkit.gpu')
  ) {
    return 'Browser GPU';
  }

  if (
    c.includes('windowserver') ||
    c.includes('dwm.exe') ||
    c.includes('xorg') ||
    c.includes('wayland') ||
    c.includes('hyprland') ||
    c.includes('kwin') ||
    c.includes('gnome-shell') ||
    c.includes('sway')
  ) {
    return 'Compositor / UI';
  }

  return null;
}

/**
 * Filter and rank GPU/AI/ML-attributed processes from the system process list.
 */
export function extractGpuProcesses(
  processes: { pid: number; user: string; cpu: number; mem: number; command: string; isGpuOrMlAttributed?: boolean }[],
  totalMemBytes: number
): GpuProcessEntry[] {
  const results: GpuProcessEntry[] = [];

  for (const p of processes) {
    const cat = classifyGpuProcess(p.command) || (p.isGpuOrMlAttributed ? 'ML / Compute' : null);
    if (!cat) continue;
    const estMemoryBytes = Math.round((p.mem / 100) * totalMemBytes);
    results.push({
      pid: p.pid,
      command: p.command,
      user: p.user,
      cpuPct: p.cpu,
      memPct: p.mem,
      estMemoryBytes,
      category: cat,
    });
  }

  return results.sort((a, b) => b.estMemoryBytes - a.estMemoryBytes || b.cpuPct - a.cpuPct);
}

/**
 * Calculate Unified Memory / VRAM ceiling and available headroom for GPU/AI workloads.
 * On Apple Silicon macOS, the default kernel `iogpu.wired_limit_mb` is ~75% of total RAM.
 */
export function computeUnifiedMemoryBudget(
  totalBytes: number,
  wiredBytes: number | undefined,
  usedBytes: number
): UnifiedMemoryBudget {
  const maxGpuWiredBytes = Math.round(totalBytes * 0.75);
  const currentWiredBytes = wiredBytes ?? Math.round(usedBytes * 0.35);
  // Available memory for new GPU/LLM allocations is bounded by both free+reclaimable RAM and the wired ceiling
  const nonWiredUsed = Math.max(0, usedBytes - currentWiredBytes);
  const reclaimableEstimate = Math.round(nonWiredUsed * 0.4);
  const freeSystemBytes = Math.max(0, totalBytes - usedBytes) + reclaimableEstimate;
  const remainingWiredCeiling = Math.max(0, maxGpuWiredBytes - currentWiredBytes);
  const availableForGpuBytes = Math.min(freeSystemBytes, remainingWiredCeiling);
  const wiredUtilizationPct = maxGpuWiredBytes > 0
    ? Math.min(100, Math.round((currentWiredBytes / maxGpuWiredBytes) * 100))
    : 0;

  return {
    totalSystemBytes: totalBytes,
    maxGpuWiredBytes,
    currentWiredBytes,
    availableForGpuBytes,
    wiredUtilizationPct,
  };
}

/**
 * Evaluate which standard LLM sizes and quantizations fit comfortably into
 * current available GPU / Unified Memory headroom.
 */
export function evaluateLlmCapacity(
  availableBytes: number,
  maxGpuBudgetBytes: number
): LlmFitEntry[] {
  const availGb = availableBytes / (1024 ** 3);
  const maxGb = maxGpuBudgetBytes / (1024 ** 3);

  const specs: { modelSize: string; quant: string; requiredGb: number }[] = [
    { modelSize: '3B', quant: 'Q4_K_M', requiredGb: 2.2 },
    { modelSize: '7B / 8B', quant: 'Q4_K_M', requiredGb: 4.8 },
    { modelSize: '7B / 8B', quant: 'Q8_0', requiredGb: 8.5 },
    { modelSize: '14B', quant: 'Q4_K_M', requiredGb: 9.2 },
    { modelSize: '32B', quant: 'Q4_K_M', requiredGb: 19.8 },
    { modelSize: '70B', quant: 'Q4_K_M', requiredGb: 42.5 },
  ];

  return specs.map(spec => {
    const headroomGb = Number((availGb - spec.requiredGb).toFixed(2));
    let status: 'FAST' | 'TIGHT' | 'SWAP_RISK';
    if (availGb >= spec.requiredGb * 1.15) {
      status = 'FAST';
    } else if (maxGb >= spec.requiredGb && availGb >= spec.requiredGb * 0.85) {
      status = 'TIGHT';
    } else {
      status = 'SWAP_RISK';
    }
    return {
      ...spec,
      status,
      headroomGb,
    };
  });
}

function truncatePlain(s: string, width: number): string {
  if (s.length <= width) return s;
  return width <= 1 ? s.slice(0, width) : s.slice(0, width - 1) + '…';
}

export async function runGpuCommand(opts?: { json?: boolean }): Promise<void> {
  const data = await collectAll({ detailed: true, processLimit: 0 });
  const budget = computeUnifiedMemoryBudget(
    data.memory.total,
    data.memory.wiredBytes,
    data.memory.used
  );
  const gpuProcesses = extractGpuProcesses(data.processes, data.memory.total);
  const llmFits = evaluateLlmCapacity(budget.availableForGpuBytes, budget.maxGpuWiredBytes);

  if (opts?.json) {
    console.log(JSON.stringify({
      timestamp: data.timestamp,
      gpu: data.gpu,
      power: data.power,
      unifiedMemoryBudget: budget,
      gpuProcesses,
      llmReadiness: llmFits,
    }, null, 2));
    return;
  }

  const gpuModel = data.gpu?.model || `${data.cpu.brand} Integrated Graphics`;
  const gpuUtil = data.gpu?.utilization ?? 0;
  const gpuWatts = data.power?.gpuWatts ?? data.gpu?.powerDraw;
  const aneWatts = data.power?.aneWatts;
  const cpuWatts = data.power?.cpuWatts;

  console.log(chalk.bold('\n  🔥 pyre gpu — GPU, Unified Memory, ANE & AI Workload Inspector\n'));
  console.log(`  Adapter:           ${chalk.bold.hex('#ff6b35')(gpuModel)}`);
  console.log(`  GPU Utilization:   ${gaugeBar(gpuUtil, 24)} ${chalk.bold(`${gpuUtil}%`)}`);
  if (gpuWatts !== undefined || aneWatts !== undefined || cpuWatts !== undefined) {
    const parts: string[] = [];
    if (gpuWatts !== undefined) parts.push(`GPU: ${chalk.cyan(gpuWatts.toFixed(2) + ' W')}`);
    if (aneWatts !== undefined) parts.push(`ANE (Neural Engine): ${chalk.magenta(aneWatts.toFixed(2) + ' W')}`);
    if (cpuWatts !== undefined) parts.push(`CPU: ${chalk.yellow(cpuWatts.toFixed(2) + ' W')}`);
    console.log(`  Compute Power:     ${parts.join('  ·  ')}`);
  }
  console.log(`  Thermal State:     ${chalk.green(data.thermal.state)}`);
  console.log(chalk.dim('  ─────────────────────────────────────────────────────────────────────────'));

  console.log(chalk.bold.cyan('\n  ◆ Unified Memory / VRAM Allocation Budget'));
  console.log(`    Total System RAM:        ${chalk.bold(formatBytes(budget.totalSystemBytes))}`);
  console.log(`    GPU Wired Ceiling (75%): ${chalk.bold(formatBytes(budget.maxGpuWiredBytes))}`);
  console.log(`    Current Wired Memory:    ${formatBytes(budget.currentWiredBytes)} (${budget.wiredUtilizationPct}% of ceiling)`);
  console.log(`    Available for GPU/LLM:   ${chalk.bold.green(formatBytes(budget.availableForGpuBytes))}`);

  console.log(chalk.bold.magenta('\n  ◆ Local LLM & GenAI Quantization Readiness'));
  for (const fit of llmFits) {
    const badge = fit.status === 'FAST'
      ? chalk.bgHex('#064e3b').hex('#6ee7b7').bold(' FIT: FAST  ')
      : fit.status === 'TIGHT'
        ? chalk.bgHex('#78350f').hex('#fcd34d').bold(' FIT: TIGHT ')
        : chalk.bgHex('#7f1d1d').hex('#fca5a5').bold(' SWAP RISK  ');
    const sign = fit.headroomGb >= 0 ? '+' : '';
    console.log(
      `    ${badge}  ${chalk.bold(fit.modelSize.padEnd(8))} ${chalk.dim(`(${fit.quant})`.padEnd(10))} ` +
      `Req: ${chalk.cyan(`${fit.requiredGb.toFixed(1)} GB`.padStart(7))}   ` +
      `Headroom: ${fit.headroomGb >= 0 ? chalk.green(`${sign}${fit.headroomGb} GB`) : chalk.red(`${fit.headroomGb} GB`)}`
    );
  }

  console.log(chalk.bold.yellow(`\n  ◆ Active GPU, Metal & AI/ML Processes (${gpuProcesses.length})`));
  if (gpuProcesses.length === 0) {
    console.log(chalk.dim('    No dedicated GPU, LLM, or 3D render workloads currently active.'));
  } else {
    console.log(
      chalk.dim('    ') +
      chalk.bold.hex('#cbd5e1').bgHex('#1e293b')(
        ' PID     CATEGORY          CPU%     MEM%     EST. RAM     COMMAND                      '
      )
    );
    for (const p of gpuProcesses.slice(0, 12)) {
      const catColor = p.category === 'LLM / GenAI'
        ? chalk.magenta.bold
        : p.category === 'ML / Compute'
          ? chalk.cyan.bold
          : p.category === '3D / Render'
            ? chalk.yellow
            : chalk.hex('#94a3b8');
      console.log(
        '    ' +
        chalk.hex('#38bdf8')(String(p.pid).padEnd(8)) +
        catColor(p.category.padEnd(18)) +
        chalk.hex('#10b981')(`${p.cpuPct.toFixed(1)}%`.padEnd(9)) +
        chalk.hex('#cbd5e1')(`${p.memPct.toFixed(1)}%`.padEnd(9)) +
        chalk.bold.hex('#f8fafc')(formatBytes(p.estMemoryBytes).padEnd(13)) +
        chalk.hex('#e2e8f0')(truncatePlain(p.command, 32))
      );
    }
  }
  console.log();
}

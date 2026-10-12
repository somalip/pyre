/**
 * pyre flight — In-Memory Forensic Flight Recorder (Black Box).
 *
 * Maintains a circular memory buffer of recent high-resolution telemetry frames.
 * Dumps structured post-mortem forensic reports when freezes, thermal throttles,
 * or runaway process spikes occur.
 */
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { collectAll } from './monitors/collectors.js';
import { getConfigDir } from './state/config.js';

export interface FlightFrame {
  timestamp: string;
  cpu: {
    usage: number;
    temp?: number;
    loadAvg: number[];
  };
  memory: {
    usagePercent: number;
    usedBytes: number;
    totalBytes: number;
  };
  network: {
    rxPackets: number;
    txPackets: number;
  };
  topProcesses: Array<{
    pid: number;
    name: string;
    cpu: number;
    mem: number;
  }>;
}

export interface FlightReport {
  generatedAt: string;
  frameCount: number;
  timeSpanSec: number;
  summary: {
    peakCpuUsage: number;
    peakMemUsage: number;
    peakTempC?: number;
    highestCpuProcess?: { name: string; pid: number; cpu: number };
    highestMemProcess?: { name: string; pid: number; mem: number };
  };
  frames: FlightFrame[];
}

export class FlightRecorder {
  private buffer: FlightFrame[] = [];
  private maxFrames: number;

  constructor(maxFrames = 600) {
    this.maxFrames = maxFrames;
  }

  public push(frame: FlightFrame): void {
    if (this.buffer.length >= this.maxFrames) {
      this.buffer.shift();
    }
    this.buffer.push(frame);
  }

  public size(): number {
    return this.buffer.length;
  }

  public getFrames(): FlightFrame[] {
    return [...this.buffer];
  }

  public clear(): void {
    this.buffer = [];
  }

  public generateReport(): FlightReport {
    const frames = this.getFrames();
    let peakCpu = 0;
    let peakMem = 0;
    let peakTemp: number | undefined = undefined;
    let highestCpuProc: { name: string; pid: number; cpu: number } | undefined = undefined;
    let highestMemProc: { name: string; pid: number; mem: number } | undefined = undefined;

    for (const f of frames) {
      if (f.cpu.usage > peakCpu) peakCpu = f.cpu.usage;
      if (f.memory.usagePercent > peakMem) peakMem = f.memory.usagePercent;
      if (f.cpu.temp !== undefined) {
        if (peakTemp === undefined || f.cpu.temp > peakTemp) peakTemp = f.cpu.temp;
      }
      for (const p of f.topProcesses) {
        if (!highestCpuProc || p.cpu > highestCpuProc.cpu) {
          highestCpuProc = { name: p.name, pid: p.pid, cpu: p.cpu };
        }
        if (!highestMemProc || p.mem > highestMemProc.mem) {
          highestMemProc = { name: p.name, pid: p.pid, mem: p.mem };
        }
      }
    }

    const timeSpanSec = frames.length > 1
      ? Math.round((new Date(frames[frames.length - 1].timestamp).getTime() - new Date(frames[0].timestamp).getTime()) / 1000)
      : 0;

    return {
      generatedAt: new Date().toISOString(),
      frameCount: frames.length,
      timeSpanSec,
      summary: {
        peakCpuUsage: peakCpu,
        peakMemUsage: peakMem,
        peakTempC: peakTemp,
        highestCpuProcess: highestCpuProc,
        highestMemProcess: highestMemProc,
      },
      frames,
    };
  }

  public dump(outDir?: string): string {
    const report = this.generateReport();
    const targetDir = outDir || path.join(process.cwd(), 'pyre-exports');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const filename = `pyre-flight-${Date.now()}.json`;
    const fullPath = path.join(targetDir, filename);
    fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf-8');
    return fullPath;
  }
}

// Global shared recorder instance
export const globalFlightRecorder = new FlightRecorder(600);

export async function captureCurrentFlightFrame(): Promise<FlightFrame> {
  const data = await collectAll();
  const sortedProcs = [...(data.processes || [])].sort((a, b) => b.cpu - a.cpu).slice(0, 5);

  return {
    timestamp: new Date().toISOString(),
    cpu: {
      usage: data.cpu.usage,
      temp: data.cpu.temperature,
      loadAvg: data.cpu.loadAvg || [],
    },
    memory: {
      usagePercent: data.memory.usagePercent,
      usedBytes: data.memory.used,
      totalBytes: data.memory.total,
    },
    network: {
      rxPackets: data.network.rxPackets,
      txPackets: data.network.txPackets,
    },
    topProcesses: sortedProcs.map((p) => ({
      pid: p.pid,
      name: p.command,
      cpu: p.cpu,
      mem: p.mem,
    })),
  };
}

export async function runFlightCommand(subcommand = 'dump', opts?: { out?: string; duration?: number }): Promise<void> {
  if (subcommand === 'status') {
    const size = globalFlightRecorder.size();
    console.log(chalk.bold('\n  🔥 pyre Flight Recorder Status\n'));
    console.log(`  Buffer Frames: ${chalk.green(size)} / 600`);
    console.log(`  RAM Footprint: ~${((size * 1.5) / 1024).toFixed(2)} MB`);
    console.log(chalk.dim('  Run `pyre flight dump` to generate a post-mortem forensic file.\n'));
    return;
  }

  if (subcommand === 'record') {
    const durationSec = opts?.duration || 10;
    console.log(chalk.bold(`\n  🔥 Sampling Flight Recorder for ${durationSec}s...\n`));
    for (let i = 0; i < durationSec; i++) {
      const frame = await captureCurrentFlightFrame();
      globalFlightRecorder.push(frame);
      process.stdout.write(`\r  Sampled frame ${i + 1}/${durationSec}...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('\n');
    const file = globalFlightRecorder.dump(opts?.out);
    console.log(chalk.green(`  ✔ Flight recording saved to: ${file}\n`));
    return;
  }

  // Default: dump
  // Capture at least one fresh frame if buffer empty
  if (globalFlightRecorder.size() === 0) {
    const frame = await captureCurrentFlightFrame();
    globalFlightRecorder.push(frame);
  }

  const file = globalFlightRecorder.dump(opts?.out);
  const report = globalFlightRecorder.generateReport();

  console.log(chalk.bold('\n  🔥 pyre Flight Recorder — Forensic Dump\n'));
  console.log(chalk.dim(`  Output File:  ${file}`));
  console.log(`  Frames:       ${chalk.bold(report.frameCount)}`);
  console.log(`  Peak CPU:     ${chalk.yellow(report.summary.peakCpuUsage.toFixed(1) + '%')}`);
  console.log(`  Peak Memory:  ${chalk.magenta(report.summary.peakMemUsage.toFixed(1) + '%')}`);
  if (report.summary.peakTempC !== undefined) {
    console.log(`  Peak Temp:    ${chalk.red(report.summary.peakTempC.toFixed(1) + '°C')}`);
  }
  if (report.summary.highestCpuProcess) {
    console.log(`  Top CPU Proc: ${chalk.cyan(report.summary.highestCpuProcess.name)} (PID: ${report.summary.highestCpuProcess.pid}, ${report.summary.highestCpuProcess.cpu.toFixed(1)}%)`);
  }
  console.log();
}

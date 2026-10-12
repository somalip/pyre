import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './run.js';
import type { BlenderRenderData } from './types.js';
import { collectWindowsProcesses } from './platform/windows.js';

const RENDER_LOG_DIR = path.join(os.tmpdir(), 'blender_render_logs');

function blendFileFromArgs(args: string[]): string {
  const nonFlag = args.filter(a => !a.startsWith('-'));
  for (const a of nonFlag) {
    if (a.endsWith('.blend') || a.includes('.blend')) {
      return a.split(/[/\\]/).pop() || a;
    }
  }
  return 'unknown.blend';
}

function engineFromArgs(args: string[]): string {
  const idx = args.indexOf('-E');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const flag = args.find(a => a.startsWith('-E='));
  if (flag) return flag.slice(3);
  return 'unknown';
}

function outputPathFromArgs(args: string[]): string {
  const oIdx = args.indexOf('-o');
  if (oIdx !== -1 && args[oIdx + 1]) {
    let p = args[oIdx + 1];
    if (p.endsWith('/') || p.endsWith('\\')) p = p.slice(0, -1);
    const parts = p.split(/[/\\]/);
    return parts.slice(0, -1).join('/') || os.tmpdir();
  }
  const fFlag = args.find(a => a.startsWith('-o='));
  if (fFlag) {
    const p = fFlag.slice(3);
    const parts = p.split(/[/\\]/);
    return parts.slice(0, -1).join('/') || os.tmpdir();
  }
  return os.tmpdir();
}

function frameRangeFromArgs(args: string[]): { start: number; end: number } {
  const fIdx = args.indexOf('-f');
  if (fIdx !== -1 && args[fIdx + 1]) {
    const raw = args[fIdx + 1];
    if (raw.includes('..')) {
      const [s, e] = raw.split('..').map(Number);
      if (!isNaN(s) && !isNaN(e)) return { start: s, end: e };
    }
    const n = parseInt(raw, 10);
    if (!isNaN(n)) return { start: n, end: n };
  }
  const sFlag = args.find(a => a.startsWith('-s='));
  const eFlag = args.find(a => a.startsWith('-e='));
  const start = sFlag ? parseInt(sFlag.slice(3), 10) : 1;
  const end = eFlag ? parseInt(eFlag.slice(3), 10) : 250;
  return { start: isNaN(start) ? 1 : start, end: isNaN(end) ? 250 : end };
}

async function parseRenderLog(blendName: string): Promise<{ framesRendered: number; totalFrames: number; startTime: number; samples?: number } | null> {
  const baseName = blendName.replace(/\.blend$/i, '');
  try {
    if (!fs.existsSync(RENDER_LOG_DIR)) return null;
    const entries = fs.readdirSync(RENDER_LOG_DIR)
      .filter(f => f.startsWith(`${baseName}_`))
      .map(f => ({ name: f, time: fs.statSync(path.join(RENDER_LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5);

    for (const entry of entries) {
      const logPath = path.join(RENDER_LOG_DIR, entry.name);
      try {
        const content = fs.readFileSync(logPath, 'utf-8');
        if (!content) continue;
        const lines = content.split('\n');
        const rendered = lines.filter(l => /Fra:(\d+)/i.test(l)).length;
        const totalMatch = content.match(/Fra:\s*\d+\s*\/\s*(\d+)/);
        const totalFrames = totalMatch ? parseInt(totalMatch[1], 10) : 0;
        const startMatch = content.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/m);
        const startTime = startMatch ? new Date(startMatch[1]).getTime() : Date.now() - 60000;
        const sampleMatch = content.match(/Sample\s*(\d+)/i);
        if (rendered > 0) {
          return { framesRendered: rendered, totalFrames: totalFrames || rendered, startTime, samples: sampleMatch ? parseInt(sampleMatch[1], 10) : undefined };
        }
      } catch {
        // try next log file
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function collectBlenderRenders(): Promise<BlenderRenderData[]> {
  const renders: BlenderRenderData[] = [];
  try {
    interface BlenderProc {
      pid: number;
      cpuPct: number;
      command: string;
    }
    const procList: BlenderProc[] = [];

    if (process.platform === 'win32') {
      const procs = await collectWindowsProcesses();
      for (const p of procs) {
        if (/blender/i.test(p.command)) {
          procList.push({ pid: p.pid, cpuPct: p.cpu, command: p.command });
        }
      }
    } else {
      const psRaw = await run("ps -eo pid,pcpu,pmem,state,command 2>/dev/null | grep -iE '[b]lender'", '', 2000);
      if (psRaw) {
        const lines = psRaw.split('\n');
        for (const line of lines) {
          const parts = line.trim().match(/\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)/);
          if (parts) {
            procList.push({ pid: parseInt(parts[1], 10), cpuPct: parseFloat(parts[2]), command: parts[5] });
          }
        }
      }
    }

    for (const p of procList) {
      const { pid, cpuPct, command } = p;
      const args = command.split(/\s+/);

      const isRender = /-b|--background|-f\s/.test(command) || /render/i.test(command);
      if (!isRender && !command.toLowerCase().includes('blender')) continue;

      const blendFile = blendFileFromArgs(args);
      const engine = engineFromArgs(args);
      const outputPath = outputPathFromArgs(args);
      const { start: frameStart, end: frameEnd } = frameRangeFromArgs(args);
      const totalFrames = Math.max(1, frameEnd - frameStart + 1);

      const logData = await parseRenderLog(blendFile);
      const startTime = logData?.startTime ?? Date.now() - 60000;
      const elapsedSec = Math.max(0, Math.round((Date.now() - startTime) / 1000));
      let currentFrame = logData?.framesRendered ?? 0;
      if (currentFrame === 0 && cpuPct > 0) currentFrame = 1;

      let status: BlenderRenderData['status'] = 'unknown';
      if (cpuPct > 0 && currentFrame > 0 && currentFrame < totalFrames) status = 'rendering';
      else if (cpuPct > 0 && currentFrame >= totalFrames) status = 'finalizing';
      else if (currentFrame === 0 && cpuPct > 0) status = 'loading';
      else if (cpuPct === 0) status = 'idle';

      const completionPercent = totalFrames > 0 ? Math.min(100, Math.round((currentFrame / totalFrames) * 100)) : 0;

      renders.push({
        pid,
        blendFile,
        renderEngine: engine,
        frameStart,
        frameEnd,
        currentFrame,
        totalFrames,
        elapsedSec,
        completionPercent,
        status,
        outputPath,
        sampleCount: logData?.samples,
      });
    }
  } catch {
    // ignore
  }
  return renders;
}

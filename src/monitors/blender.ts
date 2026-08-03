import { run } from './run.js';
import type { BlenderRenderData } from './types.js';

const RENDER_LOG_DIR = '/tmp/blender_render_logs';

function blendFileFromArgs(args: string[]): string {
  const nonFlag = args.filter(a => !a.startsWith('-'));
  for (const a of nonFlag) {
    if (a.endsWith('.blend') || a.includes('.blend')) {
      return a.split('/').pop() || a;
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
    if (p.endsWith('/')) p = p.slice(0, -1);
    return p.split('/').slice(0, -1).join('/') || '/tmp';
  }
  const fFlag = args.find(a => a.startsWith('-o='));
  if (fFlag) {
    const p = fFlag.slice(3);
    return p.endsWith('/') ? p.slice(0, -1).split('/').slice(0, -1).join('/') || '/tmp' : p.split('/').slice(0, -1).join('/') || '/tmp';
  }
  return '/tmp';
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
    const entries = (await run(`ls -t "${RENDER_LOG_DIR}" 2>/dev/null | grep "^${baseName}_" | head -5`, '')).trim().split('\n').filter(Boolean);
    for (const entry of entries) {
      const logPath = `${RENDER_LOG_DIR}/${entry}`;
      try {
        const content = await run(`cat "${logPath}" 2>/dev/null`, '', 500);
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
    const psRaw = await run("ps -eo pid,pcpu,pmem,state,command 2>/dev/null | grep -iE '[b]lender'", '', 2000);
    if (!psRaw) return renders;

    const lines = psRaw.split('\n');
    for (const line of lines) {
      const parts = line.trim().match(/\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.+)/);
      if (!parts) continue;

      const pid = parseInt(parts[1], 10);
      const cpuPct = parseFloat(parts[2]);
      const command = parts[5];
      const args = command.split(/\s+/);

      const isRender = /-b|--background|-f\s/.test(command) || /render/i.test(command);
      if (!isRender && !command.includes('blender')) continue;

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

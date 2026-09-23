/**
 * pyre explain — AI-powered anomaly explanation.
 *
 * Reads anomaly spikes from pyre CSV logs and sends them to a
 * local Ollama instance (default) or an OpenAI-compatible API
 * to generate plain-English diagnosis and actionable advice.
 *
 * Backends:
 *   - ollama (default): POST http://localhost:11434/api/generate
 *   - openai:           POST https://api.openai.com/v1/chat/completions
 *
 * No new dependencies — uses Node.js 18+ built-in fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { explainAnomaliesLocally } from './ai/models.js';

export interface ExplainOptions {
  since?: string;
  backend?: 'builtin' | 'ollama' | 'openai';
  model?: string;
  apiKey?: string;
  dir?: string;
}

interface AnomalyEvent {
  timestamp: string;
  metric: string;
  value: number;
  baseline: number;
  zScore: number;
}

function parseAnomalies(dir: string, sinceStr: string): AnomalyEvent[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.startsWith('pyre-') && f.endsWith('.csv'));
  if (files.length === 0) return [];

  let cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (sinceStr === 'yesterday' || sinceStr === '1d') cutoff = Date.now() - 24 * 60 * 60 * 1000;
  else if (sinceStr.endsWith('d')) {
    const d = parseInt(sinceStr.slice(0, -1), 10);
    if (!isNaN(d)) cutoff = Date.now() - d * 24 * 60 * 60 * 1000;
  } else if (!isNaN(Date.parse(sinceStr))) {
    cutoff = Date.parse(sinceStr);
  }

  interface LogRow { ts: Date; cpu: number; mem: number; temp?: number; }
  const rows: LogRow[] = [];

  for (const file of files.sort()) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const line of content.split('\n').slice(1)) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const ts = new Date(parts[0]);
        if (!isNaN(ts.getTime()) && ts.getTime() >= cutoff) {
          const cpu = parseFloat(parts[1]);
          const mem = parseFloat(parts[2]);
          const temp = parts[3] ? parseFloat(parts[3]) : NaN;
          if (!isNaN(cpu) && !isNaN(mem)) {
            rows.push({ ts, cpu, mem, temp: isNaN(temp) ? undefined : temp });
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (rows.length < 5) return [];

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr: number[], m: number) => Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);

  const cpuVals = rows.map(r => r.cpu);
  const memVals = rows.map(r => r.mem);
  const tempVals = rows.filter(r => r.temp !== undefined).map(r => r.temp!);

  const cpuMean = mean(cpuVals); const cpuStd = std(cpuVals, cpuMean);
  const memMean = mean(memVals); const memStd = std(memVals, memMean);
  const tempMean = tempVals.length ? mean(tempVals) : 0;
  const tempStd = tempVals.length ? std(tempVals, tempMean) : 0;

  const anomalies: AnomalyEvent[] = [];
  for (const r of rows) {
    if (cpuStd > 0) {
      const z = (r.cpu - cpuMean) / cpuStd;
      if (z >= 2.5) anomalies.push({ timestamp: r.ts.toISOString(), metric: 'CPU', value: r.cpu, baseline: cpuMean, zScore: z });
    }
    if (memStd > 0) {
      const z = (r.mem - memMean) / memStd;
      if (z >= 2.5) anomalies.push({ timestamp: r.ts.toISOString(), metric: 'Memory', value: r.mem, baseline: memMean, zScore: z });
    }
    if (r.temp !== undefined && tempStd > 0) {
      const z = (r.temp - tempMean) / tempStd;
      if (z >= 2.5) anomalies.push({ timestamp: r.ts.toISOString(), metric: 'Temperature', value: r.temp, baseline: tempMean, zScore: z });
    }
  }
  return anomalies;
}

function buildPrompt(anomalies: AnomalyEvent[], hostname: string, sinceStr: string): string {
  const osLabel = process.platform === 'darwin' ? 'macOS' : (process.platform === 'win32' ? 'Windows' : 'Linux');
  const lines = anomalies.slice(0, 10).map(a => {
    const unit = a.metric === 'Temperature' ? '°C' : '%';
    return `- ${a.metric} spike at ${a.timestamp}: ${a.value.toFixed(1)}${unit} (baseline ${a.baseline.toFixed(1)}${unit}, +${a.zScore.toFixed(1)}σ)`;
  });
  return [
    `You are a ${osLabel} system performance expert analyzing a monitoring log from "${hostname}".`,
    `The following statistical anomalies (z-score ≥ 2.5σ) were detected in the past ${sinceStr}:`,
    '',
    ...lines,
    '',
    'For each anomaly, provide:',
    `1. A plain-English explanation of what likely caused it (be specific to ${osLabel})`,
    '2. Whether it is likely harmless or worth investigating',
    '3. One actionable recommendation the user can take right now',
    '',
    'Be concise (2-3 sentences per anomaly). Use bullet points. Do not use technical jargon.',
  ].join('\n');
}

async function queryOllama(prompt: string, model: string): Promise<string> {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  const data = await res.json() as { response?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.response ?? '';
}

async function queryOpenAI(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 800 }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function runExplainCommand(opts: ExplainOptions = {}): Promise<void> {
  const {
    since = '7d',
    backend = 'builtin',
    model = backend === 'openai' ? 'gpt-4o-mini' : backend === 'ollama' ? 'llama3.2' : 'expert-rules-v1',
    apiKey = process.env['OPENAI_API_KEY'] ?? '',
    dir = './pyre-exports',
  } = opts;

  console.log(chalk.bold('\n  🔥 pyre explain — AI Anomaly Analysis\n'));

  const anomalies = parseAnomalies(dir, since);

  if (anomalies.length === 0) {
    console.log(chalk.green('  ✔ No anomalies detected in the past ' + since + '.'));
    console.log(chalk.dim('  Run pyre live --log to build a history first.\n'));
    return;
  }

  if (backend === 'builtin') {
    console.log(chalk.dim(`  Analyzing ${anomalies.length} anomaly event(s) using local built-in model (${model})...\n`));
    const alerts = anomalies.map(a => ({
      metric: a.metric,
      value: a.value,
      zScore: a.zScore,
      severity: (a.zScore >= 3.5 ? 'critical' : 'warning') as 'critical' | 'warning',
      timestamp: new Date(a.timestamp),
    }));
    const analysis = explainAnomaliesLocally(alerts, model);
    console.log(chalk.bold('  Analysis:\n'));
    for (const line of analysis.split('\n')) {
      if (line.startsWith('Diagnosis Engine:')) {
        console.log(chalk.bold.magenta('  ' + line));
      } else if (line.startsWith('Tip:')) {
        console.log(chalk.cyan.bold('  ' + line));
      } else if (line.startsWith('  • Recommendation:')) {
        console.log('  ' + chalk.green(line));
      } else if (line.startsWith('  • Cause:')) {
        console.log('  ' + chalk.yellow(line));
      } else if (line.startsWith('  • Verdict:')) {
        console.log('  ' + chalk.dim(line));
      } else {
        console.log('  ' + chalk.dim(line));
      }
    }
    console.log();
    return;
  }

  console.log(chalk.dim(`  Found ${anomalies.length} anomaly event(s). Sending to ${backend} (${model})...\n`));

  const hostname = os.hostname();
  const prompt = buildPrompt(anomalies, hostname, since);
  let explanation = '';

  try {
    if (backend === 'openai') {
      if (!apiKey) {
        console.log(chalk.yellow('  ⚠ No API key found.'));
        console.log(chalk.dim('  Set OPENAI_API_KEY environment variable or use --api-key <key>\n'));
        return;
      }
      explanation = await queryOpenAI(prompt, model, apiKey);
    } else {
      explanation = await queryOllama(prompt, model);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (backend === 'ollama' && (msg.includes('ECONNREFUSED') || msg.includes('fetch failed'))) {
      console.log(chalk.yellow('  ⚠ Ollama server is not running at localhost:11434.\n'));
      console.log(chalk.dim('  Switching to local built-in AI model (offline, zero-setup)...\n'));
      const alerts = anomalies.map(a => ({
        metric: a.metric,
        value: a.value,
        zScore: a.zScore,
        severity: (a.zScore >= 3.5 ? 'critical' : 'warning') as 'critical' | 'warning',
        timestamp: new Date(a.timestamp),
      }));
      const fallbackAnalysis = explainAnomaliesLocally(alerts, 'expert-rules-v1');
      console.log(chalk.bold('  Analysis (Built-in Heuristic Model):\n'));
      for (const line of fallbackAnalysis.split('\n')) {
        console.log('  ' + line);
      }
      console.log();
      return;
    } else {
      console.log(chalk.red(`  ✖ LLM error: ${msg}\n`));
    }
    return;
  }

  if (!explanation.trim()) {
    console.log(chalk.yellow('  ⚠ LLM returned an empty response. Try a different model.\n'));
    return;
  }

  console.log(chalk.bold('  Analysis:\n'));
  for (const line of explanation.split('\n')) {
    const t = line.trim();
    if (t.startsWith('-') || t.startsWith('•')) {
      console.log(chalk.dim('  ') + chalk.white(t));
    } else if (t.match(/^\d+\./)) {
      console.log(chalk.dim('  ') + chalk.cyan(t));
    } else if (t) {
      console.log('  ' + t);
    } else {
      console.log('');
    }
  }
  console.log();
}

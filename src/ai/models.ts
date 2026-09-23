/**
 * Built-in AI Model definitions and diagnostic inference engine.
 *
 * Allows users to choose their AI explanation model directly inside the TUI
 * without depending on an external Ollama server host.
 *
 * Includes fast, private, zero-dependency built-in offline heuristic & rule models,
 * alongside optional local Ollama and remote cloud models if selected.
 */
import type { AnomalyAlert } from '../anomalies.js';

export interface AIModelOption {
  id: string;
  name: string;
  backend: 'builtin' | 'ollama' | 'openai';
  description: string;
  badge: string;
  offline: boolean;
}

export const AVAILABLE_AI_MODELS: AIModelOption[] = [
  {
    id: 'expert-rules-v1',
    name: 'Pyre Expert Heuristics (Local Built-in)',
    backend: 'builtin',
    description: 'Instant zero-latency diagnostic model. No server or setup required.',
    badge: 'Offline · Built-in',
    offline: true,
  },
  {
    id: 'macos-kernel-analyst',
    name: 'macOS Thermal & I/O Engine (Local Built-in)',
    backend: 'builtin',
    description: 'Specialized for Apple Silicon throttling, memory pressure, and swap spikes.',
    badge: 'Offline · Built-in',
    offline: true,
  },
  {
    id: 'llama3.2',
    name: 'Ollama: Llama 3.2 (Local Host)',
    backend: 'ollama',
    description: 'Connects to local Ollama server on port 11434.',
    badge: 'Ollama Server',
    offline: true,
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'Ollama: DeepSeek R1 1.5B (Local Host)',
    backend: 'ollama',
    description: 'Fast local reasoning model via Ollama server.',
    badge: 'Ollama Server',
    offline: true,
  },
  {
    id: 'mistral',
    name: 'Ollama: Mistral (Local Host)',
    backend: 'ollama',
    description: 'General system analysis via Ollama server.',
    badge: 'Ollama Server',
    offline: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'OpenAI: GPT-4o Mini (Cloud API)',
    backend: 'openai',
    description: 'Requires OPENAI_API_KEY environment variable.',
    badge: 'Cloud API',
    offline: false,
  },
];

/**
 * Diagnostic rule engine that provides instantaneous, private,
 * macOS-tailored explanations for anomaly spikes without calling any external host.
 */
export function explainAnomaliesLocally(
  anomalies: AnomalyAlert[],
  modelId: string = 'expert-rules-v1'
): string {
  if (anomalies.length === 0) {
    return '✔ No statistical anomalies detected in this session.';
  }

  const lines: string[] = [];
  lines.push(`Diagnosis Engine: ${modelId} (Self-Contained TUI Analysis)`);
  lines.push('──────────────────────────────────────────────────────────────────────────────');
  lines.push('');

  for (const a of anomalies.slice(0, 8)) {
    const unit = a.metric === 'Temp' || a.metric === 'Temperature' ? '°C' : a.metric.toLowerCase().includes('net') ? 'B/s' : '%';
    const severityTag = a.severity === 'critical' ? '[CRITICAL SPIKE]' : '[MODERATE SPIKE]';
    const zStr = a.zScore > 0 ? `+${a.zScore.toFixed(1)}σ` : `${a.zScore.toFixed(1)}σ`;

    lines.push(`${severityTag} ${a.metric} anomaly at ${a.value.toFixed(1)}${unit} (${zStr} deviation)`);

    // Model reasoning logic
    if (a.metric === 'CPU') {
      if (modelId === 'macos-kernel-analyst') {
        lines.push('  • Cause: High burst of thread execution, possibly kernel_task scheduling or JIT compiler compilation.');
        lines.push('  • Verdict: Harmless if transient (<30s). Check for runaway build tools or browser renderer loops.');
        lines.push('  • Recommendation: Press "P" to open the Process table and inspect the top CPU consumers.');
      } else {
        lines.push('  • Cause: Sudden compute surge exceeding typical baseline workload.');
        lines.push('  • Verdict: Likely a compiler, media encoder, or intensive background sync process.');
        lines.push('  • Recommendation: Press "k" to terminate high-consuming PIDs if unresponsive.');
      }
    } else if (a.metric === 'Memory') {
      lines.push('  • Cause: Rapid memory allocation or buffer spike.');
      lines.push('  • Verdict: Check for memory leaks or large dataset in-memory parsing.');
      lines.push('  • Recommendation: Review swap activity; close unused Electron apps to relieve memory pressure.');
    } else if (a.metric === 'Temp' || a.metric === 'Temperature') {
      lines.push('  • Cause: Die thermal elevation caused by sustained CPU/GPU power draw.');
      lines.push('  • Verdict: Normal under heavy compute; Apple Silicon will throttle if >100°C.');
      lines.push('  • Recommendation: Ensure MacBook airflow vents are clear; watch fan RPM in Thermal panel.');
    } else if (a.metric === 'GPU') {
      lines.push('  • Cause: Metal pipeline or display compositor acceleration spike.');
      lines.push('  • Verdict: Often triggered by 3D rendering, video decoding, or WebGL.');
      lines.push('  • Recommendation: Check window manager or running 3D applications.');
    } else if (a.metric.toLowerCase().includes('net')) {
      lines.push('  • Cause: Outgoing or incoming bandwidth burst.');
      lines.push('  • Verdict: Cloud sync, large file transfer, or package manager download.');
      lines.push('  • Recommendation: Switch to Connections panel (key "8") to check remote hosts.');
    } else if (a.metric === 'Power') {
      lines.push('  • Cause: Combined wattage draw spike above typical power envelope.');
      lines.push('  • Verdict: SoC hitting turbo or sustained multi-core boost.');
      lines.push('  • Recommendation: If on battery power, consider reducing background workloads.');
    } else {
      lines.push(`  • Cause: Statistical variance in metric ${a.metric}.`);
      lines.push('  • Verdict: Deviates significantly from session mean.');
      lines.push('  • Recommendation: Monitor in live graphs to observe whether it returns to baseline.');
    }
    lines.push('');
  }

  lines.push('──────────────────────────────────────────────────────────────────────────────');
  lines.push('Tip: Press "m" anytime in the TUI to change the active AI explanation model.');
  return lines.join('\n');
}

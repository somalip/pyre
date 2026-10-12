/**
 * pyre statusline — Headless Terminal Statusline Emitter.
 *
 * Emits lightweight, high-performance telemetry strings designed for
 * Tmux status-right, Starship prompt, Waybar, Polybar, and Neovim lualine.
 */
import os from 'node:os';
import chalk from 'chalk';
import { collectAll } from './monitors/collectors.js';

export type StatuslineFormat = 'tmux' | 'starship' | 'json' | 'pango' | 'plain';

export interface StatuslineMetrics {
  cpuUsage: number;
  memUsage: number;
  tempC?: number;
  batteryPct?: number;
  batteryCharging?: boolean;
}

export async function collectStatuslineMetrics(): Promise<StatuslineMetrics> {
  const data = await collectAll();
  const cpuUsage = data.cpu.usage;
  const memUsage = data.memory.usagePercent;
  const tempC = data.cpu.temperature;
  const batteryPct = data.battery ? data.battery.percent : undefined;
  const batteryCharging = data.battery ? data.battery.isCharging : undefined;

  return {
    cpuUsage,
    memUsage,
    tempC,
    batteryPct,
    batteryCharging,
  };
}

export function formatStatusline(m: StatuslineMetrics, format: StatuslineFormat): string {
  const cpu = Math.round(m.cpuUsage);
  const mem = Math.round(m.memUsage);
  const temp = m.tempC !== undefined ? `${Math.round(m.tempC)}°C` : '';
  const batt = m.batteryPct !== undefined ? `${m.batteryCharging ? '⚡' : ''}${m.batteryPct}%` : '';

  switch (format) {
    case 'json':
      return JSON.stringify({
        cpu: m.cpuUsage,
        mem: m.memUsage,
        temp: m.tempC,
        battery: m.batteryPct,
        charging: m.batteryCharging,
      });

    case 'tmux': {
      const parts: string[] = [];
      parts.push(`#[fg=cyan]CPU: ${cpu}%`);
      parts.push(`#[fg=magenta]RAM: ${mem}%`);
      if (temp) parts.push(`#[fg=yellow]${temp}`);
      if (batt) parts.push(`#[fg=green]${batt}`);
      return parts.join(' #[fg=dim]| ');
    }

    case 'pango': {
      const parts: string[] = [];
      parts.push(`<span color="#22d3ee">CPU: ${cpu}%</span>`);
      parts.push(`<span color="#a78bfa">RAM: ${mem}%</span>`);
      if (temp) parts.push(`<span color="#fb923c">${temp}</span>`);
      if (batt) parts.push(`<span color="#34d399">${batt}</span>`);
      return parts.join(' | ');
    }

    case 'starship':
    case 'plain':
    default: {
      const parts = [`🔥 ${cpu}%`, `${mem}%`];
      if (temp) parts.push(temp);
      if (batt) parts.push(batt);
      return parts.join(' | ');
    }
  }
}

export async function runStatuslineCommand(format: StatuslineFormat = 'plain'): Promise<void> {
  const metrics = await collectStatuslineMetrics();
  const output = formatStatusline(metrics, format);
  process.stdout.write(output + '\n');
}

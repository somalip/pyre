/**
 * pyre ha — Home Assistant & smart home telemetry bridge.
 *
 * Generates MQTT Discovery topics/payloads and sends webhook updates
 * to Home Assistant for ambient desks, dashboard cards, and automation triggers.
 */
import os from 'node:os';
import chalk from 'chalk';
import { collectAll } from './monitors/index.js';

export interface HaSensorConfig {
  topic: string;
  payload: Record<string, any>;
}

export function generateHaDiscoveryConfigs(nodeId?: string): HaSensorConfig[] {
  const hostname = nodeId || os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const device = {
    identifiers: [`pyre_${hostname}`],
    name: `Pyre Monitor (${os.hostname()})`,
    model: `${os.type()} ${os.arch()}`,
    manufacturer: 'Pyre Telemetry',
  };

  const stateTopic = `pyre/${hostname}/state`;

  return [
    {
      topic: `homeassistant/sensor/pyre_${hostname}/cpu_usage/config`,
      payload: {
        name: 'CPU Usage',
        unique_id: `pyre_${hostname}_cpu_usage`,
        state_topic: stateTopic,
        unit_of_measurement: '%',
        value_template: '{{ value_json.cpu_pct }}',
        device_class: 'power_factor',
        device,
      },
    },
    {
      topic: `homeassistant/sensor/pyre_${hostname}/cpu_temp/config`,
      payload: {
        name: 'CPU Temperature',
        unique_id: `pyre_${hostname}_cpu_temp`,
        state_topic: stateTopic,
        unit_of_measurement: '°C',
        value_template: '{{ value_json.cpu_temp_c }}',
        device_class: 'temperature',
        device,
      },
    },
    {
      topic: `homeassistant/sensor/pyre_${hostname}/memory_usage/config`,
      payload: {
        name: 'Memory Usage',
        unique_id: `pyre_${hostname}_memory_usage`,
        state_topic: stateTopic,
        unit_of_measurement: '%',
        value_template: '{{ value_json.memory_pct }}',
        device_class: 'power_factor',
        device,
      },
    },
    {
      topic: `homeassistant/sensor/pyre_${hostname}/battery_level/config`,
      payload: {
        name: 'Battery Level',
        unique_id: `pyre_${hostname}_battery_level`,
        state_topic: stateTopic,
        unit_of_measurement: '%',
        value_template: '{{ value_json.battery_pct }}',
        device_class: 'battery',
        device,
      },
    },
  ];
}

export async function getHaTelemetryPayload(): Promise<Record<string, any>> {
  const stats = await collectAll();
  const battLevel = stats.battery && typeof stats.battery.level === 'number' ? stats.battery.level : null;
  const isCharging = stats.battery && stats.battery.state ? stats.battery.state.toLowerCase().includes('charg') : null;

  return {
    hostname: os.hostname(),
    cpu_pct: +(stats.cpu.usage || 0).toFixed(1),
    cpu_temp_c: stats.thermal && stats.thermal.cpuTempC ? +stats.thermal.cpuTempC.toFixed(1) : null,
    memory_pct: +(stats.memory.usedPercent || 0).toFixed(1),
    battery_pct: battLevel !== null ? +battLevel.toFixed(0) : null,
    battery_is_charging: isCharging,
    uptime_sec: os.uptime(),
    timestamp: new Date().toISOString(),
  };
}

export async function runHaCommand(action: string = 'config', opts: { webhook?: string; json?: boolean } = {}): Promise<void> {
  const act = action.toLowerCase();

  if (act === 'config' || act === 'discovery') {
    const configs = generateHaDiscoveryConfigs();
    if (opts.json) {
      console.log(JSON.stringify(configs, null, 2));
      return;
    }

    const border = chalk.hex('#ff5f2e');
    const dim = chalk.dim;
    const W = 78;

    console.log();
    console.log(border('┌' + '─'.repeat(W) + '┐'));
    console.log(border('│') + chalk.bold('  PYRE // HOME ASSISTANT MQTT DISCOVERY MATRIX') + ' '.repeat(W - 57) + chalk.cyan('[SMART HOME]') + '  ' + border('│'));
    console.log(border('├' + '─'.repeat(W) + '┤'));
    console.log(border('│') + dim('  Zero-config MQTT discovery sensors for Home Assistant dashboards.           ') + border('│'));
    console.log(border('├──────────────────────────────────────────────────────────────────────────────┤'));

    for (const c of configs) {
      const topicStr = c.topic.length > 74 ? c.topic.slice(0, 73) + '…' : c.topic;
      console.log(border('│') + `  TOPIC: ${chalk.cyan(topicStr)}`.padEnd(W + 10) + border('│'));
      const samplePayload = JSON.stringify(c.payload);
      const payloadStr = samplePayload.length > 72 ? samplePayload.slice(0, 71) + '…' : samplePayload;
      console.log(border('│') + `  DATA:  ${dim(payloadStr)}`.padEnd(W + 10) + border('│'));
      console.log(border('├──────────────────────────────────────────────────────────────────────────────┤'));
    }

    const stateTopic = `pyre/${os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}/state`;
    console.log(border('│') + `  STATE TELEMETRY TOPIC: ${chalk.green(stateTopic)}`.padEnd(W + 10) + border('│'));
    console.log(border('└──────────────────────────────────────────────────────────────────────────────┘\n'));
    return;
  }

  if (act === 'publish' || act === 'state') {
    const payload = await getHaTelemetryPayload();

    if (opts.webhook) {
      console.log(chalk.dim(`  Sending state to webhook: ${opts.webhook}...`));
      try {
        const res = await fetch(opts.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          console.log(chalk.green(`  ✔ Successfully delivered telemetry update to Home Assistant webhook!`));
        } else {
          console.log(chalk.red(`  ✖ Webhook responded with status: ${res.status} ${res.statusText}`));
        }
      } catch (err: any) {
        console.error(chalk.red(`  ✖ Failed to post to webhook: ${err.message}`));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const border = chalk.hex('#ff5f2e');
    const W = 78;
    console.log();
    console.log(border('┌' + '─'.repeat(W) + '┐'));
    console.log(border('│') + chalk.bold('  PYRE // HOME ASSISTANT LIVE TELEMETRY SNAPSHOT') + ' '.repeat(W - 60) + chalk.cyan('[STATE PAYLOAD]') + '  ' + border('│'));
    console.log(border('├' + '─'.repeat(W) + '┤'));
    console.log(border('│') + `  HOST: ${payload.hostname.padEnd(20)}  UPTIME: ${String(payload.uptime_sec + 's').padEnd(16)}  TIME: ${payload.timestamp}`.padEnd(W + 1) + border('│'));
    console.log(border('├─────────────────┬──────────────────┬─────────────────┬───────────────────────┤'));
    console.log(border('│') + ' CPU LOAD        ' + border('│') + ' CPU TEMPERATURE  ' + border('│') + ' MEMORY USAGE    ' + border('│') + ' BATTERY LEVEL          ' + border('│'));
    console.log(border('├─────────────────┼──────────────────┼─────────────────┼───────────────────────┤'));

    const cpuCol = (payload.cpu_pct + '%').padEnd(15);
    const tempCol = (payload.cpu_temp_c !== null ? payload.cpu_temp_c + '°C' : 'N/A').padEnd(16);
    const memCol = (payload.memory_pct + '%').padEnd(15);
    const battCol = (payload.battery_pct !== null ? `${payload.battery_pct}% (${payload.battery_is_charging ? 'Charging' : 'Discharging'})` : 'N/A').padEnd(21);

    console.log(border('│') + ` ${chalk.bold(cpuCol)} ` + border('│') + ` ${chalk.bold(tempCol)} ` + border('│') + ` ${chalk.bold(memCol)} ` + border('│') + ` ${chalk.bold(battCol)} ` + border('│'));
    console.log(border('└─────────────────┴──────────────────┴─────────────────┴───────────────────────┘\n'));
  }
}

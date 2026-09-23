/**
 * pyre multi-channel alert sender.
 *
 * Sends alert notifications to one or more configured channels:
 *   - Slack  (incoming webhook URL)
 *   - Discord (webhook URL)
 *   - Pushover (API token + user key)
 *   - ntfy.sh (topic URL)
 *
 * All channels use Node.js 18+ built-in fetch.
 * Failures are always silent.
 */

export interface AlertPayload {
  metric: string;
  value: number;
  threshold: number;
  unit: string;
  host: string;
  timestamp: string;
  severity?: 'warning' | 'critical';
}

export interface AlertChannelConfig {
  slackUrl?: string;
  discordUrl?: string;
  pushoverToken?: string;
  pushoverUser?: string;
  ntfyUrl?: string;
}

function buildMessage(payload: AlertPayload): string {
  const icon = payload.severity === 'critical' ? '🔴' : '⚠️';
  return `${icon} pyre alert on ${payload.host}: ${payload.metric} reached ${payload.value.toFixed(1)}${payload.unit} (threshold: ${payload.threshold}${payload.unit}) at ${payload.timestamp}`;
}

async function postJson(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function sendSlack(url: string, payload: AlertPayload): Promise<void> {
  const color = payload.severity === 'critical' ? '#ff0000' : '#ffa500';
  await postJson(url, {
    attachments: [{
      color,
      text: buildMessage(payload),
      footer: 'pyre system monitor',
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}

async function sendDiscord(url: string, payload: AlertPayload): Promise<void> {
  const color = payload.severity === 'critical' ? 0xff0000 : 0xffa500;
  await postJson(url, {
    embeds: [{
      title: `pyre — ${payload.metric} Alert`,
      description: buildMessage(payload),
      color,
      footer: { text: 'pyre system monitor' },
      timestamp: payload.timestamp,
    }],
  });
}

async function sendPushover(token: string, user: string, payload: AlertPayload): Promise<void> {
  await postJson('https://api.pushover.net/1/messages.json', {
    token,
    user,
    title: `pyre — ${payload.metric} Alert`,
    message: buildMessage(payload),
    priority: payload.severity === 'critical' ? 1 : 0,
  });
}

async function sendNtfy(url: string, payload: AlertPayload): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Title': `pyre — ${payload.metric} Alert`,
      'Priority': payload.severity === 'critical' ? 'high' : 'default',
      'Tags': payload.severity === 'critical' ? 'rotating_light' : 'warning',
    },
    body: buildMessage(payload),
  });
}

/** Send an alert to all configured channels. All failures are silently ignored. */
export async function sendAlert(payload: AlertPayload, config: AlertChannelConfig): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (config.slackUrl) tasks.push(sendSlack(config.slackUrl, payload).catch(() => {}));
  if (config.discordUrl) tasks.push(sendDiscord(config.discordUrl, payload).catch(() => {}));
  if (config.pushoverToken && config.pushoverUser) {
    tasks.push(sendPushover(config.pushoverToken, config.pushoverUser, payload).catch(() => {}));
  }
  if (config.ntfyUrl) tasks.push(sendNtfy(config.ntfyUrl, payload).catch(() => {}));

  if (tasks.length > 0) await Promise.allSettled(tasks);
}

/** Fire a test alert to all configured channels (used by pyre alert test). */
export async function sendTestAlert(config: AlertChannelConfig): Promise<void> {
  const hostname = (await import('node:os')).hostname();
  await sendAlert({
    metric: 'CPU',
    value: 95.0,
    threshold: 90,
    unit: '%',
    host: hostname,
    timestamp: new Date().toISOString(),
    severity: 'warning',
  }, config);
}

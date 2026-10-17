/**
 * pyre net-audit — Outbound network and privacy flow inspector.
 *
 * Inspects active outbound connections per application, identifies remote endpoints,
 * flags unencrypted cleartext HTTP traffic, and exports firewall blocking rules.
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';
import { collectPackets } from './monitors/collectors.js';

export interface SocketConnection {
  pid: number;
  processName: string;
  protocol: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  isCleartextHttp: boolean;
  isLocalLan: boolean;
  category: string;
}

export interface AppNetworkAudit {
  processName: string;
  pid: number;
  totalConnections: number;
  remoteEndpoints: string[];
  cleartextHttpCount: number;
  hasExternalTraffic: boolean;
  categories: string[];
}

export interface NetAuditReport {
  timestamp: string;
  totalSockets: number;
  cleartextHttpWarnings: number;
  externalConnectionsCount: number;
  apps: AppNetworkAudit[];
  connections: SocketConnection[];
}

export interface NetAuditOptions {
  top?: number;
  json?: boolean;
  exportPf?: boolean;
  exportHosts?: boolean;
}

export function isLanAddress(ip: string): boolean {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('fe80:') || ip.startsWith('fc00:')) return true;
  return false;
}

export function categorizePort(port: number): string {
  switch (port) {
    case 80: return 'HTTP (Cleartext)';
    case 443: return 'HTTPS (Encrypted)';
    case 53:
    case 853: return 'DNS';
    case 22: return 'SSH';
    case 123: return 'NTP (Time Sync)';
    case 8080:
    case 8443:
    case 3000:
    case 5000: return 'Web Dev / Alt Web';
    case 5228:
    case 5229:
    case 5230: return 'Apple Push Notification';
    default: return 'Custom / Cloud';
  }
}

export function parseLsofOutput(output: string): SocketConnection[] {
  const connections: SocketConnection[] = [];
  const lines = output.split('\n');

  // Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  // e.g.: Google\x20 1234 user 45u IPv4 0x1234 0t0 TCP 192.168.1.5:54321->142.250.190.46:443 (ESTABLISHED)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const command = parts[0].replace(/\\x20/g, ' ');
    const pid = parseInt(parts[1], 10);
    const protocol = parts[7] || parts[4] || 'TCP';
    const namePart = parts[8] || '';

    // Look for connection string like 192.168.1.5:54321->142.250.190.46:443
    const arrowIdx = namePart.indexOf('->');
    if (arrowIdx === -1) continue;

    const localPart = namePart.substring(0, arrowIdx);
    const remotePart = namePart.substring(arrowIdx + 2);

    const remoteLastColon = remotePart.lastIndexOf(':');
    if (remoteLastColon === -1) continue;

    const remoteIp = remotePart.substring(0, remoteLastColon).replace(/^\[|\]$/g, '');
    const remotePort = parseInt(remotePart.substring(remoteLastColon + 1), 10);

    const localLastColon = localPart.lastIndexOf(':');
    const localIp = localLastColon !== -1 ? localPart.substring(0, localLastColon).replace(/^\[|\]$/g, '') : localPart;
    const localPort = localLastColon !== -1 ? parseInt(localPart.substring(localLastColon + 1), 10) : 0;

    const isCleartext = remotePort === 80;
    const isLocal = isLanAddress(remoteIp);
    const category = categorizePort(remotePort);
    const state = parts[9] ? parts[9].replace(/^\(|\)$/g, '') : 'ESTABLISHED';

    connections.push({
      pid,
      processName: command,
      protocol,
      localAddress: localIp,
      localPort,
      remoteAddress: remoteIp,
      remotePort,
      state,
      isCleartextHttp: isCleartext,
      isLocalLan: isLocal,
      category,
    });
  }

  return connections;
}

export async function collectNetAuditReport(): Promise<NetAuditReport> {
  let connections: SocketConnection[] = [];

  try {
    const output = execSync('lsof -i -n -P', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    });
    connections = parseLsofOutput(output);
  } catch {
    // Fallback using packet monitor
    try {
      const packets = await collectPackets();
      if (packets && packets.allProcesses) {
        for (const p of packets.allProcesses) {
          if (p.connections) {
            for (const c of p.connections) {
              const remoteParts = c.split(':');
              const rIp = remoteParts[0] || 'unknown';
              const rPort = parseInt(remoteParts[1], 10) || 0;
              connections.push({
                pid: p.pid,
                processName: p.command,
                protocol: 'TCP',
                localAddress: '0.0.0.0',
                localPort: 0,
                remoteAddress: rIp,
                remotePort: rPort,
                state: 'ESTABLISHED',
                isCleartextHttp: rPort === 80,
                isLocalLan: isLanAddress(rIp),
                category: categorizePort(rPort),
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const appMap = new Map<string, AppNetworkAudit>();
  let cleartextHttpWarnings = 0;
  let externalConnectionsCount = 0;

  for (const c of connections) {
    if (c.isCleartextHttp) cleartextHttpWarnings++;
    if (!c.isLocalLan) externalConnectionsCount++;

    const key = `${c.processName}:${c.pid}`;
    let audit = appMap.get(key);
    if (!audit) {
      audit = {
        processName: c.processName,
        pid: c.pid,
        totalConnections: 0,
        remoteEndpoints: [],
        cleartextHttpCount: 0,
        hasExternalTraffic: false,
        categories: [],
      };
      appMap.set(key, audit);
    }

    audit.totalConnections++;
    if (c.isCleartextHttp) audit.cleartextHttpCount++;
    if (!c.isLocalLan) audit.hasExternalTraffic = true;

    const endpointStr = `${c.remoteAddress}:${c.remotePort}`;
    if (!audit.remoteEndpoints.includes(endpointStr)) {
      audit.remoteEndpoints.push(endpointStr);
    }
    if (!audit.categories.includes(c.category)) {
      audit.categories.push(c.category);
    }
  }

  const apps = Array.from(appMap.values()).sort((a, b) => b.totalConnections - a.totalConnections);

  return {
    timestamp: new Date().toISOString(),
    totalSockets: connections.length,
    cleartextHttpWarnings,
    externalConnectionsCount,
    apps,
    connections,
  };
}

export function generatePfRules(report: NetAuditReport): string {
  const lines: string[] = [
    '# Pyre Packet Filter (PF) Ruleset Export',
    `# Generated: ${new Date().toLocaleString()}`,
    '# Add to /etc/pf.conf and run: sudo pfctl -f /etc/pf.conf -e',
    '',
    '# Block unencrypted cleartext HTTP outbound traffic',
    'block out proto tcp to any port 80',
    '',
    '# Blocked External Endpoints from Privacy Audit',
  ];

  const uniqueIps = new Set<string>();
  for (const c of report.connections) {
    if (!c.isLocalLan && c.isCleartextHttp) {
      uniqueIps.add(c.remoteAddress);
    }
  }

  for (const ip of uniqueIps) {
    lines.push(`block out quick to ${ip}`);
  }

  return lines.join('\n');
}

export async function runNetAuditCommand(opts: NetAuditOptions = {}): Promise<void> {
  const report = await collectNetAuditReport();

  if (opts.exportPf) {
    console.log(generatePfRules(report));
    return;
  }

  if (opts.exportHosts) {
    console.log('# Pyre Privacy Blocklist Export (hosts format)');
    console.log('# Generated: ' + new Date().toLocaleString());
    const uniqueIps = new Set<string>();
    for (const c of report.connections) {
      if (!c.isLocalLan && c.isCleartextHttp) uniqueIps.add(c.remoteAddress);
    }
    for (const ip of uniqueIps) {
      console.log(`0.0.0.0 ${ip}`);
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const border = chalk.hex('#ff5f2e');
  const dim = chalk.dim;
  const W = 82;

  console.log();
  console.log(border('┌' + '─'.repeat(W) + '┐'));
  console.log(border('│') + chalk.bold('  PYRE // NETWORK PRIVACY & OUTBOUND FLOW INSPECTOR') + ' '.repeat(W - 59) + chalk.cyan('[AUDIT MATRIX]') + '  ' + border('│'));
  console.log(border('├' + '─'.repeat(W) + '┤'));
  console.log(border('│') + `  SOCKETS: ${chalk.bold(String(report.totalSockets).padEnd(6))}  EXTERNAL: ${chalk.bold(String(report.externalConnectionsCount).padEnd(6))}  CLEARTEXT HTTP: ${report.cleartextHttpWarnings > 0 ? chalk.bgRed.white.bold(` ${report.cleartextHttpWarnings} WARNING `) : chalk.green.bold('0 (Clean)')}`.padEnd(W + 20) + border('│'));

  if (report.cleartextHttpWarnings > 0) {
    console.log(border('├' + '─'.repeat(W) + '┤'));
    console.log(border('│') + chalk.red.bold('  ⚠ PRIVACY ALERT: Detected unencrypted HTTP (port 80) connections!').padEnd(W + 9) + border('│'));
    console.log(border('│') + dim('  Payloads, URLs, and authentication cookies may be exposed to eavesdropping. ').padEnd(W + 9) + border('│'));
  }

  console.log(border('├─────┬──────────────────────┬─────────┬──────────┬───────────┬────────────────────┤'));
  console.log(border('│') + ' PID ' + border('│') + ' PROCESS              ' + border('│') + ' SOCKETS ' + border('│') + ' REACH    ' + border('│') + ' HTTP WARN  ' + border('│') + ' DESTINATIONS / CAT  ' + border('│'));
  console.log(border('├─────┼──────────────────────┼─────────┼──────────┼───────────┼────────────────────┤'));

  const topLimit = opts.top || 15;
  const displayedApps = report.apps.slice(0, topLimit);

  if (displayedApps.length === 0) {
    console.log(border('│') + dim(' (none) No active outbound socket connections detected.                         ') + border('│'));
  } else {
    for (const app of displayedApps) {
      const pidCol = String(app.pid).padEnd(4);
      const nameCol = (app.processName.length > 20 ? app.processName.slice(0, 19) + '…' : app.processName).padEnd(20);
      const sockCol = String(app.totalConnections).padEnd(7);
      const reachCol = app.hasExternalTraffic ? chalk.cyan('INTERNET  ') : dim('LAN ONLY  ');
      const warnCol = app.cleartextHttpCount > 0 ? chalk.red.bold(`${app.cleartextHttpCount} WARN   `) : dim('0 (TLS)   ');
      const sampleDest = app.remoteEndpoints[0] || app.categories[0] || 'Local';
      const destCol = (sampleDest.length > 18 ? sampleDest.slice(0, 17) + '…' : sampleDest).padEnd(18);

      console.log(border('│') + ` ${pidCol}` + border('│') + ` ${chalk.bold(nameCol)} ` + border('│') + ` ${sockCol} ` + border('│') + ` ${reachCol} ` + border('│') + ` ${warnCol} ` + border('│') + ` ${dim(destCol)} ` + border('│'));
    }
  }

  console.log(border('└─────┴──────────────────────┴─────────┴──────────┴───────────┴────────────────────┘'));
  console.log(dim(`  Tip: Run 'pyre net-audit --export-pf' for firewall rules or '--json' for raw telemetry.\n`));

  console.log(chalk.dim(`  Tips:`));
  console.log(chalk.dim(`  - Run 'pyre net-audit --export-pf' to generate macOS firewall rules for insecure sockets.`));
  console.log(chalk.dim(`  - Run 'pyre net-audit --json' for complete raw connection data.\n`));
}

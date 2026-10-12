/**
 * pyre topo — Network Topology Mapper.
 *
 * Visualizes the local network topology, including default gateways,
 * active routing paths, LAN neighbors (via ARP cache), and active remote sockets.
 * Also scans LAN neighbors for running pyre instances (P2P port 9876, REST port 8080/3000).
 */
import net from 'node:net';
import os from 'node:os';
import chalk from 'chalk';
import { run, runPowerShell } from './monitors/run.js';
import { collectNetwork } from './monitors/collectors.js';

export interface TopoOptions {
  scan?: boolean;
  json?: boolean;
}

export interface LanPeer {
  ip: string;
  mac: string;
  interface: string;
  isGateway: boolean;
  pyreP2P?: boolean;
  pyreRest?: boolean;
  hostname?: string;
}

async function probePort(ip: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

export async function getDefaultGateway(): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const raw = await runPowerShell(
        `(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty NextHop)`,
        ''
      );
      if (raw.trim() && raw.trim() !== '0.0.0.0') return raw.trim();
    } catch {}

    try {
      const rawCim = await runPowerShell(
        `(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled = TRUE" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty DefaultIPGateway) -join ''`,
        ''
      );
      if (rawCim.trim()) return rawCim.trim();
    } catch {}
  }

  try {
    const raw = await run("route -n get default 2>/dev/null | grep gateway | awk '{print $2}'", '');
    if (raw.trim()) return raw.trim();
  } catch {}
  try {
    const raw = await run("netstat -nr 2>/dev/null | grep default | awk '{print $2}' | head -n1", '');
    if (raw.trim()) return raw.trim();
  } catch {}
  return '192.168.1.1';
}

export function parseWindowsArpOutput(raw: string, gatewayIp: string): LanPeer[] {
  const peers: LanPeer[] = [];
  let currentIface = 'Ethernet';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    const ifaceMatch = trimmed.match(/Interface:\s*([\d.]+)/i);
    if (ifaceMatch) {
      currentIface = ifaceMatch[1];
      continue;
    }

    const match = trimmed.match(/^([\d.]+)\s+([0-9a-fA-F-]+)\s+(\w+)/);
    if (match) {
      const ip = match[1];
      const mac = match[2].replace(/-/g, ':');
      if (ip === '255.255.255.255' || ip.startsWith('224.') || mac.includes('ff:ff:ff')) continue;
      peers.push({
        ip,
        mac,
        interface: currentIface,
        isGateway: ip === gatewayIp,
      });
    }
  }

  return peers;
}

export async function getArpNeighbors(gatewayIp: string): Promise<LanPeer[]> {
  const peers: LanPeer[] = [];
  try {
    if (process.platform === 'win32') {
      const raw = await run('arp -a 2>nul', '');
      return parseWindowsArpOutput(raw, gatewayIp);
    }

    const raw = await run('arp -a -n 2>/dev/null', '');
    const lines = raw.split('\n');
    for (const line of lines) {
      // macOS format: "? (192.168.1.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]"
      const match = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+)\s+on\s+(\S+)/);
      if (match) {
        const ip = match[1];
        const mac = match[2];
        const iface = match[3];
        if (ip === '255.255.255.255' || ip.startsWith('224.') || mac.includes('incomplete')) continue;
        peers.push({
          ip,
          mac,
          interface: iface,
          isGateway: ip === gatewayIp,
        });
      }
    }
  } catch {}
  return peers;
}

export async function runTopoCommand(opts: TopoOptions = {}): Promise<void> {
  const localNet = await collectNetwork();
  const gatewayIp = await getDefaultGateway();
  const lanPeers = await getArpNeighbors(gatewayIp);
  const hostname = os.hostname();

  // If scan is requested or small peer count, probe common pyre ports
  if (opts.scan || lanPeers.length <= 15) {
    await Promise.all(
      lanPeers.map(async (peer) => {
        const [hasP2P, hasRest] = await Promise.all([
          probePort(peer.ip, 9876, 250),
          probePort(peer.ip, 8080, 250),
        ]);
        peer.pyreP2P = hasP2P;
        peer.pyreRest = hasRest;
      })
    );
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          local: {
            hostname,
            ip: localNet.ip,
            interface: localNet.interface,
            gateway: gatewayIp,
          },
          lanPeers,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(chalk.bold('\n  🗺  pyre topo — Network Topology Map\n'));
  console.log(chalk.bold('  Local Node:'));
  console.log(`    Hostname:  ${chalk.cyan(hostname)}`);
  console.log(`    IP:        ${chalk.green(localNet.ip)}`);
  console.log(`    Interface: ${localNet.interface}`);
  console.log(`    Gateway:   ${chalk.yellow(gatewayIp)}`);
  console.log();

  console.log(chalk.bold(`  LAN Neighbors & Nodes (${lanPeers.length} discovered via ARP):`));
  console.log(chalk.dim('  ' + '─'.repeat(74)));

  if (lanPeers.length === 0) {
    console.log(chalk.dim('    No active ARP neighbors found in cache.\n'));
    return;
  }

  for (const peer of lanPeers) {
    const isGw = peer.isGateway ? chalk.yellow(' [Default Gateway]') : '';
    const pyreBadge = peer.pyreP2P ? chalk.green.bold(' 🔥 PYRE PEER') : '';
    const restBadge = peer.pyreRest ? chalk.blue(' (REST API)') : '';

    console.log(`    • ${chalk.bold(peer.ip.padEnd(16))} ${chalk.dim(peer.mac.padEnd(20))} [${peer.interface}]${isGw}${pyreBadge}${restBadge}`);
  }

  console.log();
  const pyrePeers = lanPeers.filter(p => p.pyreP2P);
  if (pyrePeers.length > 0) {
    console.log(chalk.green(`  ✔ Found ${pyrePeers.length} active Pyre node(s) on your LAN!`));
    console.log(chalk.dim(`  Connect using: pyre p2p connect --p2p-host ${pyrePeers[0].ip}\n`));
  } else {
    console.log(chalk.dim('  Tip: Pass --scan to sweep and test pyre ports on discovered LAN neighbors.\n'));
  }
}

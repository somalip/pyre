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
import { run } from './monitors/run.js';
import { collectNetwork } from './monitors/collectors.js';

export interface TopoOptions {
  scan?: boolean;
  json?: boolean;
}

interface LanPeer {
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

async function getDefaultGateway(): Promise<string> {
  try {
    const raw = await run("route -n get default 2>/dev/null | grep gateway | awk '{print $2}'", '');
    if (raw.trim()) return raw.trim();
  } catch {}
  try {
    const raw = await run("netstat -nr | grep default | awk '{print $2}' | head -n1", '');
    if (raw.trim()) return raw.trim();
  } catch {}
  return '192.168.1.1';
}

async function getArpNeighbors(gatewayIp: string): Promise<LanPeer[]> {
  const peers: LanPeer[] = [];
  try {
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

  const establishedConns = (localNet.topRemoteHosts || []).slice(0, 6);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          localNode: {
            hostname,
            ip: localNet.ip,
            interface: localNet.interface,
          },
          gateway: gatewayIp,
          lanPeers,
          activeRemoteConnections: establishedConns,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(chalk.bold('\n  🔥 pyre topo — Network Topology Map\n'));

  // Local Host Header Box
  console.log(`  ${chalk.bgCyan.black.bold(' LOCAL HOST ')} ${chalk.bold(hostname)}`);
  console.log(`    ├── IP Address:       ${chalk.green.bold(localNet.ip || '127.0.0.1')} (${localNet.interface})`);
  console.log(`    ├── Active RX / TX:   ↓ ${chalk.cyan(localNet.rxBytes ? `${(localNet.rxBytes / 1e6).toFixed(1)} MB` : '0 MB')}  ↑ ${chalk.blue(localNet.txBytes ? `${(localNet.txBytes / 1e6).toFixed(1)} MB` : '0 MB')}`);
  console.log('    │');

  // Gateway Node
  console.log(`    ├── ${chalk.yellow.bold('DEFAULT GATEWAY / ROUTER')}`);
  console.log(`    │    └── IP: ${chalk.yellow(gatewayIp)}  [Route → WAN / Internet]`);
  console.log('    │');

  // LAN Neighborhood
  console.log(`    ├── ${chalk.magenta.bold('LAN NEIGHBORS & PEERS')} (${lanPeers.length} discovered via ARP)`);
  if (lanPeers.length === 0) {
    console.log(`    │    └── ${chalk.dim('No neighboring ARP entries currently cached.')}`);
  } else {
    for (let i = 0; i < lanPeers.length; i++) {
      const peer = lanPeers[i];
      const isLast = i === lanPeers.length - 1;
      const prefix = isLast ? '    │    └──' : '    │    ├──';
      const gwBadge = peer.isGateway ? chalk.yellow(' [Gateway]') : '';
      let pyreBadge = '';
      if (peer.pyreP2P) pyreBadge += chalk.hex('#ff5500').bold(' [🔥 pyre P2P :9876]');
      if (peer.pyreRest) pyreBadge += chalk.hex('#00ffcc').bold(' [🔥 pyre REST :8080]');

      console.log(`${prefix} ${peer.ip.padEnd(16)} ${chalk.dim(peer.mac)}${gwBadge}${pyreBadge}`);
    }
  }
  console.log('    │');

  // Active External Remote Sockets
  console.log(`    └── ${chalk.cyan.bold('TOP ACTIVE REMOTE CONNECTIONS')}`);
  if (establishedConns.length === 0) {
    console.log(`         └── ${chalk.dim('No active established sockets detected.')}`);
  } else {
    for (let i = 0; i < establishedConns.length; i++) {
      const conn = establishedConns[i];
      const isLast = i === establishedConns.length - 1;
      const prefix = isLast ? '         └──' : '         ├──';
      const connsBadge = chalk.dim(`(${conn.connectionCount} socket${conn.connectionCount > 1 ? 's' : ''})`);
      console.log(`${prefix} ${chalk.white(conn.host.padEnd(24))} ${chalk.green('ESTABLISHED')} ${connsBadge}`);
    }
  }

  console.log();
  console.log(chalk.dim('  Tip: Run "pyre p2p server" on any node to allow automatic live cluster streaming.\n'));
}

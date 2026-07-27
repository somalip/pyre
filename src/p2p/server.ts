import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { collectAll } from '../monitors/index.js';
import { encodeAuthOk, encodeAuthFail, encodeData, encodePing, encodePong, encodeDisconnect, hashPassword, computeHMAC, verifyHMAC, signMessage, decodeMessage, generateNonce } from './protocol.js';
import type { P2PServerOptions, P2PConnectionInfo } from './types.js';

interface Peer {
  socket: net.Socket;
  authenticated: boolean;
  intervalHandle: NodeJS.Timeout | null;
  pingHandle: NodeJS.Timeout | null;
  readBuffer: Buffer;
  readExpectingHeader: boolean;
  readMessageLength: number;
  ip: string;
  pendingNonce: string | null;
}

const HEADER_SIZE = 4;
const DEFAULT_RATE_LIMIT_MAX = 5;
const DEFAULT_RATE_LIMIT_WINDOW = 60000;
const HMAC_KEY_LENGTH = 32;

function readMessageFromPeer(peer: Peer): Buffer | null {
  while (peer.readBuffer.length > 0) {
    if (peer.readExpectingHeader) {
      if (peer.readBuffer.length >= HEADER_SIZE) {
        peer.readMessageLength = peer.readBuffer.readUInt32BE(0);
        peer.readBuffer = peer.readBuffer.subarray(HEADER_SIZE);
        peer.readExpectingHeader = false;
      } else {
        break;
      }
    }

    if (!peer.readExpectingHeader) {
      if (peer.readBuffer.length >= peer.readMessageLength) {
        const body = peer.readBuffer.subarray(0, peer.readMessageLength);
        peer.readBuffer = peer.readBuffer.subarray(peer.readMessageLength);
        peer.readExpectingHeader = true;
        return body;
      } else {
        break;
      }
    }
  }
  return null;
}

function isIPAllowed(ip: string, allowedIPs: string[], deniedIPs: string[]): boolean {
  for (const denied of deniedIPs) {
    if (ip === denied || ip.startsWith(denied)) {
      return false;
    }
  }
  if (allowedIPs.length === 0) {
    return true;
  }
  for (const allowed of allowedIPs) {
    if (ip === allowed || ip.startsWith(allowed)) {
      return true;
    }
  }
  return false;
}

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
}

function deriveHMACKey(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex').slice(0, HMAC_KEY_LENGTH);
}

export class P2PServer {
  private server: net.Server | tls.Server | null = null;
  private peers: Map<net.Socket, Peer> = new Map();
  private options: P2PServerOptions;
  private running = false;
  private rateLimitMap: Map<string, RateLimitEntry> = new Map();
  private auditStream: fs.WriteStream | null = null;
  private hmacKey: string;

  constructor(options: P2PServerOptions) {
    this.options = options;
    this.hmacKey = deriveHMACKey(options.password);
  }

  get info(): P2PConnectionInfo {
    return {
      host: this.options.host,
      port: this.options.port,
      peersConnected: this.peers.size,
    };
  }

  async start(): Promise<void> {
    if (this.options.auditLog) {
      try {
        fs.mkdirSync(this.options.auditLog, { recursive: true });
        const logFile = `${this.options.auditLog}/p2p-audit.log`;
        this.auditStream = fs.createWriteStream(logFile, { flags: 'a' });
      } catch {
        console.log(chalk.yellow('Warning: could not open audit log'));
      }
    }

    return new Promise((resolve, reject) => {
      const useTLS = !!(this.options.tlsCert && this.options.tlsKey);

      if (useTLS) {
        const tlsOptions: tls.SecureContextOptions = {
          key: fs.readFileSync(this.options.tlsKey!),
          cert: fs.readFileSync(this.options.tlsCert!),
        };
        if (this.options.tlsCA) {
          tlsOptions.ca = fs.readFileSync(this.options.tlsCA!);
        }
        this.server = tls.createServer(tlsOptions, (socket) => this.onConnection(socket));
      } else {
        this.server = net.createServer((socket) => this.onConnection(socket));
      }

      this.server.on('error', (err: Error) => reject(err));
      this.server.listen(this.options.port, this.options.host, () => {
        this.running = true;
        const addr = this.server?.address();
        const bound = addr ? (typeof addr === 'object' ? `${addr.address}:${addr.port}` : String(addr)) : 'unknown';
        const protocol = useTLS ? 'TLS' : 'TCP';
        console.log(chalk.green(`P2P server listening on ${bound} (${protocol})`));
        console.log(chalk.dim(`  Password: ${this.options.password}`));
        console.log(chalk.dim(`  Interval: ${this.options.intervalMs}ms`));
        const allowedIPs = this.options.allowedIPs ?? [];
        const deniedIPs = this.options.deniedIPs ?? [];
        if (allowedIPs.length > 0) console.log(chalk.dim(`  Allowed IPs: ${allowedIPs.join(', ')}`));
        if (deniedIPs.length > 0) console.log(chalk.dim(`  Denied IPs: ${deniedIPs.join(', ')}`));
        resolve();
      });
    });
  }

  stop(): void {
    this.running = false;
    for (const peer of this.peers.values()) {
      this.disconnectPeer(peer, 'Server shutting down');
    }
    this.peers.clear();
    this.rateLimitMap.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.auditStream) {
      this.auditStream.end();
      this.auditStream = null;
    }
  }

  private audit(ip: string, event: string, detail: string): void {
    if (!this.auditStream) return;
    const ts = new Date().toISOString();
    this.auditStream.write(`${ts} ${ip} ${event} ${detail}\n`);
  }

  private getPeerIP(socket: net.Socket): string {
    const addr = socket.remoteAddress;
    if (!addr) return 'unknown';
    if (addr.startsWith('::ffff:')) {
      return addr.slice(7);
    }
    return addr;
  }

  private checkRateLimit(ip: string): boolean {
    const maxAttempts = this.options.rateLimitMaxAttempts ?? DEFAULT_RATE_LIMIT_MAX;
    const windowMs = this.options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW;
    const now = Date.now();

    const entry = this.rateLimitMap.get(ip);
    if (!entry) {
      this.rateLimitMap.set(ip, { attempts: 1, firstAttempt: now });
      return true;
    }

    if (now - entry.firstAttempt > windowMs) {
      this.rateLimitMap.set(ip, { attempts: 1, firstAttempt: now });
      return true;
    }

    entry.attempts++;
    if (entry.attempts > maxAttempts) {
      return false;
    }
    return true;
  }

  private cleanupRateLimit(ip: string): void {
    this.rateLimitMap.delete(ip);
  }

  private onConnection(socket: net.Socket): void {
    const ip = this.getPeerIP(socket);

    const allowedIPs = this.options.allowedIPs ?? [];
    const deniedIPs = this.options.deniedIPs ?? [];

    if (!isIPAllowed(ip, allowedIPs, deniedIPs)) {
      this.audit(ip, 'BLOCKED', 'IP not allowed');
      console.log(chalk.yellow(`Blocked IP: ${ip}`));
      socket.destroy();
      return;
    }

    if (!this.checkRateLimit(ip)) {
      this.audit(ip, 'RATE_LIMITED', 'Too many auth attempts');
      console.log(chalk.yellow(`Rate limit exceeded for IP: ${ip}`));
      socket.destroy();
      return;
    }

    const peer: Peer = {
      socket,
      authenticated: false,
      intervalHandle: null,
      pingHandle: null,
      readBuffer: Buffer.alloc(0),
      readExpectingHeader: true,
      readMessageLength: 0,
      ip,
      pendingNonce: null,
    };
    this.peers.set(socket, peer);

    const remoteAddr = socket.remoteAddress
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : 'unknown';
    console.log(chalk.cyan(`Peer connected: ${remoteAddr}`));
    this.audit(ip, 'CONNECT', remoteAddr);

    socket.on('data', (data) => this.onData(peer, data));
    socket.on('close', () => this.onPeerClose(peer));
    socket.on('error', (err) => this.onPeerError(peer, err));

    socket.setTimeout(30000);
    socket.on('timeout', () => {
      if (!peer.authenticated) {
        this.disconnectPeer(peer, 'Authentication timeout');
      }
    });

    const nonce = generateNonce();
    this.sendSigned(peer, signMessage('challenge', { nonce }, this.hmacKey));
    peer.pendingNonce = nonce;
  }

  private onData(peer: Peer, data: Buffer): void {
    peer.readBuffer = Buffer.concat([peer.readBuffer, data]);

    if (!peer.authenticated) {
      const body = readMessageFromPeer(peer);
      if (body) {
        this.handleAuthMessage(peer, body);
      }
      return;
    }
  }

  private handleAuthMessage(peer: Peer, body: Buffer): void {
    try {
      const raw = body.toString('utf-8');
      const msg = decodeMessage(body);
      if (msg.kind !== 'auth') {
        peer.socket.write(signMessage('auth-fail', { ok: false, reason: 'Expected auth message first' }, this.hmacKey));
        this.disconnectPeer(peer, 'Expected auth message');
        return;
      }

      const authPayload = msg.payload as { passwordHash?: string; nonce?: string };
      if (!authPayload.passwordHash || !authPayload.nonce) {
        peer.socket.write(signMessage('auth-fail', { ok: false, reason: 'Invalid auth payload' }, this.hmacKey));
        this.disconnectPeer(peer, 'Invalid auth payload');
        return;
      }

      if (peer.pendingNonce && authPayload.nonce !== peer.pendingNonce) {
        this.audit(peer.ip, 'AUTH_FAIL', 'Nonce mismatch');
        peer.socket.write(signMessage('auth-fail', { ok: false, reason: 'Invalid nonce' }, this.hmacKey));
        this.disconnectPeer(peer, 'Invalid nonce');
        return;
      }

      const expectedHash = hashPassword(this.options.password, authPayload.nonce);
      if (authPayload.passwordHash !== expectedHash) {
        this.audit(peer.ip, 'AUTH_FAIL', 'Invalid password hash');
        peer.socket.write(signMessage('auth-fail', { ok: false, reason: 'Invalid password' }, this.hmacKey));
        this.disconnectPeer(peer, 'Authentication failed');
        return;
      }

      peer.authenticated = true;
      this.cleanupRateLimit(peer.ip);
      peer.pendingNonce = null;
      peer.socket.write(signMessage('auth-ok', { ok: true }, this.hmacKey));
      console.log(chalk.green(`Peer authenticated: ${peer.socket.remoteAddress}`));
      this.audit(peer.ip, 'AUTH_OK', 'Challenge-response successful');
      this.startDataStream(peer);
      this.startPing(peer);
    } catch {
      peer.socket.write(signMessage('auth-fail', { ok: false, reason: 'Invalid message format' }, this.hmacKey));
      this.disconnectPeer(peer, 'Invalid message format');
    }
  }

  private sendSigned(peer: Peer, message: Buffer): void {
    if (!peer.socket.destroyed) {
      peer.socket.write(message);
    }
  }

  private startDataStream(peer: Peer): void {
    const send = async () => {
      if (!peer.authenticated || peer.socket.destroyed) return;
      try {
        const data = await collectAll({ detailed: this.options.detailed });
        this.sendSigned(peer, signMessage('data', { stats: data }, this.hmacKey));
      } catch {
        // skip failed tick
      }
    };

    send();
    peer.intervalHandle = setInterval(send, this.options.intervalMs);
  }

  private startPing(peer: Peer): void {
    peer.pingHandle = setInterval(() => {
      if (peer.socket.destroyed) return;
      this.sendSigned(peer, signMessage('ping', { ts: Date.now() }, this.hmacKey));
    }, 5000);
  }

  private onPeerClose(peer: Peer): void {
    this.cleanupPeer(peer);
    console.log(chalk.yellow(`Peer disconnected: ${peer.socket.remoteAddress}`));
    this.audit(peer.ip, 'DISCONNECT', 'Peer closed connection');
  }

  private onPeerError(peer: Peer, err: Error): void {
    const code = (err as any).code;
    if (code === 'ECONNRESET') {
      console.log(chalk.yellow(`Peer connection reset: ${peer.socket.remoteAddress}`));
      this.audit(peer.ip, 'ERROR', 'Connection reset');
    } else {
      console.log(chalk.red(`Peer error: ${err.message}`));
      this.audit(peer.ip, 'ERROR', err.message);
    }
    this.cleanupPeer(peer);
  }

  private disconnectPeer(peer: Peer, reason: string): void {
    try {
      this.sendSigned(peer, signMessage('disconnect', { reason }, this.hmacKey));
    } catch {
      // socket may already be closed
    }
    peer.socket.destroy();
  }

  private cleanupPeer(peer: Peer): void {
    if (peer.intervalHandle) {
      clearInterval(peer.intervalHandle);
      peer.intervalHandle = null;
    }
    if (peer.pingHandle) {
      clearInterval(peer.pingHandle);
      peer.pingHandle = null;
    }
    this.peers.delete(peer.socket);
  }
}

export async function startP2PServer(options: P2PServerOptions): Promise<P2PServer> {
  const server = new P2PServer(options);
  await server.start();
  return server;
}
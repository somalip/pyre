import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { encodeChallenge, encodeAuth, encodePing, encodePong, encodeDisconnect, hashPassword, computeHMAC, verifyHMAC, signMessage, decodeMessage, generateNonce } from './protocol.js';
import type { P2PClientOptions } from './types.js';
import type { StatsData } from '../monitors/types.js';

interface ReadState {
  buffer: Buffer;
  expectingHeader: boolean;
  messageLength: number;
}

export class P2PClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private options: P2PClientOptions;
  private running = false;
  private readState: ReadState = { buffer: Buffer.alloc(0), expectingHeader: true, messageLength: 0 };
  private onDataCallback: ((data: StatsData) => void) | null = null;
  private onStatusCallback: ((msg: string) => void) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingHandle: NodeJS.Timeout | null = null;
  private pendingNonce: string | null = null;
  private auditStream: fs.WriteStream | null = null;
  private hmacKey: string;

  constructor(options: P2PClientOptions) {
    this.options = options;
    this.hmacKey = deriveHMACKey(options.password);
  }

  setOnData(cb: (data: StatsData) => void): void {
    this.onDataCallback = cb;
  }

  setOnStatus(cb: (msg: string) => void): void {
    this.onStatusCallback = cb;
  }

  async connect(): Promise<void> {
    if (this.options.auditLog) {
      try {
        fs.mkdirSync(this.options.auditLog, { recursive: true });
        const logFile = `${this.options.auditLog}/p2p-client-audit.log`;
        this.auditStream = fs.createWriteStream(logFile, { flags: 'a' });
      } catch {
        console.log(chalk.yellow('Warning: could not open audit log'));
      }
    }

    return new Promise((resolve, reject) => {
      const useTLS = !!this.options.tls;

      if (useTLS) {
        const tlsOptions: tls.ConnectionOptions = {
          host: this.options.host,
          port: this.options.port,
          rejectUnauthorized: !this.options.tlsInsecure,
        };
        if (this.options.tlsCA) {
          tlsOptions.ca = fs.readFileSync(this.options.tlsCA);
        }
        this.socket = tls.connect(tlsOptions, () => {
          this.running = true;
          this.status('Connected');
          resolve();
        });
      } else {
        this.socket = new net.Socket();
        this.socket.setTimeout(10000);
        this.socket.connect(this.options.port, this.options.host, () => {
          this.running = true;
          this.status('Connected');
          resolve();
        });
      }

      this.socket.once('error', (err) => {
        reject(err);
      });
      this.socket.on('data', (data) => this.onData(data));
      this.socket.on('close', () => this.onClose());
      this.socket.on('error', (err) => this.onError(err));
      this.socket.on('timeout', () => this.onTimeout());
    });
  }

  disconnect(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingHandle) {
      clearInterval(this.pingHandle);
      this.pingHandle = null;
    }
    if (this.socket) {
      try {
        this.sendSigned(encodeDisconnect('Client closing'));
      } catch {
        // ignore
      }
      this.socket.destroy();
      this.socket = null;
    }
    if (this.auditStream) {
      this.auditStream.end();
      this.auditStream = null;
    }
    this.status('Disconnected');
  }

  private onData(data: Buffer): void {
    this.readState.buffer = Buffer.concat([this.readState.buffer, data]);

    while (this.readState.buffer.length > 0) {
      if (this.readState.expectingHeader) {
        if (this.readState.buffer.length >= 4) {
          this.readState.messageLength = this.readState.buffer.readUInt32BE(0);
          this.readState.buffer = this.readState.buffer.subarray(4);
          this.readState.expectingHeader = false;
        } else {
          break;
        }
      }

      if (!this.readState.expectingHeader) {
        if (this.readState.buffer.length >= this.readState.messageLength) {
          const body = this.readState.buffer.subarray(0, this.readState.messageLength);
          this.readState.buffer = this.readState.buffer.subarray(this.readState.messageLength);
          this.readState.expectingHeader = true;
          this.handleMessage(body);
        } else {
          break;
        }
      }
    }
  }

  private handleMessage(body: Buffer): void {
    try {
      const raw = body.toString('utf-8');
      const msg = decodeMessage(body);

      if (!verifyHMAC(raw, msg.hmac ?? '', this.hmacKey)) {
        this.status('Message integrity check failed');
        return;
      }

      switch (msg.kind) {
        case 'challenge':
          const challengePayload = msg.payload as { nonce?: string };
          if (challengePayload.nonce) {
            this.pendingNonce = challengePayload.nonce;
            const passwordHash = hashPassword(this.options.password, challengePayload.nonce);
            this.sendSigned(signMessage('auth', { passwordHash, nonce: challengePayload.nonce }, this.hmacKey));
            this.status('Authenticating...');
          }
          break;

        case 'auth-ok':
          this.status('Authenticated — receiving live data');
          this.startPing();
          break;

        case 'auth-fail':
          const failPayload = msg.payload as { reason?: string };
          this.status(`Authentication failed: ${failPayload.reason || 'unknown'}`);
          this.disconnect();
          break;

        case 'data':
          if (this.onDataCallback) {
            const dataPayload = msg.payload as { stats?: StatsData };
            if (dataPayload.stats) {
              this.onDataCallback(dataPayload.stats);
            }
          }
          break;

        case 'ping':
          if (this.socket && !this.socket.destroyed) {
            const ts = (msg.payload as { ts: number }).ts;
            this.sendSigned(signMessage('pong', { ts }, this.hmacKey));
          }
          break;

        case 'pong':
          break;

        case 'disconnect':
          const disconnectPayload = msg.payload as { reason?: string };
          this.status(`Server disconnected: ${disconnectPayload.reason || 'unknown'}`);
          this.disconnect();
          break;

        default:
          break;
      }
    } catch {
      // ignore malformed messages
    }
  }

  private sendSigned(message: Buffer): void {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.write(message);
      } catch {
        // ignore write errors; socket likely closed
      }
    }
  }

  private startPing(): void {
    this.pingHandle = setInterval(() => {
      if (this.socket && !this.socket.destroyed) {
        this.sendSigned(signMessage('ping', { ts: Date.now() }, this.hmacKey));
      }
    }, 15000);
  }

  private onClose(): void {
    if (this.running) {
      this.status('Connection closed — reconnecting in 3s');
      this.reconnectTimer = setTimeout(() => {
        if (this.running) this.connect().catch(() => {});
      }, 3000);
    }
  }

  private onError(err: Error): void {
    const code = (err as any).code;
    if (code === 'ECONNREFUSED') {
      this.status('Connection refused — is the server running?');
    } else if (code === 'ETIMEDOUT') {
      this.status('Connection timed out');
    } else if (code === 'EHOSTDOWN' || code === 'EHOSTUNREACH') {
      this.status(`Host unreachable — ${err.message}`);
    } else if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      this.status('TLS certificate verification failed — use --p2p-insecure to skip');
    } else {
      this.status(`Connection error: ${err.message}`);
    }
  }

  private onTimeout(): void {
    this.status('Connection timed out');
    this.disconnect();
  }

  private status(msg: string): void {
    if (this.onStatusCallback) {
      this.onStatusCallback(msg);
    }
  }

  audit(event: string, detail: string): void {
    if (!this.auditStream) return;
    const ts = new Date().toISOString();
    const ip = this.options.host;
    this.auditStream.write(`${ts} ${ip} ${event} ${detail}\n`);
  }
}

function deriveHMACKey(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex').slice(0, 32);
}

export async function connectP2PClient(options: P2PClientOptions): Promise<P2PClient> {
  const client = new P2PClient(options);
  await client.connect();
  return client;
}
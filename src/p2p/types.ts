/**
 * P2P live data transfer protocol types.
 *
 * Defines the message shapes exchanged between a pyre server
 * (host) and a pyre client (peer) over a TCP connection.
 */

export type P2PMessageKind = 'auth' | 'auth-ok' | 'auth-fail' | 'data' | 'ping' | 'pong' | 'disconnect' | 'challenge';

export interface P2PMessage {
  kind: P2PMessageKind;
  payload: unknown;
  hmac?: string;
}

export interface ChallengeMessage {
  nonce: string;
}

export interface AuthMessage {
  passwordHash: string;
  nonce: string;
}

export interface AuthOkMessage {
  ok: true;
}

export interface AuthFailMessage {
  ok: false;
  reason: string;
}

export interface DataMessage {
  stats: import('../monitors/types.js').StatsData;
}

export interface PingMessage {
  ts: number;
}

export interface PongMessage {
  ts: number;
}

export interface DisconnectMessage {
  reason: string;
}

export type P2PPayload =
  | ChallengeMessage
  | AuthMessage
  | AuthOkMessage
  | AuthFailMessage
  | DataMessage
  | PingMessage
  | PongMessage
  | DisconnectMessage;

export interface P2PServerOptions {
  host: string;
  port: number;
  password: string;
  intervalMs: number;
  detailed: boolean;
  tlsCert?: string;
  tlsKey?: string;
  tlsCA?: string;
  rateLimitMaxAttempts?: number;
  rateLimitWindowMs?: number;
  allowedIPs?: string[];
  deniedIPs?: string[];
  auditLog?: string;
  hmacKey?: string;
  onLog?: (msg: string) => void;
}

export interface P2PClientOptions {
  host: string;
  port: number;
  password: string;
  tls?: boolean;
  tlsCA?: string;
  tlsInsecure?: boolean;
  auditLog?: string;
  hmacKey?: string;
}

export interface P2PConnectionInfo {
  host: string;
  port: number;
  peersConnected: number;
}

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
}
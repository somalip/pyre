import crypto from 'node:crypto';
import type { P2PMessage, P2PMessageKind, P2PPayload, ChallengeMessage, AuthMessage } from './types.js';
import type { StatsData } from '../monitors/types.js';

const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;
const HMAC_ALGO = 'sha256';

function buildMessage(kind: P2PMessageKind, payload: P2PPayload, hmac?: string): Buffer {
  const envelope: P2PMessage = { kind, payload };
  if (hmac) envelope.hmac = hmac;
  const body = Buffer.from(JSON.stringify(envelope), 'utf-8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashPassword(password: string, nonce: string): string {
  return crypto.createHash('sha256').update(`${password}:${nonce}`).digest('hex');
}

export function computeHMAC(body: string, key?: string): string | undefined {
  if (!key) return undefined;
  return crypto.createHmac(HMAC_ALGO, key).update(body).digest('hex');
}

export function verifyHMAC(body: string, expectedHmac: string, key?: string): boolean {
  if (!key) return expectedHmac === undefined;
  if (!expectedHmac) return false;
  try {
    const parsed = JSON.parse(body) as P2PMessage;
    const payloadWithoutHmac = { ...parsed, hmac: undefined };
    const canonical = JSON.stringify(payloadWithoutHmac);
    const computed = crypto.createHmac(HMAC_ALGO, key).update(canonical).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedHmac));
  } catch {
    return false;
  }
}

export function encodeChallenge(nonce: string): Buffer {
  return buildMessage('challenge', { nonce });
}

export function encodeAuth(passwordHash: string, nonce: string): Buffer {
  return buildMessage('auth', { passwordHash, nonce });
}

export function encodeAuthOk(): Buffer {
  return buildMessage('auth-ok', { ok: true });
}

export function encodeAuthFail(reason: string): Buffer {
  return buildMessage('auth-fail', { ok: false, reason });
}

export function encodeData(stats: StatsData): Buffer {
  return buildMessage('data', { stats });
}

export function encodePing(): Buffer {
  return buildMessage('ping', { ts: Date.now() });
}

export function encodePong(ts: number): Buffer {
  return buildMessage('pong', { ts });
}

export function encodeDisconnect(reason: string): Buffer {
  return buildMessage('disconnect', { reason });
}

export function decodeMessage(buf: Buffer): P2PMessage {
  const str = buf.toString('utf-8');
  const msg: P2PMessage = JSON.parse(str);
  return msg;
}

export function signMessage(kind: P2PMessageKind, payload: P2PPayload, key?: string): Buffer {
  const envelope: P2PMessage = { kind, payload };
  const bodyJson = JSON.stringify(envelope);
  const hmac = computeHMAC(bodyJson, key);
  return buildMessage(kind, payload, hmac);
}

export function readMessage(stream: { read(n: number): Buffer | null }): Buffer | null {
  const header = stream.read(HEADER_SIZE);
  if (!header || header.length < HEADER_SIZE) return null;
  const length = header.readUInt32BE(0);
  if (length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${length} bytes`);
  }
  const body = stream.read(length);
  if (!body || body.length < length) return null;
  return body;
}

export function readAll(stream: { read(n: number): Buffer | null }, total: number): Buffer {
  const chunks: Buffer[] = [];
  let remaining = total;
  while (remaining > 0) {
    const chunk = stream.read(remaining);
    if (!chunk) break;
    chunks.push(chunk);
    remaining -= chunk.length;
  }
  return Buffer.concat(chunks);
}
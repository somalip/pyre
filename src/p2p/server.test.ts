import { describe, it, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { P2PServer, startP2PServer } from './server.js';
import { hashPassword, generateNonce, signMessage, decodeMessage } from './protocol.js';

const TEST_PASSWORD = 'test-secret-password';
const TEST_HOST = '127.0.0.1';
const HEADER_SIZE = 4;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readMessage(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    function readHeader(): void {
      if (socket.readableLength < HEADER_SIZE) {
        socket.once('readable', readHeader);
        return;
      }
      const header = socket.read(HEADER_SIZE);
      if (!header || header.length < HEADER_SIZE) {
        reject(new Error('Failed to read message header'));
        return;
      }
      const length = header.readUInt32BE(0);
      readBody(length);
    }

    function readBody(length: number): void {
      if (socket.readableLength < length) {
        socket.once('readable', () => readBody(length));
        return;
      }
      const body = socket.read(length);
      if (!body || body.length < length) {
        reject(new Error('Failed to read message body'));
        return;
      }
      resolve(body);
    }

    readHeader();
  });
}

function makeAuthMessage(password: string, nonce: string) {
  const passwordHash = hashPassword(password, nonce);
  return signMessage('auth', { passwordHash, nonce }, password);
}

describe('P2PServer - server-side p2p system', () => {
  let server: P2PServer | null = null;
  let serverPort: number = 0;

  afterEach(async () => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  after(async () => {
    if (server) {
      server.stop();
    }
  });

  describe('server lifecycle', () => {
    it('should start and listen on a TCP port', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();
      assert.strictEqual(server.info.port, serverPort);
      assert.strictEqual(server.info.host, TEST_HOST);
      assert.strictEqual(server.info.peersConnected, 0);
    });

    it('should report correct connection info after start', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();
      const info = server.info;
      assert.strictEqual(info.host, TEST_HOST);
      assert.strictEqual(info.port, serverPort);
      assert.strictEqual(info.peersConnected, 0);
    });

    it('should stop and clear all peers', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();
      server.stop();
      assert.strictEqual(server.info.peersConnected, 0);
    });

    it('should emit peer events on startup', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();
      const events = server.peerEventHistory;
      assert.ok(events.length > 0, 'Expected at least one peer event');
      const connectEvent = events.find(e => e.type === 'connect');
      assert.ok(connectEvent, 'Expected a connect event in history');
    });

    it('should support startP2PServer convenience function', async () => {
      serverPort = await getFreePort();
      server = await startP2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      assert.strictEqual(server.info.port, serverPort);
    });
  });

  describe('challenge-response authentication', () => {
    it('should send a challenge with a nonce on new connection', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const body = await readMessage(client);
      const msg = decodeMessage(body);
      assert.strictEqual(msg.kind, 'challenge');
      const payload = msg.payload as { nonce: string };
      assert.ok(payload.nonce, 'Expected a nonce in the challenge message');
      client.destroy();
    });

    it('should authenticate a client with the correct password', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      const authMsg = decodeMessage(authBody);
      assert.strictEqual(authMsg.kind, 'auth-ok');
      assert.strictEqual((authMsg.payload as { ok: boolean }).ok, true);
      assert.strictEqual(server!.info.peersConnected, 1);
      assert.ok(server!.peerEventHistory.some(e => e.type === 'auth'), 'Expected auth event in history');

      client.destroy();
    });

    it('should reject authentication with wrong password', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage('wrong-password', nonce));

      const failBody = await readMessage(client);
      const failMsg = decodeMessage(failBody);
      assert.strictEqual(failMsg.kind, 'auth-fail');
      const failPayload = failMsg.payload as { reason: string };
      assert.ok(
        failPayload.reason.toLowerCase().includes('password') || failPayload.reason.toLowerCase().includes('invalid'),
        `Expected password-related failure reason, got: ${failPayload.reason}`
      );
      assert.strictEqual(server!.info.peersConnected, 0, 'No peers should be connected after failed auth');

      client.destroy();
    });

    it('should reject auth message with empty nonce', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;

      client.write(signMessage('auth', { passwordHash: 'somehash', nonce: '' }, TEST_PASSWORD));

      const failBody = await readMessage(client);
      const failMsg = decodeMessage(failBody);
      assert.strictEqual(failMsg.kind, 'auth-fail');

      client.destroy();
    });

    it('should reject non-auth messages sent before authentication', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;

      client.write(signMessage('data', { stats: {} }, TEST_PASSWORD));

      const failBody = await readMessage(client);
      const failMsg = decodeMessage(failBody);
      assert.strictEqual(failMsg.kind, 'auth-fail');

      client.destroy();
    });

    it('should disconnect client after wrong password attempt', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage('wrong-password', nonce));

      const failBody = await readMessage(client);
      decodeMessage(failBody);

      await delay(200);
      assert.ok(server!.info.peersConnected === 0, 'Server should have no connected peers after failed auth');

      client.destroy();
    });
  });

  describe('data streaming', () => {
    it('should stream StatsData to an authenticated client', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 200,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      const authMsg = decodeMessage(authBody);
      assert.strictEqual(authMsg.kind, 'auth-ok');

      const dataBody = await readMessage(client);
      const dataMsg = decodeMessage(dataBody);
      assert.strictEqual(dataMsg.kind, 'data');

      client.destroy();
    });

    it('should send multiple data messages on interval', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 150,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      const authMsg = decodeMessage(authBody);
      assert.strictEqual(authMsg.kind, 'auth-ok');

      const dataBody1 = await readMessage(client);
      assert.strictEqual(decodeMessage(dataBody1).kind, 'data');

      const dataBody2 = await readMessage(client);
      assert.strictEqual(decodeMessage(dataBody2).kind, 'data');

      client.destroy();
    });
  });

  describe('ping/pong', () => {
    it('should exchange ping and pong after authentication', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      assert.strictEqual(decodeMessage(authBody).kind, 'auth-ok');

      const dataBody = await readMessage(client);
      assert.strictEqual(decodeMessage(dataBody).kind, 'data');

      let pingCount = 0;
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && pingCount < 1) {
        const msg = await readMessage(client);
        const kind = decodeMessage(msg).kind;
        if (kind === 'ping') {
          pingCount++;
          const ts = (decodeMessage(msg).payload as { ts: number }).ts;
          client.write(signMessage('pong', { ts }, TEST_PASSWORD));
        }
      }
      assert.ok(pingCount >= 1, 'Expected at least 1 ping after authentication');

      client.destroy();
    });

    it('should continue pinging a long-lived connection', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      assert.strictEqual(decodeMessage(authBody).kind, 'auth-ok');

      const firstData = await readMessage(client);
      assert.strictEqual(decodeMessage(firstData).kind, 'data');

      let pingCount = 0;
      const deadline = Date.now() + 16000;
      while (Date.now() < deadline && pingCount < 3) {
        const msg = await readMessage(client);
        const kind = decodeMessage(msg).kind;
        if (kind === 'ping') {
          pingCount++;
          const ts = (decodeMessage(msg).payload as { ts: number }).ts;
          client.write(signMessage('pong', { ts }, TEST_PASSWORD));
        }
      }
      assert.ok(pingCount >= 3, `Expected at least 3 pings, got ${pingCount}`);

      client.destroy();
    });
  });

  describe('peer event history', () => {
    it('should track connect, auth, and disconnect events', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      const client = new net.Socket();
      client.connect(serverPort, TEST_HOST);

      const challengeBody = await readMessage(client);
      const challengeMsg = decodeMessage(challengeBody);
      const nonce = (challengeMsg.payload as { nonce: string }).nonce;
      client.write(makeAuthMessage(TEST_PASSWORD, nonce));

      const authBody = await readMessage(client);
      assert.strictEqual(decodeMessage(authBody).kind, 'auth-ok');

      assert.ok(
        server!.peerEventHistory.some(e => e.type === 'connect'),
        'Expected connect event in history'
      );
      assert.ok(
        server!.peerEventHistory.some(e => e.type === 'auth'),
        'Expected auth event in history'
      );

      client.destroy();

      await delay(200);

      assert.ok(
        server!.peerEventHistory.some(e => e.type === 'disconnect'),
        'Expected disconnect event in history'
      );
    });

    it('should cap peer event history at 200 entries', async () => {
      serverPort = await getFreePort();
      server = new P2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      await server.start();

      assert.ok(server.peerEventHistory.length <= 200, 'Expected event history to be capped at 200');
    });
  });

  describe('convenience start function', () => {
    it('startP2PServer should create and start a server', async () => {
      serverPort = await getFreePort();
      server = await startP2PServer({
        host: TEST_HOST,
        port: serverPort,
        password: TEST_PASSWORD,
        intervalMs: 1000,
        detailed: false,
      });
      assert.strictEqual(server.info.port, serverPort);
      assert.strictEqual(server.info.host, TEST_HOST);
    });
  });
});
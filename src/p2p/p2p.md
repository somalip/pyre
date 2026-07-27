# src/p2p/ — P2P Live Data Transfer Module

The P2P module enables live system-metric data streaming between two machines over a TCP (or TLS) connection. It implements a challenge-response authentication protocol with HMAC message signing, and supports optional audit logging.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export — re-exports `P2PServer`, `startP2PServer`, `P2PClient`, `connectP2PClient`, and types |
| `types.ts` | Type definitions for messages, options, and connection info |
| `protocol.ts` | Message encoding/decoding, HMAC signing/verification, nonce generation |
| `server.ts` | `P2PServer` class — listens for connections, authenticates peers, streams live data |
| `client.ts` — `P2PClient` class — connects to a server, authenticates, receives live data |

## External Dependencies

- **`src/monitors/index.ts`** — `collectAll()` used by the server to gather data for streaming.
- **`src/monitors/types.ts`** — `StatsData` type for streamed data payloads.
- **`node:net`** — TCP server/client sockets.
- **`node:tls`** — TLS server/client for encrypted connections.
- **`node:crypto`** — HMAC signing, SHA-256 hashing, nonce generation.
- **`node:fs`** — Audit log file writing.

## `index.ts` — Barrel Exports

Re-exports the public API:

- **Server:** `P2PServer`, `startP2PServer(options)`
- **Client:** `P2PClient`, `connectP2PClient(options)`
- **Types:** `P2PServerOptions`, `P2PClientOptions`, `P2PConnectionInfo`

## `types.ts` — Type Definitions

### `P2PMessageKind`
Union type for all message types exchanged between server and client:
`'auth' | 'auth-ok' | 'auth-fail' | 'data' | 'ping' | 'pong' | 'disconnect' | 'challenge'`

### `P2PMessage`
Envelope for all messages on the wire:
- `kind: P2PMessageKind` — message type
- `payload: unknown` — type-specific payload
- `hmac?: string` — HMAC signature (present on signed messages)

### Message Payload Types

| Type | Shape | Used By |
|------|-------|---------|
| `ChallengeMessage` | `{ nonce: string }` | Server → Client (challenge) |
| `AuthMessage` | `{ passwordHash: string; nonce: string }` | Client → Server (auth response) |
| `AuthOkMessage` | `{ ok: true }` | Server → Client (auth success) |
| `AuthFailMessage` | `{ ok: false; reason: string }` | Server → Client (auth failure) |
| `DataMessage` | `{ stats: StatsData }` | Server → Client (live data) |
| `PingMessage` | `{ ts: number }` | Server → Client / Client → Server |
| `PongMessage` | `{ ts: number }` | Client → Server / Server → Client |
| `DisconnectMessage` | `{ reason: string }` | Either side |

### `P2PPayload`
Union of all payload types.

### `P2PServerOptions`
Configuration for the P2P server:
- `host: string` — bind address
- `port: number` — listen port
- `password: string` — shared secret for authentication
- `intervalMs: number` — data-stream interval in milliseconds
- `detailed: boolean` — pass through to `collectAll` for detailed sensor data
- `tlsCert?`, `tlsKey?`, `tlsCA?` — TLS certificate paths for encrypted connections
- `rateLimitMaxAttempts?` — max auth attempts per IP per window (default 5)
- `rateLimitWindowMs?` — time window for rate limiting in ms (default 60000)
- `allowedIPs?` — whitelist of allowed IPs (empty = all)
- `deniedIPs?` — blacklist of denied IPs
- `auditLog?` — directory for audit log files
- `hmacKey?` — HMAC key override (derived from password if not provided)
- `onLog?` — callback for log messages
- `onPeerEvent?` — callback for peer connection/auth/disconnect/error events

### `P2PClientOptions`
Configuration for the P2P client:
- `host: string` — server address
- `port: number` — server port
- `password: string` — shared secret for authentication
- `tls?` — enable TLS connection
- `tlsCA?` — CA certificate path for TLS verification
- `tlsInsecure?` — skip TLS certificate verification
- `auditLog?` — directory for audit log files
- `hmacKey?` — HMAC key override (derived from password if not provided)

### `P2PConnectionInfo`
Runtime connection info:
- `host: string`
- `port: number`
- `peersConnected: number`

## `protocol.ts` — Wire Protocol

Handles message serialization, HMAC signing/verification, and the binary wire format.

### Wire Format
Each message on the wire is:
1. **4-byte header** — big-endian `UInt32` indicating the body length in bytes
2. **Body** — UTF-8 JSON of the `P2PMessage` envelope (including `hmac` if present)

### `generateNonce(): string`
Generates a 32-byte random hex nonce for challenge-response authentication.

### `hashPassword(password: string, nonce: string): string`
Computes `SHA-256(password + ":" + nonce)` as a hex string. Used for challenge-response authentication (never transmits the raw password).

### `computeHMAC(body: string, key?: string): string | undefined`
Computes an HMAC-SHA256 of the message body using the provided key. Returns `undefined` if no key is provided.

### `verifyHMAC(body: string, expectedHmac: string, key?: string): boolean`
Verifies an HMAC signature using timing-safe comparison. Returns `true` if the computed HMAC matches the expected value. Returns `true` if no key is provided and no HMAC is expected.

### `signMessage(kind, payload, key?): Buffer`
Builds a `P2PMessage` envelope, computes its HMAC, and serializes it to the binary wire format (4-byte header + JSON body).

### `encodeChallenge(nonce): Buffer`
Encodes a `challenge` message.

### `encodeAuth(passwordHash, nonce): Buffer`
Encodes an `auth` message.

### `encodeAuthOk(): Buffer`
Encodes an `auth-ok` message.

### `encodeAuthFail(reason): Buffer`
Encodes an `auth-fail` message.

### `encodeData(stats): Buffer`
Encodes a `data` message containing `StatsData`.

### `encodePing(): Buffer`
Encodes a `ping` message with the current timestamp.

### `encodePong(ts): Buffer`
Encodes a `pong` message with the given timestamp.

### `encodeDisconnect(reason): Buffer`
Encodes a `disconnect` message.

### `decodeMessage(buf: Buffer): P2PMessage`
Deserializes a binary message body (UTF-8 JSON) into a `P2PMessage` object.

### `readMessage(stream): Buffer | null`
Reads a single message from a stream: reads the 4-byte header, then reads the body of the indicated length. Throws if the message exceeds `MAX_MESSAGE_SIZE` (16 MB).

### `readAll(stream, total): Buffer`
Reads exactly `total` bytes from a stream, accumulating chunks into a single `Buffer`.

## `server.ts` — P2P Server

### `P2PServer` Class

#### Constructor
`new P2PServer(options: P2PServerOptions)` — stores options and derives the HMAC key from the password via SHA-256.

#### Properties
- `peerEventHistory` — the last 200 peer events (type, detail, timestamp)
- `info` — `P2PConnectionInfo` with host, port, and connected peer count

#### `start(): Promise<void>`
Starts the server:
1. Opens an audit log file if `options.auditLog` is set.
2. Creates a `net.Server` (or `tls.Server` if TLS cert/key are provided).
3. Listens on `options.host:options.port`.
4. On each new connection, calls `onConnection()`.

#### `stop(): void`
Stops the server:
1. Disconnects all authenticated peers with a `disconnect` message.
2. Clears all peers, rate-limit entries, and peer events.
3. Closes the server socket and audit stream.

#### `onConnection(socket)`
Handles a new TCP connection:
1. Checks the peer IP against `allowedIPs`/`deniedIPs` — blocks if denied.
2. Checks rate limits — drops connections exceeding `rateLimitMaxAttempts` within `rateLimitWindowMs`.
3. Creates a `Peer` state object with a read buffer, header/message parsing state, and `pendingNonce`.
4. Sends a `challenge` message with a fresh nonce.
5. Sets a 30-second socket timeout (disconnects unauthenticated peers).
6. Registers `data`, `close`, and `error` handlers.

#### `onData(peer, data)`
Appends incoming data to the peer's read buffer. For unauthenticated peers, attempts to read and process a complete message (expects `auth` first).

#### `handleAuthMessage(peer, body)`
Processes an authentication message:
1. Decodes the message and verifies it's an `auth` kind.
2. Validates the payload contains `passwordHash` and `nonce`.
3. Checks nonce matches the pending challenge nonce.
4. Computes the expected password hash via `hashPassword(options.password, nonce)` and compares.
5. On success: marks peer as authenticated, sends `auth-ok`, starts the data stream and ping interval.
6. On failure: sends `auth-fail` with a reason and disconnects.

#### `startDataStream(peer)`
Begins streaming `StatsData` to an authenticated peer:
1. Sends an immediate data snapshot.
2. Sets up an interval to send data every `options.intervalMs` milliseconds.
3. Each data message is signed with `signMessage('data', { stats }, hmacKey)`.

#### `startPing(peer)`
Sends a `ping` message every 5 seconds to keep the connection alive.

#### `onPeerClose(peer)` / `onPeerError(peer, err)`
Cleans up peer resources (interval handles, ping handles) and emits disconnect/error events.

#### `disconnectPeer(peer, reason)`
Sends a `disconnect` message and destroys the socket.

#### `checkRateLimit(ip)` / `cleanupRateLimit(ip)`
Tracks auth attempts per IP in a sliding window. Blocks IPs that exceed the threshold.

#### `audit(ip, event, detail)`
Writes an audit log entry if an audit stream is open.

### `startP2PServer(options): Promise<P2PServer>`
Convenience function that creates a `P2PServer`, starts it, and returns the instance.

## `client.ts` — P2P Client

### `P2PClient` Class

#### Constructor
`new P2PClient(options: P2PClientOptions)` — stores options and derives the HMAC key from the password.

#### Callbacks
- `setOnData(cb: (data: StatsData) => void)` — called when a `data` message is received from the server.
- `setOnStatus(cb: (msg: string) => void)` — called for status updates (connecting, authenticating, errors, etc.).

#### `connect(): Promise<void>`
Connects to the P2P server:
1. Opens an audit log file if `options.auditLog` is set.
2. Creates a `net.Socket` (or `tls.TLSSocket` if TLS is enabled).
3. Connects to `options.host:options.port`.
4. Registers `data`, `close`, `error`, and `timeout` handlers.
5. The connection promise resolves when the socket connects (not when authenticated).

#### `disconnect(): void`
Gracefully disconnects:
1. Sends a `disconnect` message.
2. Destroys the socket.
3. Clears reconnect and ping timers.
4. Closes the audit stream.

#### `onData(data: Buffer)`
Handles incoming data from the server:
1. Appends to the read buffer.
2. Loops: reads 4-byte header, then reads the body of the indicated length.
3. For each complete message, calls `handleMessage()`.

#### `handleMessage(body: Buffer)`
Processes a complete message:
1. Verifies the HMAC signature — rejects if verification fails.
2. Dispatches based on `msg.kind`:
   - `challenge` — computes password hash, sends `auth` message.
   - `auth-ok` — starts ping interval.
   - `auth-fail` — shows error and disconnects.
   - `data` — calls `onDataCallback` with the `StatsData` payload.
   - `ping` — responds with `pong`.
   - `pong` — no action (keep-alive acknowledgment).
   - `disconnect` — shows server reason and disconnects.

#### `startPing()`
Sends a `ping` message every 15 seconds.

#### `onClose()`
If the client was running, schedules a reconnect after 3 seconds.

#### `onError(err)`
Maps socket error codes to user-friendly status messages:
- `ECONNREFUSED` — "Connection refused — is the server running?"
- `ETIMEDOUT` — "Connection timed out"
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — TLS cert error, suggests `--p2p-insecure`
- Other errors — shows the error message

#### `onTimeout()`
Treats a socket timeout as a disconnect and triggers reconnection.

#### `audit(event, detail)`
Writes an audit log entry if an audit stream is open.

### `connectP2PClient(options): Promise<P2PClient>`
Convenience function that creates a `P2PClient`, connects it, and returns the instance.
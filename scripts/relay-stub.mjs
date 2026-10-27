#!/usr/bin/env node
// A local stand in for the blind relay and its machine routes, for pairing a simulated phone with
// a real daemon. It forwards bytes by mailbox, stores nothing, and logs only ids, directions and sizes.
//
//   node scripts/relay-stub.mjs [port]
//   MEMNOX_RELAY_URL=ws://127.0.0.1:8787/v1/relay memnox daemon
//
// Point the account's baseUrl at http://127.0.0.1:<port> so the machine routes land here too.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 8787);
const MAILBOX_BYTES = 16;
const MOST_MESSAGE = 65_552;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** token -> { kind: 'machine' } or { kind: 'phone', mailbox } */
const tokens = new Map();
/** mailbox -> { machine: socket | null, phones: Set<socket> } */
const mailboxes = new Map();
const machines = new Set();

// What a client sent is logged with its line breaks written out and other control characters dropped,
// so a mailbox id cannot forge a line.
const loggable = (part) =>
  String(part)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\u0000-\u001f\u007f]/g, '');

function log(...parts) {
  console.log(new Date().toISOString(), ...parts.map(loggable));
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

function bearer(request) {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

const server = createServer((request, response) => {
  const token = bearer(request);
  const route = request.url ?? '';
  const open = /^\/v1\/workspaces\/[^/]+\/machines\/[^/]+\/relay\/mailboxes$/;
  const mint = /^\/v1\/workspaces\/[^/]+\/machines\/[^/]+\/relay\/mailboxes\/([^/]+)\/tokens$/;
  const wake = /^\/v1\/workspaces\/[^/]+\/machines\/[^/]+\/relay\/mailboxes\/([^/]+)\/wake$/;
  const close = /^\/v1\/workspaces\/[^/]+\/machines\/[^/]+\/relay\/mailboxes\/([^/]+)$/;
  if (!token.startsWith('mch_')) return json(response, 401, { error: 'machine token needed' });
  tokens.set(token, { kind: 'machine' });
  if (request.method === 'POST' && open.test(route)) {
    const mailbox = randomBytes(MAILBOX_BYTES).toString('base64url');
    const pairingToken = `rlp_${randomBytes(16).toString('base64url')}`;
    mailboxes.set(mailbox, { phones: new Set() });
    tokens.set(pairingToken, { kind: 'phone', mailbox });
    log('mailbox opened', mailbox);
    return json(response, 201, {
      mailbox,
      pairingToken,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
  }
  if (request.method === 'POST' && mint.test(route)) {
    const mailbox = mint.exec(route)[1];
    const token = `rly_${randomBytes(16).toString('base64url')}`;
    tokens.set(token, { kind: 'phone', mailbox });
    log('phone token minted', mailbox);
    return json(response, 201, { tokenId: `tok_${randomBytes(6).toString('hex')}`, token });
  }
  if (request.method === 'POST' && wake.test(route)) {
    log('wake', wake.exec(route)[1]);
    return json(response, 202, {});
  }
  if (request.method === 'DELETE' && close.test(route)) {
    const mailbox = close.exec(route)[1];
    for (const [each, scope] of tokens) if (scope.mailbox === mailbox) tokens.delete(each);
    for (const phone of mailboxes.get(mailbox)?.phones ?? []) phone.destroy();
    mailboxes.delete(mailbox);
    log('mailbox closed', mailbox);
    return json(response, 204);
  }
  return json(response, 404, { error: 'no such route' });
});

server.on('upgrade', (request, socket) => {
  const scope = tokens.get(bearer(request));
  if (request.url !== '/v1/relay' || scope === undefined) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const accept = createHash('sha1')
    .update(`${request.headers['sec-websocket-key']}${WS_GUID}`)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.scope = scope;
  if (scope.kind === 'machine') machines.add(socket);
  else mailboxes.get(scope.mailbox)?.phones.add(socket);
  log('connected', scope.kind, scope.mailbox ?? '');
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const read = readFrame(pending);
      if (read === null) break;
      pending = pending.subarray(read.length);
      if (read.opcode === 0x8) return socket.end();
      if (read.opcode === 0x2) forward(socket, read.payload);
    }
  });
  socket.on('close', () => {
    machines.delete(socket);
    for (const box of mailboxes.values()) box.phones.delete(socket);
    log('disconnected', scope.kind);
  });
  socket.on('error', () => undefined);
});

/** Checks the token may use the mailbox, then passes the payload on unchanged to the other side. */
function forward(from, message) {
  if (message.length <= MAILBOX_BYTES || message.length > MOST_MESSAGE) return;
  const mailbox = message.subarray(0, MAILBOX_BYTES).toString('base64url');
  const box = mailboxes.get(mailbox);
  if (box === undefined) return;
  if (from.scope.kind === 'phone' && from.scope.mailbox !== mailbox) return;
  const to = from.scope.kind === 'machine' ? [...box.phones] : [...machines];
  log(from.scope.kind === 'machine' ? 'machine to phone' : 'phone to machine', mailbox, message.length);
  for (const socket of to) socket.write(binaryFrame(message));
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let at = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    at = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    at = 10;
  }
  const mask = masked ? buffer.subarray(at, at + 4) : null;
  if (masked) at += 4;
  if (buffer.length < at + length) return null;
  const payload = Buffer.from(buffer.subarray(at, at + length));
  if (mask !== null) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return { opcode, payload, length: at + length };
}

function binaryFrame(payload) {
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x82, payload.length]), payload]);
  if (payload.length < 65_536) {
    const head = Buffer.from([0x82, 126, 0, 0]);
    head.writeUInt16BE(payload.length, 2);
    return Buffer.concat([head, payload]);
  }
  const head = Buffer.alloc(10);
  head[0] = 0x82;
  head[1] = 127;
  head.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([head, payload]);
}

server.listen(PORT, '127.0.0.1', () => log(`relay stub on ws://127.0.0.1:${PORT}/v1/relay`));

#!/usr/bin/env node
// A phone in a terminal, for pairing and steering a real daemon through a relay, local or staging.
// It speaks exactly what docs/remote-contract.md says the iPhone speaks, through the same snow build.
//
//   node scripts/phone-sim.mjs pair '<memnox://pair?d=...>' [name]   pairs, and saves the phone here
//   node scripts/phone-sim.mjs send '<json request>'                 one request through the tunnel
//
// The phone's keys and token are kept in $TMPDIR/memnox-phone-sim.json, so they never reach a repo.

import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const noise = require('../native/noise');

const STATE = join(process.env.TMPDIR ?? tmpdir(), 'memnox-phone-sim.json');
const FRAME = { HANDSHAKE: 1, TRANSPORT: 2, CLOSE: 3 };
const CHUNK = 65_000;

function connect(url, token, mailbox, onPayload) {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.binaryType = 'arraybuffer';
  const id = Buffer.from(mailbox, 'base64url');
  socket.addEventListener('message', (event) => {
    const data = Buffer.from(event.data);
    if (data.subarray(0, 16).equals(id)) onPayload(data.subarray(16));
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error(`could not reach ${url}`)));
  });
  return {
    opened,
    send: (kind, body = Buffer.alloc(0)) => socket.send(Buffer.concat([id, Buffer.from([kind]), body])),
    close: () => socket.close(),
  };
}

function sealer(transport, send) {
  return (line) => {
    const bytes = Buffer.from(line);
    for (let at = 0; at < bytes.length || at === 0; at += CHUNK) {
      const last = at + CHUNK >= bytes.length;
      const plain = Buffer.concat([Buffer.from([last ? 0 : 1]), bytes.subarray(at, at + CHUNK)]);
      send(FRAME.TRANSPORT, transport.encrypt(plain));
      if (bytes.length === 0) break;
    }
  };
}

function opener(transport, onLine) {
  let pending = [];
  return (body) => {
    const plain = transport.decrypt(body);
    pending.push(plain.subarray(1));
    if (plain[0] !== 0) return;
    const line = Buffer.concat(pending).toString();
    pending = [];
    onLine(JSON.parse(line));
  };
}

async function pair(link, name = 'Phone simulator') {
  const qr = JSON.parse(Buffer.from(new URL(link).searchParams.get('d'), 'base64url').toString());
  const keys = noise.generateKeypair();
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = signing.publicKey.export({ format: 'der', type: 'spki' });
  const signingPoint = spki.subarray(spki.length - 65).toString('base64');
  const handshake = noise.Handshake.initiator('XXpsk0', keys.privateKey, undefined, Buffer.from(qr.secret, 'base64'));
  let open = null;
  const relay = connect(qr.relayUrl, qr.pairingToken, qr.mailbox, (payload) => {
    if (payload[0] === FRAME.HANDSHAKE) return second(payload.subarray(1));
    if (payload[0] === FRAME.TRANSPORT && open !== null) return open(payload.subarray(1));
    if (payload[0] === FRAME.CLOSE) return finish(1, 'the Mac closed the pairing');
  });
  function second(body) {
    const said = JSON.parse(handshake.readMessage(body).toString());
    if (handshake.remoteStatic().toString('base64') !== qr.runtimeNoiseStatic) {
      return finish(1, 'the runtime key is not the one in the QR, so the pairing is dropped');
    }
    relay.send(FRAME.HANDSHAKE, handshake.writeMessage(Buffer.from(JSON.stringify({ name, signingPoint }))));
    const hash = handshake.handshakeHash();
    const transport = handshake.intoTransport();
    open = opener(transport, (line) => answered(line, { keys, signing, signingPoint, qr }));
    const proof = sign('sha256', Buffer.from(`memnox-device:v1:${hash.toString('base64')}`), signing.privateKey);
    sealer(transport, relay.send)(JSON.stringify({ proof: proof.toString('base64') }));
    console.log(`Paired with ${said.machine}? Check the Mac shows ${noise.pairingCode(hash)}`);
  }
  function answered(line, kept) {
    if (line.paired !== true) return finish(1, 'the Mac declined');
    writeFileSync(
      STATE,
      JSON.stringify({
        deviceId: line.deviceId,
        relayToken: line.relayToken,
        voice: line.voice,
        relayUrl: kept.qr.relayUrl,
        mailbox: kept.qr.mailbox,
        runtimeNoiseStatic: kept.qr.runtimeNoiseStatic,
        noisePrivate: kept.keys.privateKey.toString('base64'),
        signingKey: kept.signing.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        signingPoint: kept.signingPoint,
      }),
      { mode: 0o600 },
    );
    finish(0, `paired as ${line.deviceId}, voice ${line.voice}, kept in ${STATE}`);
  }
  function finish(code, words) {
    console.log(words);
    relay.close();
    process.exitCode = code;
  }
  await relay.opened;
  relay.send(FRAME.HANDSHAKE, handshake.writeMessage(Buffer.alloc(0)));
}

async function send(json) {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  const request = JSON.parse(json);
  // A confirm with a yes is signed, the same way the iPhone signs it with Face ID.
  if (request.method === 'confirm' && request.answer !== 'deny' && request.answer !== 'declined') {
    const key = createPrivateKey(state.signingKey);
    request.signature = sign('sha256', Buffer.from(`memnox-confirm:v1:${request.subject}:${request.answer}`), key).toString('base64');
  }
  const handshake = noise.Handshake.initiator('IK', Buffer.from(state.noisePrivate, 'base64'), Buffer.from(state.runtimeNoiseStatic, 'base64'));
  let open = null;
  let seal = null;
  const relay = connect(state.relayUrl, state.relayToken, state.mailbox, (payload) => {
    if (payload[0] === FRAME.HANDSHAKE) {
      handshake.readMessage(payload.subarray(1));
      const transport = handshake.intoTransport();
      open = opener(transport, (line) => {
        console.log(JSON.stringify(line));
        const ends = line.id === request.id && (line.chunk === undefined || ['done', 'limited', 'failed', 'cancelled'].includes(line.chunk.kind));
        if (ends && request.method !== 'subscribe') relay.close();
      });
      seal = sealer(transport, relay.send);
      seal(JSON.stringify(request));
    } else if (payload[0] === FRAME.TRANSPORT && open !== null) open(payload.subarray(1));
    else if (payload[0] === FRAME.CLOSE) relay.close();
  });
  await relay.opened;
  relay.send(FRAME.HANDSHAKE, handshake.writeMessage(Buffer.alloc(0)));
}

const [command, argument, name] = process.argv.slice(2);
if (command === 'pair' && argument !== undefined) await pair(argument, name);
else if (command === 'send' && argument !== undefined) await send(argument);
else console.log("usage: phone-sim.mjs pair '<memnox://pair?d=...>' [name] | send '<json request>'");

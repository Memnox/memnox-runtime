'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeypair, Handshake, pairingCode } = require('..');

test('pairing over XXpsk0 then a session over IK, through the addon', () => {
  const phone = generateKeypair();
  const runtime = generateKeypair();
  assert.equal(phone.publicKey.length, 32);
  assert.equal(phone.privateKey.length, 32);
  const secret = Buffer.alloc(32, 7);

  const ip = Handshake.initiator('XXpsk0', phone.privateKey, undefined, secret);
  const rp = Handshake.responder('XXpsk0', runtime.privateKey, secret);
  assert.equal(ip.remoteStatic(), null);
  rp.readMessage(ip.writeMessage(Buffer.alloc(0)));
  const hello = ip.readMessage(rp.writeMessage(Buffer.from('{"machine":"mac"}')));
  assert.equal(hello.toString(), '{"machine":"mac"}');
  rp.readMessage(ip.writeMessage(Buffer.from('{"name":"phone"}')));
  assert.ok(ip.isFinished() && rp.isFinished());
  assert.deepEqual(rp.remoteStatic(), phone.publicKey);
  assert.deepEqual(ip.remoteStatic(), runtime.publicKey);
  const code = pairingCode(ip.handshakeHash());
  assert.match(code, /^\d{6}$/);
  assert.equal(code, pairingCode(rp.handshakeHash()));

  const ii = Handshake.initiator('IK', phone.privateKey, runtime.publicKey);
  const ri = Handshake.responder('IK', runtime.privateKey);
  ri.readMessage(ii.writeMessage(Buffer.alloc(0)));
  ii.readMessage(ri.writeMessage(Buffer.alloc(0)));
  assert.deepEqual(ri.remoteStatic(), phone.publicKey);
  const a = ii.intoTransport();
  const b = ri.intoTransport();
  assert.throws(() => ii.isFinished());
  assert.equal(b.decrypt(a.encrypt(Buffer.from('ping'))).toString(), 'ping');
  a.rekeyOutgoing();
  b.rekeyIncoming();
  assert.equal(b.decrypt(a.encrypt(Buffer.from('after rekey'))).toString(), 'after rekey');
  assert.equal(a.decrypt(b.encrypt(Buffer.from('pong'))).toString(), 'pong');
});

test('a wrong psk and a wrong runtime key both throw', () => {
  const phone = generateKeypair();
  const runtime = generateKeypair();
  const i = Handshake.initiator('XXpsk0', phone.privateKey, undefined, Buffer.alloc(32, 1));
  const r = Handshake.responder('XXpsk0', runtime.privateKey, Buffer.alloc(32, 2));
  assert.throws(() => r.readMessage(i.writeMessage(Buffer.alloc(0))));
  const ik = Handshake.initiator('IK', phone.privateKey, generateKeypair().publicKey);
  const rk = Handshake.responder('IK', runtime.privateKey);
  assert.throws(() => rk.readMessage(ik.writeMessage(Buffer.alloc(0))));
});

test('pairingCode is the first four bytes big endian mod a million', () => {
  assert.equal(pairingCode(Buffer.from([0, 0, 0, 7, 0xff])), '000007');
  assert.equal(pairingCode(Buffer.from([0xff, 0xff, 0xff, 0xff])), '967295');
  assert.throws(() => pairingCode(Buffer.from([1, 2])));
  assert.throws(() => Handshake.initiator('NN', generateKeypair().privateKey));
});

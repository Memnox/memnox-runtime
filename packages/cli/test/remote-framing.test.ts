import { describe, expect, it } from 'vitest';
import {
  FRAME,
  MOST_RELAY_MESSAGE,
  MAILBOX_BYTES,
  SecureChannel,
} from '../src/remote/framing';
import { loadNoise, NOISE_PATTERN } from '../src/remote/noise';

/**
 * Lines inside the tunnel: chunked under the relay's size, joined back whole, and rekeyed on the
 * same message count at both ends, with every cipher operation left to snow.
 */

function pair(rekeyEvery?: number): { phone: SecureChannel; mac: SecureChannel } {
  const noise = loadNoise();
  const phoneKey = noise.generateKeypair();
  const macKey = noise.generateKeypair();
  const initiator = noise.initiate(NOISE_PATTERN.IK, phoneKey.privateKey, {
    publicKey: macKey.publicKey,
  });
  const responder = noise.respond(NOISE_PATTERN.IK, macKey.privateKey);
  responder.readMessage(initiator.writeMessage(Buffer.alloc(0)));
  initiator.readMessage(responder.writeMessage(Buffer.alloc(0)));
  expect(responder.remoteStatic()).toEqual(phoneKey.publicKey);
  return {
    phone: new SecureChannel(initiator.intoTransport(), rekeyEvery),
    mac: new SecureChannel(responder.intoTransport(), rekeyEvery),
  };
}

function across(from: SecureChannel, to: SecureChannel, line: string): string | null {
  let joined: string | null = null;
  for (const each of from.seal(line)) {
    expect(each[0]).toBe(FRAME.TRANSPORT);
    expect(each.length + MAILBOX_BYTES).toBeLessThanOrEqual(MOST_RELAY_MESSAGE);
    joined = to.open(each.subarray(1));
  }
  return joined;
}

describe('the tunnel framing', () => {
  it('carries a line longer than one chunk as several, joined back whole', () => {
    const { phone, mac } = pair();
    const line = JSON.stringify({ id: 1, method: 'ask', said: 'ü'.repeat(70_000) });

    expect(across(phone, mac, line)).toBe(line);
    expect(phone.counts().sent).toBe(3);
  });

  it('drops the newline the socket protocol ends a line with', () => {
    const { phone, mac } = pair();
    expect(across(mac, phone, '{"id":1,"ok":true}\n')).toBe('{"id":1,"ok":true}');
  });

  it('rekeys both directions on the same message count, and keeps talking after', () => {
    const { phone, mac } = pair(3);
    for (let at = 0; at < 7; at += 1) {
      expect(across(phone, mac, `{"id":${at}}`)).toBe(`{"id":${at}}`);
      expect(across(mac, phone, `{"id":${at}}`)).toBe(`{"id":${at}}`);
    }
    expect(phone.counts()).toEqual({ sent: 7, received: 7 });
  });

  it('throws on a frame that was tampered with', () => {
    const { phone, mac } = pair();
    const [sealed] = phone.seal('{"id":1}');
    const forged = Buffer.from(sealed ?? Buffer.alloc(0));
    forged.writeUInt8(forged.readUInt8(forged.length - 1) ^ 1, forged.length - 1);
    expect(() => mac.open(forged.subarray(1))).toThrow();
  });
});

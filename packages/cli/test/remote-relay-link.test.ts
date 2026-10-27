import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAILBOX_BYTES, MOST_RELAY_MESSAGE } from '../src/remote/framing';
import {
  jitteredRetryMs,
  RelayLink,
  relayUrl,
  RELAY_URL,
} from '../src/remote/relay-link';
import { MAILBOX, MemoryRelay } from './phone-harness';

/**
 * The machine's one WebSocket to the relay: bytes by mailbox, nothing past the relay's size, and
 * back off and try again when it drops, telling the endpoint every session through it is gone.
 */

afterEach(() => {
  vi.useRealTimers();
});

function link(relay: MemoryRelay, onFrame = vi.fn(), onDown = vi.fn()): RelayLink {
  return new RelayLink({
    url: 'ws://127.0.0.1:8787/v1/relay',
    token: 'mch_test',
    onFrame,
    onDown,
    log: () => undefined,
    open: relay.open,
  });
}

describe('the relay link', () => {
  it('reads the relay from the environment, or the cloud by default', () => {
    expect(relayUrl({})).toBe(RELAY_URL);
    expect(relayUrl({ MEMNOX_RELAY_URL: 'ws://127.0.0.1:1/v1/relay' })).toBe(
      'ws://127.0.0.1:1/v1/relay',
    );
  });

  it('puts the mailbox ahead of every payload, and refuses one past the size', async () => {
    const relay = new MemoryRelay();
    const linked = link(relay);
    linked.start();
    await Promise.resolve();

    expect(linked.send(MAILBOX, Buffer.from([1, 2, 3]))).toBe(true);
    expect(relay.sent[0]?.subarray(0, MAILBOX_BYTES).toString('base64url')).toBe(MAILBOX);
    expect(linked.send(MAILBOX, Buffer.alloc(MOST_RELAY_MESSAGE))).toBe(false);
    expect(linked.send('short', Buffer.from([1]))).toBe(false);
  });

  it('hands each frame on by mailbox, and drops a message too short to carry one', async () => {
    const relay = new MemoryRelay();
    const onFrame = vi.fn();
    link(relay, onFrame).start();
    await Promise.resolve();

    relay.deliver(MAILBOX, Buffer.from([2, 9]));
    relay.deliver(MAILBOX, Buffer.alloc(0));

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(MAILBOX, Buffer.from([2, 9]));
  });

  it('says it went down, and connects again after backing off', async () => {
    vi.useFakeTimers();
    const relay = new MemoryRelay();
    const onDown = vi.fn();
    const linked = link(relay, vi.fn(), onDown);
    linked.start();
    await Promise.resolve();
    relay.drop();

    expect(onDown).toHaveBeenCalledTimes(1);
    expect(linked.isUp()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(relay.opened).toBe(2);
    linked.stop();
  });
});

describe('the reconnect jitter', () => {
  it('waits between half and all of the backoff, so a drained relay is not hit all at once', () => {
    expect(jitteredRetryMs(8_000, () => 0)).toBe(4_000);
    expect(jitteredRetryMs(8_000, () => 0.5)).toBe(6_000);
    expect(jitteredRetryMs(8_000, () => 0.999)).toBeLessThanOrEqual(8_000);
  });
});

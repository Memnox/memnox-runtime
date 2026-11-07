import { describe, expect, it } from 'vitest';
import { FeedGate } from '../src/daemon/feed-gate';

describe('reading what waits on a person only when something moved', () => {
  it('reads at once, then again only when a folder moved, somebody started listening, or the clock came round', async () => {
    let time = 1;
    const gate = new FeedGate('/home', 3_000, () => Promise.resolve(time));
    expect(await gate.due(0, 1)).toBe(true);
    expect(await gate.due(500, 1)).toBe(false);
    time = 2;
    expect(await gate.due(1_000, 1)).toBe(true);
    expect(await gate.due(1_500, 2)).toBe(true);
    expect(await gate.due(2_000, 2)).toBe(false);
    expect(await gate.due(4_500, 2)).toBe(true);
  });
});

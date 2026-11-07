import { describe, expect, it } from 'vitest';
import { CACHE_LIFE_MS, priceOf, sessionCostOf, type UsageTurn } from '../src/index';

/**
 * The cold cache count: a turn after a gap past the cache's life that wrote its context again is
 * a reload, priced from the named table, and a model the table lacks is said rather than guessed.
 */

const MINUTE = 60 * 1_000;

function turn(at: number, overrides: Partial<UsageTurn> = {}): UsageTurn {
  return {
    session: 's1',
    at,
    model: 'claude-opus-5-5',
    cacheWrite: 1_000,
    cacheRead: 100_000,
    ...overrides,
  };
}

describe('the session cost', () => {
  it('prices a model by the longest prefix it starts with and knows when it cannot', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({
      model: 'claude-opus-5-5',
      input: 4,
      cacheWrite: 5,
      cacheRead: 0.2,
    });
    expect(priceOf('claude-opus-5')?.input).toBe(5);
    expect(priceOf('claude-sonnet-5-5-20261001')?.model).toBe('claude-sonnet-5-5');
    expect(priceOf('gpt-5')).toBeNull();
  });

  it('counts a reload after a gap and the net saving of keeping it warm', () => {
    const cold = turn(30 * MINUTE, { cacheWrite: 1_000_000, cacheRead: 0 });
    const view = sessionCostOf([turn(0), turn(MINUTE), cold, turn(31 * MINUTE)]);
    expect(view).toMatchObject({
      days: 30,
      sessions: 1,
      turns: 4,
      coldReloads: 1,
      reloadedTokens: 1_000_000,
      reloadCostUsd: 5,
      warmHours: 4,
      unpricedModels: [],
    });
    const pings = Math.floor((29 * MINUTE) / CACHE_LIFE_MS);
    expect(view.warmSavingUsd).toBeCloseTo(5 - 0.2 * (1 + pings), 2);
  });

  it('leaves a gap past the warm window out of the saving and a turn that read its cache out of the reloads', () => {
    const view = sessionCostOf([
      turn(0),
      turn(5 * 60 * MINUTE, { cacheWrite: 1_000_000, cacheRead: 0 }),
      turn(5 * 60 * MINUTE + 10 * MINUTE),
    ]);
    expect(view.coldReloads).toBe(1);
    expect(view.warmSavingUsd).toBe(0);
  });

  it('says which models it could not price and gives no total that would leave them out', () => {
    const view = sessionCostOf([
      turn(0, { model: 'mystery-1' }),
      turn(20 * MINUTE, { model: 'mystery-1', cacheWrite: 5_000, cacheRead: 0 }),
    ]);
    expect(view.coldReloads).toBe(1);
    expect(view.unpricedModels).toEqual(['mystery-1']);
    expect(view.reloadCostUsd).toBeUndefined();
    expect(view.warmSavingUsd).toBeUndefined();
  });
});

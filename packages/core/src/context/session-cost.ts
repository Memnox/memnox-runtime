import type { ModelPriceView, SessionCostView } from '../daemon/memory-layers';

/**
 * What a cold prompt cache cost over the chats lately, from the token counts each turn already
 * reports: a turn that wrote its context into the cache again after a gap past the cache's life
 * is a cold reload, and keeping the chat warm would have read it instead. Only counted, never pinged.
 */

/** How long the prompt cache lives without a read, which is the gap a turn finds it cold after. */
export const CACHE_LIFE_MS = 5 * 60 * 1_000;
/** The window a chat would be kept warm for; a gap longer than this would be cold anyway. */
export const WARM_HOURS = 4;
/** The days of chats read. */
export const SESSION_COST_DAYS = 30;
const HOUR_MS = 60 * 60 * 1_000;
const PER_MILLION = 1_000_000;
/** A five minute cache write costs this many times the input price. */
const CACHE_WRITE_FACTOR = 1.25;

/**
 * Anthropic's first party API prices in US dollars per million input tokens and cache reads, as
 * published in October 2026. Matched by the longest prefix of the model id; a model not here is
 * named as unpriced rather than guessed, and these are list prices, not what any plan bills.
 */
const PRICES: readonly { prefix: string; input: number; cacheRead: number }[] = [
  { prefix: 'claude-fable-5-1', input: 10, cacheRead: 0.25 },
  { prefix: 'claude-mythos-5-1', input: 10, cacheRead: 0.25 },
  { prefix: 'claude-fable-5', input: 10, cacheRead: 1 },
  { prefix: 'claude-mythos-5', input: 10, cacheRead: 1 },
  { prefix: 'claude-opus-5-5', input: 4, cacheRead: 0.2 },
  { prefix: 'claude-opus-5', input: 5, cacheRead: 0.5 },
  { prefix: 'claude-opus-4-8', input: 5, cacheRead: 0.5 },
  { prefix: 'claude-opus-4-7', input: 5, cacheRead: 0.5 },
  { prefix: 'claude-opus-4-6', input: 5, cacheRead: 0.5 },
  { prefix: 'claude-sonnet-5-5', input: 2, cacheRead: 0.2 },
  { prefix: 'claude-sonnet-5', input: 2, cacheRead: 0.2 },
  { prefix: 'claude-sonnet-4-6', input: 3, cacheRead: 0.3 },
  { prefix: 'claude-haiku-5-5', input: 0.1, cacheRead: 0.01 },
  { prefix: 'claude-haiku-4-5', input: 1, cacheRead: 0.1 },
];

/** One assistant turn as a transcript reports its usage. */
export interface UsageTurn {
  session: string;
  /** Epoch milliseconds. */
  at: number;
  model: string;
  cacheWrite: number;
  cacheRead: number;
}

export function priceOf(model: string): ModelPriceView | null {
  const found = [...PRICES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((each) => model.startsWith(each.prefix));
  if (found === undefined) return null;
  return {
    model: found.prefix,
    input: found.input,
    cacheWrite: found.input * CACHE_WRITE_FACTOR,
    cacheRead: found.cacheRead,
  };
}

/** A turn after a gap past the cache's life that wrote more than it read: its context went cold. */
function coldGap(turn: UsageTurn, previous: UsageTurn | undefined): number | null {
  if (previous === undefined) return null;
  const gap = turn.at - previous.at;
  if (gap <= CACHE_LIFE_MS || turn.cacheWrite <= turn.cacheRead) return null;
  return gap;
}

interface Tally {
  coldReloads: number;
  reloadedTokens: number;
  reloadCost: number;
  saving: number;
  unpriced: Set<string>;
}

/** What one cold reload cost, and what keeping it warm would have saved net of a read every cache life. */
function count(tally: Tally, turn: UsageTurn, gap: number): void {
  tally.coldReloads += 1;
  tally.reloadedTokens += turn.cacheWrite;
  const price = priceOf(turn.model);
  if (price === null) {
    tally.unpriced.add(turn.model);
    return;
  }
  const millions = turn.cacheWrite / PER_MILLION;
  tally.reloadCost += millions * price.cacheWrite;
  if (gap > WARM_HOURS * HOUR_MS) return;
  const pings = Math.floor(gap / CACHE_LIFE_MS);
  tally.saving += millions * (price.cacheWrite - price.cacheRead * (1 + pings));
}

/** The view over every turn read, each session's turns taken in time order. */
export function sessionCostOf(turns: readonly UsageTurn[]): SessionCostView {
  const tally: Tally = {
    coldReloads: 0,
    reloadedTokens: 0,
    reloadCost: 0,
    saving: 0,
    unpriced: new Set(),
  };
  const sessions = new Map<string, UsageTurn[]>();
  for (const turn of turns)
    sessions.set(turn.session, [...(sessions.get(turn.session) ?? []), turn]);
  for (const own of sessions.values()) {
    const sorted = [...own].sort((a, b) => a.at - b.at);
    sorted.forEach((turn, index) => {
      const gap = coldGap(turn, sorted[index - 1]);
      if (gap !== null) count(tally, turn, gap);
    });
  }
  return viewOf(tally, { sessions: sessions.size, turns: turns.length, models: turns });
}

function viewOf(
  tally: Tally,
  seen: { sessions: number; turns: number; models: readonly UsageTurn[] },
): SessionCostView {
  const priced = tally.unpriced.size === 0;
  const prices = [...new Set(seen.models.map((turn) => turn.model))].flatMap((model) => {
    const price = priceOf(model);
    return price === null ? [] : [price];
  });
  return {
    days: SESSION_COST_DAYS,
    sessions: seen.sessions,
    turns: seen.turns,
    coldReloads: tally.coldReloads,
    reloadedTokens: tally.reloadedTokens,
    ...(priced ? { reloadCostUsd: cents(tally.reloadCost) } : {}),
    ...(priced ? { warmSavingUsd: cents(tally.saving) } : {}),
    warmHours: WARM_HOURS,
    unpricedModels: [...tally.unpriced].sort(),
    prices: [...new Map(prices.map((price) => [price.model, price])).values()],
  };
}

function cents(usd: number): number {
  return Math.round(usd * 100) / 100;
}

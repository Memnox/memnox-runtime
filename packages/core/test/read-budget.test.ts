import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  budgetOf,
  DEFAULT_READ_BUDGET_TOKENS,
  estimateTokens,
  fitLines,
  fitObject,
  lineCursorAt,
  measureRead,
  MOST_READ_BUDGET_TOKENS,
  noteRead,
  oneMemoryLine,
  readLineCursor,
  readRange,
  readReadTokens,
  type RankedLine,
} from '../src/index';

/** Twenty lines of forty characters, ten tokens each by the estimate. */
const RANKED: RankedLine[] = Array.from({ length: 20 }, (_, at) => ({
  id: `fact:f${at}`,
  line: `${String(at).padStart(2, '0')} ${'x'.repeat(37)}`,
}));

describe('the token estimate and the budget', () => {
  it('counts four characters a token, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('defaults a missing or nonsense budget and holds an asked one inside the bounds', () => {
    expect(budgetOf(undefined)).toBe(DEFAULT_READ_BUDGET_TOKENS);
    expect(budgetOf('soon')).toBe(DEFAULT_READ_BUDGET_TOKENS);
    expect(budgetOf('300')).toBe(300);
    expect(budgetOf(1)).toBe(100);
    expect(budgetOf(1e9)).toBe(MOST_READ_BUDGET_TOKENS);
  });

  it('says one memory on one line with its id and origin', () => {
    expect(
      oneMemoryLine('Retries  run\nnightly.', 'f1', 'a decision, on 2026-05-02'),
    ).toBe('Retries run nightly. [f1; a decision, on 2026-05-02]');
  });
});

describe('a ranked read cut to its budget', () => {
  it('says the best lines that fit and a cursor for the rest', () => {
    const page = fitLines(RANKED, 100);
    expect(page.lines.map((each) => each.id)).toEqual(
      RANKED.slice(0, 10).map((each) => each.id),
    );
    expect(page.tokens).toBeLessThanOrEqual(100);
    expect(page).toMatchObject({ more: 10, next: lineCursorAt(10) });
  });

  it('reads on from a cursor to the end, where it gives none', () => {
    const from = readLineCursor(fitLines(RANKED, 100).next);
    expect(from).toBe(10);
    const rest = fitLines(RANKED, 1_000, { from: from ?? 0 });
    expect(rest.lines).toHaveLength(10);
    expect(rest.next).toBeUndefined();
    expect(rest.more).toBe(0);
  });

  it('refuses a cursor it did not write', () => {
    expect(readLineCursor('2026-01-01|abc')).toBeNull();
    expect(readLineCursor(undefined)).toBeNull();
  });

  it('counts what the session was already shown rather than saying it again', () => {
    const shown = new Set(['fact:f0', 'fact:f1', 'fact:f2']);
    const page = fitLines(RANKED, 30, { shown });
    expect(page.alreadyShown).toBe(3);
    expect(page.lines.map((each) => each.id)).toEqual(['fact:f3', 'fact:f4', 'fact:f5']);
    expect(page.more).toBe(14);
  });

  it('always says one line, so a tiny budget still moves forward', () => {
    expect(fitLines(RANKED, 1).lines).toHaveLength(1);
  });
});

describe('a document read by range', () => {
  const DOC = [
    '# Billing',
    'intro',
    '## Retries',
    'retry one',
    'retry two',
    '## Refunds',
    'refund one',
    '# Other',
  ].join('\n');

  it('reads the section under a heading, to the next heading as high', () => {
    expect(readRange(DOC, { heading: 'retries' }, 800)).toMatchObject({
      text: '## Retries\nretry one\nretry two',
      from: 3,
      to: 5,
      total: 8,
    });
    expect(readRange(DOC, { heading: 'Billing' }, 800)?.to).toBe(7);
  });

  it('reads lines counted from one, open ended or alone', () => {
    expect(readRange(DOC, { lines: '4-5' }, 800)?.text).toBe('retry one\nretry two');
    expect(readRange(DOC, { lines: '7-' }, 800)?.text).toBe('refund one\n# Other');
    expect(readRange(DOC, { lines: '2' }, 800)?.text).toBe('intro');
  });

  it('names nothing for a range outside the document', () => {
    expect(readRange(DOC, { lines: '40-50' }, 800)).toBeNull();
    expect(readRange(DOC, { heading: 'shipping' }, 800)).toBeNull();
    expect(readRange(DOC, { lines: 'all of it' }, 800)).toBeNull();
  });

  it('stops at the budget on a line boundary and gives the range to ask for next', () => {
    const long = Array.from(
      { length: 100 },
      (_, at) => `line ${at + 1} ${'y'.repeat(30)}`,
    );
    const part = readRange(long.join('\n'), {}, 100);
    expect(part?.from).toBe(1);
    expect(part?.tokens).toBeLessThanOrEqual(100);
    expect(part?.next).toBe(`${(part?.to ?? 0) + 1}-100`);
    expect(part?.text.split('\n').at(-1)).toBe(long[(part?.to ?? 1) - 1]);
  });
});

describe('an answer of unknown shape kept under the budget', () => {
  it('cuts the longest lists and says by how many', () => {
    const big = {
      from: 'the workspace',
      decisions: Array.from({ length: 50 }, (_, at) => ({ statement: `decision ${at}` })),
      holders: [{ agent: 'codex' }],
    };
    const { value, cut } = fitObject(big, 150);
    expect(estimateTokens(JSON.stringify(value))).toBeLessThanOrEqual(150);
    expect(value['holders']).toEqual([{ agent: 'codex' }]);
    expect(cut['decisions']).toBeGreaterThan(0);
    expect(fitObject(big, 8_000).cut).toEqual({});
  });
});

describe('the read measurement', () => {
  it('counts what was handed and what the whole would have cost, never below nothing', () => {
    expect(
      measureRead({ tool: 'memory', returnedText: 'abcd', fullText: 'a'.repeat(40) }),
    ).toEqual({ reads: 1, returned: 1, avoided: 9 });
    expect(
      measureRead({ tool: 'memory', returnedText: 'a'.repeat(40), fullText: 'ab' })
        .avoided,
    ).toBe(0);
  });

  it('keeps running totals by tool name and nothing of what was read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-read-tokens-'));
    expect(await readReadTokens(home)).toEqual({
      reads: 0,
      returned: 0,
      avoided: 0,
      tools: {},
    });
    await noteRead(home, {
      tool: 'memory',
      returnedText: 'secret words',
      fullText: 'secret words'.repeat(10),
    });
    await noteRead(home, { tool: 'brief', returnedText: 'ab', fullText: 'ab' });
    const ledger = await readReadTokens(home);
    expect(ledger).toMatchObject({ reads: 2, returned: 4, avoided: 27 });
    expect(ledger.tools['memory']).toEqual({ reads: 1, returned: 3, avoided: 27 });
    expect(JSON.stringify(ledger)).not.toContain('secret');
  });
});

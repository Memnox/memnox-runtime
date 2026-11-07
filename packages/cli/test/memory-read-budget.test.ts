import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateTokens, readReadTokens, writeWorkspaceMemory } from '@memnox/core';

import { readMemoryValue } from '../src/memory/search-times';
import { briefTool, memoryTool } from '../src/session-tools/memory-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

/**
 * A memory read costs an agent a budget, not a store: the best lines first with a cursor for the
 * rest, what this session already saw counted rather than resent, one memory read whole by id,
 * and every read measured as tokens handed against tokens spared, by name only.
 */

const NOW = new Date('2026-11-01T09:00:00.000Z');

function depsFor(home: string, session = 'ses_budget'): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: { MEMNOX_SESSION: session },
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

/** Forty payment facts, so a small budget cannot say them all. */
async function homeWithFacts(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-read-budget-'));
  await writeWorkspaceMemory(home, {
    hash: 'h1',
    withheld: 0,
    syncedAt: NOW.toISOString(),
    facts: Array.from({ length: 40 }, (_, at) => ({
      id: `f${at}`,
      kind: 'decision',
      statement: `Payment retries rule number ${at} keeps the PaymentService retry window bounded.`,
      subject: 'payments',
      verifiedBy: 'ada@acme.test',
      settledAt: `2026-05-${String((at % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      capability: 'retry',
    })),
  });
  return home;
}

interface Page {
  facts: string[];
  more?: number;
  next?: string;
  alreadyShown?: string;
}

async function ask(deps: SessionToolDeps, args: Record<string, unknown>): Promise<Page> {
  return (await memoryTool(deps, args)) as Page;
}

describe('a budgeted memory read', () => {
  it('answers inside the asked budget, one line a fact, with a cursor for the rest', async () => {
    const deps = depsFor(await homeWithFacts());
    const page = await ask(deps, { about: 'payment retries', budget: '200' });

    expect(estimateTokens(page.facts.join('\n'))).toBeLessThanOrEqual(200);
    expect(page.facts.length).toBeGreaterThan(0);
    expect(page.facts.length).toBeLessThan(40);
    expect(page.facts[0]).toMatch(
      /\[f\d+; a decision, confirmed by ada@acme\.test, on 2026-05-\d\d\]$/,
    );
    expect(page.more).toBe(40 - page.facts.length);
    expect(page.next).toMatch(/^m\d+$/);
  });

  it('defaults to a small budget when none is asked', async () => {
    const page = await ask(depsFor(await homeWithFacts()), { about: 'payments' });
    expect(estimateTokens(page.facts.join('\n'))).toBeLessThanOrEqual(800);
    expect(page.next).toBeDefined();
  });

  it('reads on from the cursor without repeating a line, to the end', async () => {
    const deps = depsFor(await homeWithFacts(), 'ses_paging');
    const said = new Set<string>();
    let next: string | undefined;
    for (let pages = 0; pages < 40; pages += 1) {
      const page = await ask(deps, {
        about: 'payment retries',
        budget: '200',
        ...(next === undefined ? {} : { cursor: next }),
      });
      for (const line of page.facts) {
        expect(said.has(line)).toBe(false);
        said.add(line);
      }
      next = page.next;
      if (next === undefined) break;
    }
    expect(said.size).toBe(40);
  });

  it('counts what this session was already shown instead of sending it again', async () => {
    const home = await homeWithFacts();
    const first = await ask(depsFor(home, 'ses_a'), { about: 'payments', budget: '200' });
    const again = await ask(depsFor(home, 'ses_a'), { about: 'payments', budget: '200' });

    expect(again.alreadyShown).toBe(`${first.facts.length} already shown this session`);
    expect(again.facts.some((line) => first.facts.includes(line))).toBe(false);

    const elsewhere = await ask(depsFor(home, 'ses_b'), {
      about: 'payments',
      budget: '200',
    });
    expect(elsewhere.facts).toEqual(first.facts);
    expect(elsewhere.alreadyShown).toBeUndefined();
  });

  it('reads one memory whole by the id its line ended with', async () => {
    const deps = depsFor(await homeWithFacts());
    const whole = (await memoryTool(deps, { id: 'f7' })) as {
      fact: Record<string, unknown>;
    };
    expect(whole.fact).toMatchObject({
      id: 'f7',
      statement: expect.stringContaining('number 7'),
      capability: 'retry',
      settled: expect.stringContaining('confirmed by ada@acme.test'),
    });
    expect(await memoryTool(deps, { id: 'nope' })).toMatchObject({
      said: expect.stringContaining('has that id'),
    });
  });
});

describe('a budgeted brief', () => {
  it('cuts a large live brief to the budget and says how much it left out', async () => {
    const deps = {
      ...depsFor(await homeWithFacts()),
      brief: async () => ({
        decisions: Array.from({ length: 60 }, (_, at) => ({
          id: `d${at}`,
          statement: `Decision ${at} about the billing service and how it retries charges.`,
        })),
        holders: [{ agent: 'codex', path: 'src/billing' }],
      }),
    };
    const answer = (await briefTool(deps, { paths: 'src/billing', budget: '300' })) as {
      brief: { decisions: unknown[]; holders: unknown[] };
      cut: string;
    };

    expect(estimateTokens(JSON.stringify(answer.brief))).toBeLessThanOrEqual(300);
    expect(answer.brief.holders).toHaveLength(1);
    expect(answer.brief.decisions.length).toBeLessThan(60);
    expect(answer.cut).toContain('left out');
  });
});

describe('what a read spared, measured', () => {
  it('records tokens handed and avoided by tool name, and the Memory page reads them', async () => {
    const home = await homeWithFacts();
    expect((await readMemoryValue(home)).contextTokensSaved).toBeUndefined();

    await ask(depsFor(home), { about: 'payment retries', budget: '200' });
    const ledger = await readReadTokens(home);

    expect(ledger.tools['memory']?.reads).toBe(1);
    expect(ledger.returned).toBeGreaterThan(0);
    expect(ledger.avoided).toBeGreaterThan(ledger.returned);
    expect(JSON.stringify(ledger)).not.toContain('PaymentService');
    expect((await readMemoryValue(home)).contextTokensSaved).toBe(ledger.avoided);
  });
});

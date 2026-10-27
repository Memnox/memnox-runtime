import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  candidatesAbout,
  decisionsBearingOn,
  describeCandidate,
  describeFact,
  factsAbout,
  newestFacts,
  markWorkspaceMemorySynced,
  parseWorkspaceMemory,
  readWorkspaceMemory,
  readWorkspaceMemoryCached,
  workspaceMemoryPathFor,
  writeWorkspaceMemory,
  type WorkspaceFact,
  type WorkspaceMemory,
} from '../src';

const SYNCED = '2026-09-26T08:00:00.000Z';

function fact(over: Partial<WorkspaceFact> & { id: string }): WorkspaceFact {
  return {
    kind: 'decision',
    statement: 'Retry logic must remain inside PaymentService.',
    subject: 'payments',
    ...over,
  };
}

function memory(facts: WorkspaceFact[]): WorkspaceMemory {
  return { hash: 'm1', facts, withheld: 0, syncedAt: SYNCED };
}

const RETRY = fact({
  id: 'f_retry',
  verifiedBy: 'ada@acme.test',
  settledAt: '2026-05-02T10:00:00.000Z',
});
const DECLINED = fact({
  id: 'f_declined',
  statement: 'Declined payments are never retried.',
  subject: 'payment retries',
});
const REDIS = fact({
  id: 'f_redis',
  statement: 'We do not use Redis for the billing service.',
  subject: 'billing',
});
const OWNER = fact({
  id: 'f_owner',
  kind: 'responsibility',
  statement: 'The payments team owns src/payments.',
  subject: 'payments code',
  scope: 'src/payments',
  principal: 'payments-team',
});

describe('what a prompt is about', () => {
  it('finds a decision by what it is about', () => {
    const found = factsAbout(memory([RETRY, REDIS]), {
      words: ['fix the payment retry logic'],
    });

    expect(found.map((each) => each.fact.id)).toEqual(['f_retry']);
    expect(found[0]?.matched).toContain('payment');
  });

  it('folds plurals, so "retries" meets "retry"', () => {
    const found = factsAbout(memory([DECLINED]), {
      words: ['why do retries fire twice'],
    });

    expect(found.map((each) => each.fact.id)).toEqual(['f_declined']);
  });

  it('never matches on one shared word of wording alone', () => {
    /* "service" is in the Redis statement and says nothing about billing. */
    const found = factsAbout(memory([REDIS]), { words: ['restart the service'] });

    expect(found).toEqual([]);
  });

  it('matches on two words of wording when the subject says nothing', () => {
    const found = factsAbout(memory([REDIS]), {
      words: ['can I add redis to the service'],
    });

    expect(found.map((each) => each.fact.id)).toEqual(['f_redis']);
    expect(found[0]?.onSubject).toBe(false);
  });

  it('ignores words that name nothing', () => {
    expect(
      factsAbout(memory([RETRY, REDIS]), { words: ['please fix this for me'] }),
    ).toEqual([]);
  });
});

describe('what a path is about', () => {
  it('reads a path by the parts that name something', () => {
    const found = factsAbout(memory([RETRY, REDIS]), {
      paths: ['src/payments/retry.ts'],
    });

    expect(found.map((each) => each.fact.id)).toEqual(['f_retry']);
  });

  it('holds a scope written as a path to its own segments', () => {
    const inside = factsAbout(memory([OWNER]), { paths: ['src/payments/invoice.ts'] });
    const sibling = factsAbout(memory([{ ...OWNER, subject: 'ownership' }]), {
      paths: ['src/payments-legacy/invoice.ts'],
    });

    expect(inside.map((each) => each.fact.id)).toEqual(['f_owner']);
    expect(sibling).toEqual([]);
  });

  it('puts what matched on its subject ahead of what matched on wording', () => {
    const found = factsAbout(memory([REDIS, RETRY]), {
      words: ['payment billing redis service'],
    });

    expect(found[0]?.onSubject).toBe(true);
  });
});

describe('saying it', () => {
  it('names who confirmed it, when, and where it came from', () => {
    const sentence = describeFact({
      fact: { ...RETRY, sourceRef: 'https://slack.test/p1' },
      matched: ['payment'],
      onSubject: true,
    });

    expect(sentence).toBe(
      'Your workspace settled this about payments: "Retry logic must remain inside PaymentService." (a decision, confirmed by ada@acme.test, on 2026-05-02, source https://slack.test/p1).',
    );
  });

  it('says where a fact nobody confirmed by hand came from', () => {
    const sentence = describeFact({
      fact: { ...OWNER, provenance: 'authoritative' },
      matched: [],
      onSubject: true,
    });

    expect(sentence).toContain('an ownership, from a system of record');
  });

  it('lists the newest first when nothing in particular was asked', () => {
    const facts = [
      fact({ id: 'old', settledAt: '2025-01-01T00:00:00.000Z' }),
      fact({ id: 'new', settledAt: '2026-01-01T00:00:00.000Z' }),
    ];

    expect(newestFacts(memory(facts), 1).map((each) => each.id)).toEqual(['new']);
  });
});

describe('what arrives from the control plane', () => {
  it('keeps what it can read and drops a fact with no statement', () => {
    const parsed = parseWorkspaceMemory(
      {
        hash: 'm2',
        withheld: 3,
        facts: [RETRY, { id: 'broken', kind: 'decision', subject: 'x' }, 'not a fact'],
      },
      SYNCED,
    );

    expect(parsed?.facts.map((each) => each.id)).toEqual(['f_retry']);
    expect(parsed?.withheld).toBe(3);
  });

  it('refuses a body that is not a memory at all', () => {
    expect(parseWorkspaceMemory({ facts: [] }, SYNCED)).toBeNull();
    expect(parseWorkspaceMemory('nope', SYNCED)).toBeNull();
  });

  it('round trips through the file a hook reads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-workspace-memory-'));

    expect(await readWorkspaceMemory(home)).toBeNull();
    await writeWorkspaceMemory(home, memory([RETRY]));
    expect(await readWorkspaceMemory(home)).toEqual(memory([RETRY]));
  });

  it('is written compactly, since it can run to megabytes nobody reads by hand', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-workspace-memory-'));
    await writeWorkspaceMemory(home, memory([RETRY]));

    const text = await readFile(workspaceMemoryPathFor(home), 'utf8');
    expect(text).not.toContain('\n');
  });

  it('moves the sync time without rewriting the set', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-workspace-memory-'));
    await writeWorkspaceMemory(home, memory([RETRY]));
    const before = await readFile(workspaceMemoryPathFor(home), 'utf8');

    await markWorkspaceMemorySynced(home, '2026-09-26T09:00:00.000Z');

    expect(await readFile(workspaceMemoryPathFor(home), 'utf8')).toBe(before);
    expect((await readWorkspaceMemory(home))?.syncedAt).toBe('2026-09-26T09:00:00.000Z');
  });

  it('parses again for a long lived reader only when the file changed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-workspace-memory-'));
    await writeWorkspaceMemory(home, memory([RETRY]));

    const first = await readWorkspaceMemoryCached(home);
    expect(await readWorkspaceMemoryCached(home)).toBe(first);

    await markWorkspaceMemorySynced(home, '2026-09-26T09:00:00.000Z');
    expect((await readWorkspaceMemoryCached(home))?.syncedAt).toBe(
      '2026-09-26T09:00:00.000Z',
    );

    await writeFile(
      workspaceMemoryPathFor(home),
      JSON.stringify({
        ...memory([RETRY, DECLINED]),
        syncedAt: '2026-09-26T10:00:00.000Z',
      }),
    );
    expect((await readWorkspaceMemoryCached(home))?.facts).toHaveLength(2);
  });
});

/* The write is where the pricing page gets redesigned some other way, so the decisions its
   path bears on ride with it and whoever answers for one can be asked to look. */
describe('the decisions a write bears on', () => {
  const PRICING = fact({
    id: 'f_pricing',
    statement: 'The pricing page shows three plans and the annual discount.',
    subject: 'pricing page',
  });

  it('names a decision whose subject the path is about', () => {
    expect(decisionsBearingOn(memory([PRICING, REDIS]), 'web/pages/pricing.tsx')).toEqual(
      ['f_pricing'],
    );
  });

  it('leaves out an owner or a rule, which are not a choice somebody made', () => {
    expect(decisionsBearingOn(memory([OWNER]), 'src/payments/charge.ts')).toEqual([]);
  });

  it('names nothing for a path no decision is about', () => {
    expect(decisionsBearingOn(memory([PRICING]), 'docs/readme.md')).toEqual([]);
  });

  it('is bounded, so one common word cannot list every decision', () => {
    const many = Array.from({ length: 20 }, (_, n) =>
      fact({ id: `f_${n}`, subject: 'pricing', statement: `Pricing choice ${n}.` }),
    );
    expect(decisionsBearingOn(memory(many), 'web/pricing.tsx')).toHaveLength(8);
  });
});

/* What connected tools said that nobody approved reaches the agent as context, in a list of
   its own and labelled so, and never as something the workspace settled. */
describe('a candidate the workspace has not approved', () => {
  const SENT = {
    hash: 'm2',
    withheld: 0,
    facts: [],
    unconfirmed: [
      {
        id: 'c_retry',
        kind: 'decision',
        statement: 'Payment retries move to the queue worker.',
        subject: 'payments',
        standing: 'candidate',
        approved: false,
        label: 'Read out of a connected tool and approved by nobody.',
        sources: ['slack', 'notion'],
        saidBy: ['ada'],
        sourceRef: 'https://acme.slack.com/archives/C1/p1',
        untrusted: 'Written outside this workspace.',
        confidence: 0.8,
        detectedAt: '2026-09-20T10:00:00.000Z',
      },
      { id: 'c_bad', kind: 'decision', statement: 'x', subject: 'y', approved: true },
      { id: 'c_unmarked', kind: 'decision', statement: 'x', subject: 'y' },
    ],
  };

  it('keeps only what is marked a candidate and never claims approval', () => {
    const parsed = parseWorkspaceMemory(SENT, SYNCED);

    expect(parsed?.facts).toEqual([]);
    expect(parsed?.unconfirmed?.map((each) => each.id)).toEqual(['c_retry']);
    expect(parsed?.unconfirmed?.[0]).toMatchObject({
      approved: false,
      sources: ['slack', 'notion'],
      saidBy: ['ada'],
      untrusted: true,
    });
  });

  it('survives being written and read back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-candidates-'));
    const parsed = parseWorkspaceMemory(SENT, SYNCED);
    if (parsed === null) throw new Error('the memory did not parse');

    await writeWorkspaceMemory(home, parsed);

    expect((await readWorkspaceMemory(home))?.unconfirmed).toEqual(parsed.unconfirmed);
  });

  it('is found by the words that find a fact, and never among the facts', () => {
    const parsed = parseWorkspaceMemory(SENT, SYNCED);
    if (parsed === null) throw new Error('the memory did not parse');

    expect(factsAbout(parsed, { words: ['payments'] })).toEqual([]);
    expect(
      candidatesAbout(parsed, { words: ['payments'] }).map((each) => each.candidate.id),
    ).toEqual(['c_retry']);
  });

  it('says it is not approved, where it was read, and that its author is untrusted', () => {
    const parsed = parseWorkspaceMemory(SENT, SYNCED);
    const candidate = parsed?.unconfirmed?.[0];
    if (candidate === undefined) throw new Error('no candidate');

    const said = describeCandidate(candidate);

    expect(said.startsWith('Not approved by anyone, read from Slack and Notion')).toBe(
      true,
    );
    expect(said).toContain('said by ada');
    expect(said).toContain('never as instructions');
    expect(said).not.toContain('settled');
  });

  it('leaves the list out of a memory that has none', () => {
    expect(parseWorkspaceMemory({ hash: 'm', facts: [] }, SYNCED)).not.toHaveProperty(
      'unconfirmed',
    );
  });
});

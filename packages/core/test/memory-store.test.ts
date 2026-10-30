import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  dropOldRecords,
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_SOURCE_KIND,
  MEMORY_STATUS,
  SOURCE_TRUST,
  SqliteMemoryStore,
  disagrees,
  evidenceRef,
  restates,
  statementKey,
  type MemoryItem,
  type NewMemoryItem,
} from '../src/index';

/**
 * The local memory store: candidates with their evidence, keyword search, rejections that are
 * remembered, passages that change and leave what they taught outdated, and the retention pass.
 */

const AT = '2026-10-30T09:00:00.000Z';
const LATER = '2026-12-30T09:00:00.000Z';

async function store(): Promise<{ home: string; store: SqliteMemoryStore }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-memory-'));
  return { home, store: SqliteMemoryStore.forHome(home) };
}

function candidate(
  statement: string,
  overrides: Partial<NewMemoryItem> = {},
): NewMemoryItem {
  return {
    kind: MEMORY_KIND.FACT,
    statement,
    subject: 'deploys',
    scope: MEMORY_SCOPE.PERSONAL,
    origin: MEMORY_ORIGIN.EXTRACTED,
    sourceId: 'src_vault',
    tainted: false,
    confidence: 0.8,
    evidence: [
      { sourceId: 'src_vault', document: 'ops.md', heading: 'Releases', digest: 'd1' },
    ],
    ...overrides,
  };
}

function added(outcome: ReturnType<SqliteMemoryStore['add']>): MemoryItem {
  if (!('added' in outcome)) throw new Error('expected a new item');
  return outcome.added;
}

describe('the local memory store', () => {
  it('keeps a candidate with its evidence and finds it by keyword', async () => {
    const { store: memory } = await store();
    const item = added(memory.add(candidate('We never deploy on Fridays.'), AT));
    expect(item.status).toBe(MEMORY_STATUS.CANDIDATE);
    expect(memory.item(item.id)?.evidence[0]).toMatchObject({
      document: 'ops.md',
      stale: false,
    });
    expect(memory.search('friday deploy').map((each) => each.id)).toEqual([item.id]);
    expect(memory.search('kubernetes')).toEqual([]);
  });

  it('merges the same words into one item and marks a close restatement as a duplicate', async () => {
    const { store: memory } = await store();
    const first = added(memory.add(candidate('We never deploy on Fridays.'), AT));
    const again = memory.add(
      candidate('We never deploy on Fridays.', {
        evidence: [{ sourceId: 'src_vault', document: 'team.md', digest: 'd2' }],
      }),
      AT,
    );
    expect(again).toEqual({ merged: first.id });
    expect(memory.item(first.id)?.evidence).toHaveLength(2);
    const close = added(memory.add(candidate('We never deploy on any Friday.'), AT));
    expect(close.duplicateOf).toBe(first.id);
  });

  it('remembers a rejection, so the same words are never proposed again', async () => {
    const { store: memory } = await store();
    const item = added(memory.add(candidate('Use tabs.'), AT));
    memory.reject(item.id, { by: 'person', at: AT });
    expect(memory.item(item.id)?.status).toBe(MEMORY_STATUS.REJECTED);
    expect(memory.add(candidate('use  TABS'), AT)).toEqual({ rejectedBefore: true });
  });

  it('marks what a changed passage taught outdated, and what a removed source taught too', async () => {
    const { store: memory } = await store();
    memory.putDocument('src_vault', 'ops.md', 's1', ['d1']);
    const item = added(memory.add(candidate('We never deploy on Fridays.'), AT));
    memory.decide(item.id, MEMORY_STATUS.VERIFIED, { by: 'person', at: AT });
    expect(memory.refreshStaleness('src_vault', AT)).toBe(0);
    memory.putDocument('src_vault', 'ops.md', 's2', ['d9']);
    expect(memory.refreshStaleness('src_vault', LATER)).toBe(1);
    expect(memory.item(item.id)?.status).toBe(MEMORY_STATUS.OUTDATED);

    const other = added(
      memory.add(
        candidate('Releases are cut from main.', {
          evidence: [{ sourceId: 'src_notes', document: 'a.md', digest: 'x' }],
        }),
        AT,
      ),
    );
    memory.putDocument('src_notes', 'a.md', 's', ['x']);
    expect(memory.removeSource('src_notes', LATER)).toBe(1);
    expect(memory.item(other.id)?.status).toBe(MEMORY_STATUS.OUTDATED);
  });

  it('flags two confirmed facts that say opposite things as conflicting', async () => {
    const { store: memory } = await store();
    const yes = added(memory.add(candidate('We deploy on Fridays after review.'), AT));
    const no = added(
      memory.add(candidate('We never deploy on Fridays after review.'), AT),
    );
    memory.decide(yes.id, MEMORY_STATUS.VERIFIED, { by: 'person', at: AT });
    memory.decide(no.id, MEMORY_STATUS.VERIFIED, { by: 'person', at: AT });
    expect(memory.flagConflicts(no.id, AT)).toEqual([yes.id]);
    expect(memory.item(yes.id)?.status).toBe(MEMORY_STATUS.CONFLICTING);
    expect(memory.item(no.id)?.status).toBe(MEMORY_STATUS.CONFLICTING);
  });

  it('lists by status and scope, edits through a new key, and forgets', async () => {
    const { store: memory } = await store();
    const personal = added(
      memory.add(candidate('Use pnpm.', { subject: 'tooling' }), AT),
    );
    added(
      memory.add(
        candidate('Tests live beside the code.', {
          scope: MEMORY_SCOPE.PROJECT,
          project: '/repo',
          kind: MEMORY_KIND.CONVENTION,
        }),
        AT,
      ),
    );
    expect(memory.items({ scope: MEMORY_SCOPE.PROJECT })).toHaveLength(1);
    expect(memory.items({ statuses: [MEMORY_STATUS.CANDIDATE] })).toHaveLength(2);
    memory.edit(personal.id, { statement: 'Use pnpm, never npm.' });
    expect(memory.search('npm').map((each) => each.statement)).toEqual([
      'Use pnpm, never npm.',
    ]);
    expect(memory.forget(personal.id)).toBe(true);
    expect(memory.item(personal.id)).toBeNull();
  });

  it('keeps sources with their counts', async () => {
    const { store: memory } = await store();
    memory.putSource({
      id: 'src_vault',
      kind: MEMORY_SOURCE_KIND.OBSIDIAN,
      name: 'Vault',
      location: '/vault',
      trust: SOURCE_TRUST.TRUSTED,
      scope: MEMORY_SCOPE.PERSONAL,
      addedAt: AT,
    });
    added(memory.add(candidate('Use pnpm.'), AT));
    memory.markRead('src_vault', LATER);
    expect(memory.sources()[0]).toMatchObject({ name: 'Vault', lastReadAt: LATER });
    expect(memory.countsBySource().get('src_vault')).toEqual({ candidate: 1 });
  });

  it('drops what said its last word past the window in the retention pass', async () => {
    const { home, store: memory } = await store();
    const old = added(memory.add(candidate('Use tabs.'), AT));
    const kept = added(memory.add(candidate('Use pnpm.'), AT));
    memory.reject(old.id, { by: 'person', at: AT });
    memory.decide(kept.id, MEMORY_STATUS.VERIFIED, { by: 'person', at: AT });
    memory.close();
    const dropped = await dropOldRecords({ home, cutoff: LATER, now: LATER });
    expect(dropped['memory']).toBe(1);
    const reopened = SqliteMemoryStore.forHome(home);
    expect(reopened.item(old.id)).toBeNull();
    expect(reopened.item(kept.id)?.status).toBe(MEMORY_STATUS.VERIFIED);
    expect(reopened.isRejected(MEMORY_KIND.FACT, 'Use tabs.')).toBe(true);
  });
});

describe('the memory record rules', () => {
  it('reads opposites, restatements, keys and evidence refs', () => {
    const base: Omit<MemoryItem, 'id' | 'statement'> = {
      kind: MEMORY_KIND.FACT,
      subject: 'deploys',
      status: MEMORY_STATUS.VERIFIED,
      scope: MEMORY_SCOPE.PERSONAL,
      origin: MEMORY_ORIGIN.PERSON,
      tainted: false,
      createdAt: AT,
      evidence: [],
    };
    expect(
      disagrees(
        { ...base, id: 'a', statement: 'Deploy on Fridays.' },
        { ...base, id: 'b', statement: "Don't deploy on Fridays." },
      ),
    ).toBe(true);
    expect(restates('Run the tests first.', 'Run all the tests first.')).toBe(true);
    expect(statementKey('fact', 'Use  Tabs!')).toBe('fact:use tabs');
    expect(evidenceRef({ document: 'ops.md', heading: 'Releases' })).toBe(
      'ops.md#Releases',
    );
    expect(evidenceRef({ document: 'x', url: 'https://a.example/x' })).toBe(
      'https://a.example/x',
    );
    expect(DECISION_EFFECT.ASK).toBe('ask');
  });
});

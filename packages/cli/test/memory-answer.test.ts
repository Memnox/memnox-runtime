import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  MEMORY_SOURCE_KIND,
  PROPOSAL_ANSWER,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  RULE_SOURCE,
  SqliteMemoryStore,
  type DaemonRequest,
  type DaemonResponse,
  type SecretStore,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { isMemoryMethod, memoryAnswer } from '../src/daemon/memory-answer';
import { policiesAnswer } from '../src/daemon/policies-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { isScreenMethod } from '../src/daemon/home-status';
import { readSourceOnce } from '../src/memory/memory-reads';

/**
 * Memory on the daemon, end to end: a vault saying "never deploy on Fridays" read by a stand in
 * for the person's own agent CLI, the rule candidate in Learn with its evidence, confirmed into a
 * signed proposal, and the rule it became stopping a deploy and citing the note.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const NOTE = `# Operations

## Releases
We never deploy on Fridays.

## Tooling
We use pnpm for everything.
`;

/** What the person's agent CLI answers: the rule from passage 1, a fact from 2, and a citation of nothing. */
const ANSWER = JSON.stringify({
  candidates: [
    {
      kind: 'rule',
      statement: 'Never deploy on Fridays.',
      subject: 'deploys',
      confidence: 0.9,
      evidenceRefs: [1, 9],
      rule: {
        enforcement: 'deny',
        actions: ['*deploy*'],
        reason: 'Fridays are not for releases.',
      },
    },
    {
      kind: 'fact',
      statement: 'We use pnpm.',
      subject: 'tooling',
      confidence: 0.7,
      evidenceRefs: [2],
    },
  ],
});

const NO_SECRETS: SecretStore = {
  get: async () => undefined,
  set: async () => undefined,
  remove: async () => undefined,
};

interface Fixture {
  home: string;
  vault: string;
  prompts: string[];
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  confirm(subject: string | undefined): Promise<void>;
}

async function fixture(answer: string | null = ANSWER): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-memory-'));
  const vault = join(home, 'Vault');
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, 'ops.md'), NOTE);
  const prompts: string[] = [];
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  const deps = {
    now: NOW,
    secrets: NO_SECRETS,
    reach: { secret: async () => undefined, fetch },
    extract: async (prompt: string) => {
      prompts.push(prompt);
      return answer;
    },
  };
  let id = 0;
  return {
    home,
    vault,
    prompts,
    ask: (request) => {
      id += 1;
      return memoryAnswer(
        home,
        { id, method: DAEMON_METHOD.MEMORY_SOURCES, ...request } as DaemonRequest,
        deps,
      );
    },
    confirm: async (subject) => {
      if (subject === undefined) throw new Error('nothing was proposed');
      const message = confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED);
      const result = await confirmAnswer(home, {
        subject,
        answer: PROPOSAL_ANSWER.CONFIRMED,
        signature: sign('sha256', Buffer.from(message), privateKey).toString('base64'),
        at: NOW.toISOString(),
      });
      expect(result).toMatchObject({ ok: true });
    },
  };
}

/** The read an add starts runs in the background; the test waits for it to land. */
async function settled(home: string): Promise<void> {
  for (let tries = 0; tries < 100; tries += 1) {
    const store = SqliteMemoryStore.forHome(home);
    const read = store.sources().every((each) => each.lastReadAt !== undefined);
    store.close();
    if (read) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the first read never finished');
}

async function vaultAdded(at: Fixture): Promise<string> {
  const added = await at.ask({
    method: DAEMON_METHOD.MEMORY_SOURCE_ADD,
    memorySource: { kind: MEMORY_SOURCE_KIND.OBSIDIAN, location: at.vault },
  });
  expect(added.ok).toBe(true);
  await settled(at.home);
  const id = added.memorySources?.[0]?.id;
  if (id === undefined) throw new Error('no source');
  return id;
}

describe('the memory methods', () => {
  it('are screen methods, read under SEE from a phone and changed under ASK', () => {
    for (const method of [DAEMON_METHOD.MEMORY_LEARN, DAEMON_METHOD.MEMORY_FACTS]) {
      expect(isMemoryMethod(method)).toBe(true);
      expect(isScreenMethod(method)).toBe(true);
      expect(isVoiceMethod(method)).toBe(true);
    }
    expect(remoteCapabilityFor(DAEMON_METHOD.MEMORY_LEARN)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.MEMORY_CONFIRM)).toBe(REMOTE_CAPABILITY.ASK);
  });

  it('reads a vault into Learn with evidence, numbered passages and dropped citations counted', async () => {
    const at = await fixture();
    const id = await vaultAdded(at);
    expect(at.prompts[0]).toContain('[1] [obsidian | ops.md#Releases]');
    const learn = await at.ask({ method: DAEMON_METHOD.MEMORY_LEARN });
    const rule = learn.memoryLearn?.items.find((each) => each.kind === 'rule');
    expect(rule).toMatchObject({
      statement: 'Never deploy on Fridays.',
      status: 'candidate',
      tainted: false,
      extractorConfidence: 0.9,
      rule: { effect: 'deny', actions: ['*deploy*'] },
      evidence: [{ ref: 'ops.md#Releases', source: 'Vault', stale: false }],
    });
    const sources = await at.ask({ method: DAEMON_METHOD.MEMORY_SOURCES });
    expect(sources.memorySources?.[0]).toMatchObject({
      id,
      trust: 'trusted',
      watched: true,
      counts: { candidate: 2 },
    });
    const again = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_READ,
      memorySourceId: id,
    });
    expect(again.memoryRead).toMatchObject({
      documents: 0,
      passages: 0,
      extractor: 'idle',
    });
  });

  it('confirms a fact as verified, and a rule as a signed proposal that cites the note when it stops', async () => {
    const at = await fixture();
    await vaultAdded(at);
    const learn = await at.ask({ method: DAEMON_METHOD.MEMORY_LEARN });
    const fact = learn.memoryLearn?.items.find((each) => each.kind === 'fact');
    const rule = learn.memoryLearn?.items.find((each) => each.kind === 'rule');
    const confirmedFact = await at.ask({
      method: DAEMON_METHOD.MEMORY_CONFIRM,
      memoryItemId: fact?.id,
    });
    expect(confirmedFact.memoryItem?.status).toBe('verified');

    const proposed = await at.ask({
      method: DAEMON_METHOD.MEMORY_CONFIRM,
      memoryItemId: rule?.id,
    });
    expect(proposed.proposed).toMatch(/^prp_/);
    expect(proposed.memoryItem).toMatchObject({
      status: 'candidate',
      proposalId: proposed.proposed,
    });
    await at.confirm(proposed.proposed);

    const after = await at.ask({ method: DAEMON_METHOD.MEMORY_LEARN });
    expect(after.memoryLearn?.items).toEqual([]);
    const facts = await at.ask({ method: DAEMON_METHOD.MEMORY_FACTS });
    expect(facts.memoryFacts?.items.map((each) => each.statement).sort()).toEqual([
      'Never deploy on Fridays.',
      'We use pnpm.',
    ]);

    const deps = { now: NOW, env: {} };
    const rules = await policiesAnswer(
      at.home,
      { id: 1, method: DAEMON_METHOD.POLICY_RULES } as DaemonRequest,
      deps,
    );
    const learned = rules.policyRules?.rules.find(
      (each) => each.source === RULE_SOURCE.EXTRACTED,
    );
    expect(learned).toMatchObject({ evidenceRefs: ['ops.md#Releases'], editable: true });
    const verdict = await policiesAnswer(
      at.home,
      {
        id: 2,
        method: DAEMON_METHOD.RULE_TEST,
        ruleTest: { action: 'vercel.deploy' },
      } as DaemonRequest,
      deps,
    );
    expect(verdict.ruleVerdict).toMatchObject({ effect: 'deny' });
    expect(verdict.ruleVerdict?.reason).toContain('learned from ops.md#Releases');
  });

  it('remembers a rejection, edits through the draft, searches and forgets', async () => {
    const at = await fixture();
    const id = await vaultAdded(at);
    const learn = await at.ask({ method: DAEMON_METHOD.MEMORY_LEARN });
    const fact = learn.memoryLearn?.items.find((each) => each.kind === 'fact');
    const rule = learn.memoryLearn?.items.find((each) => each.kind === 'rule');
    await at.ask({ method: DAEMON_METHOD.MEMORY_REJECT, memoryItemId: fact?.id });
    const edited = await at.ask({
      method: DAEMON_METHOD.MEMORY_EDIT,
      memoryItemId: rule?.id,
      memoryEdit: { rule: { effect: 'ask', action: 'git.push', reason: 'Fridays.' } },
    });
    expect(edited.memoryItem?.rule).toMatchObject({
      effect: 'ask',
      actions: ['git.push'],
    });
    const refused = await at.ask({
      method: DAEMON_METHOD.MEMORY_EDIT,
      memoryItemId: rule?.id,
      memoryEdit: { rule: { effect: 'maybe', action: 'x', reason: '' } as never },
    });
    expect(refused.ok).toBe(false);

    await writeFile(join(at.vault, 'ops.md'), `${NOTE}\n## More\nNothing new.\n`);
    await at.ask({ method: DAEMON_METHOD.MEMORY_SOURCE_READ, memorySourceId: id });
    const again = await at.ask({ method: DAEMON_METHOD.MEMORY_LEARN });
    expect(again.memoryLearn?.items.map((each) => each.statement)).toEqual([
      'Never deploy on Fridays.',
    ]);

    const found = await at.ask({
      method: DAEMON_METHOD.MEMORY_SEARCH,
      memoryQuery: 'friday',
    });
    expect(found.memoryFacts?.items.map((each) => each.id)).toEqual([rule?.id]);
    expect(
      (await at.ask({ method: DAEMON_METHOD.MEMORY_FORGET, memoryItemId: rule?.id })).ok,
    ).toBe(true);
    const gone = await at.ask({
      method: DAEMON_METHOD.MEMORY_SEARCH,
      memoryQuery: 'friday',
    });
    expect(gone.memoryFacts?.items).toEqual([]);
  });

  it('marks what a deleted note taught outdated, and what a removed source taught too', async () => {
    const at = await fixture();
    const id = await vaultAdded(at);
    await rm(join(at.vault, 'ops.md'));
    const read = await readSourceOnce(at.home, id, {
      reach: { secret: async () => undefined, fetch },
      extract: async () => null,
      now: () => NOW,
    });
    expect(read.outdated).toBe(2);
    const facts = await at.ask({
      method: DAEMON_METHOD.MEMORY_FACTS,
      memoryStatus: 'outdated',
    });
    expect(facts.memoryFacts?.items).toHaveLength(2);
    const removed = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_REMOVE,
      memorySourceId: id,
    });
    expect(removed.memorySources).toEqual([]);
  });

  it('says the extractor was not there, and reads those passages next time', async () => {
    const at = await fixture(null);
    const id = await vaultAdded(at);
    const read = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_READ,
      memorySourceId: id,
    });
    expect(read.memoryRead).toMatchObject({
      extractor: 'unavailable',
      passages: 2,
      added: 0,
    });
  });

  it('refuses a source that is not there, a plain http API, and a project scope on a vault', async () => {
    const at = await fixture();
    const missing = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_ADD,
      memorySource: {
        kind: MEMORY_SOURCE_KIND.MARKDOWN,
        location: join(at.home, 'nowhere'),
      },
    });
    expect(missing.ok).toBe(false);
    const plain = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_ADD,
      memorySource: {
        kind: MEMORY_SOURCE_KIND.SUPERMEMORY,
        location: 'http://api.example',
      },
    });
    expect(plain.reason).toContain('https');
    const scoped = await at.ask({
      method: DAEMON_METHOD.MEMORY_SOURCE_ADD,
      memorySource: {
        kind: MEMORY_SOURCE_KIND.OBSIDIAN,
        location: at.vault,
        scope: 'project',
      },
    });
    expect(scoped.ok).toBe(false);
  });
});

import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  emptyHub,
  HUB_TRANSPORT,
  MEMORY_KIND,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  PERSONAL_SYNC_STATE,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  readSkillsHub,
  SKILL_SCOPE,
  SqliteMemoryStore,
  writePolicyDocumentFile,
  SYNC_KEEP,
  withServer,
  writeAccount,
  writeHub,
  type DaemonRequest,
  type DaemonResponse,
  type HubServer,
  type Policy,
  type SecretStore,
} from '@memnox/core';
import {
  applyPersonalSyncProposal,
  personalSyncAnswer,
} from '../src/daemon/personal-sync-answer';
import { skillsHubAnswer } from '../src/daemon/skills-hub-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import type { SyncDeps } from '../src/personal-sync/sync-run';
import { machinePolicyPath, writeMachineRules } from '../src/protect/machine-rules';
import { editableRules } from '../src/studio/rules-in-force';
import type { CloudResponse } from '../src/sync/client';
import type { CloudSend } from '../src/sync/personal-sync-cloud';

/**
 * Personal sync between two of one person's machines through a cloud that keeps only what the
 * real one keeps: the first machine makes the key, the second takes it only behind the fingerprint
 * both show, and what arrives is never wider than it would be by hand.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const PLAN_REFUSAL = 'Personal sync is not on the Free plan. Upgrade to unlock it.';

const LINEAR: HubServer = {
  name: 'linear',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: {},
  secrets: { LINEAR_TOKEN: 'linear-token' },
};

function rule(name: string, effect: 'deny' | 'allow'): Policy {
  return {
    name,
    match: { actions: ['git.push-force'] },
    decision: { effect, reason: 'it rewrites history' },
  };
}

interface Kept {
  kind: string;
  id: string;
  version: number;
  seq: number;
  keyId: string;
  ciphertext?: string;
  deleted?: boolean;
  updatedAt: string;
  updatedBy: string;
}

/** The cloud as far as personal sync goes: ciphertext and bookkeeping, last writer wins, losers kept. */
class FakeCloud {
  readonly items = new Map<string, Kept>();
  readonly keys = new Map<
    string,
    { publicKey: string; envelope?: string; keyId?: string; updatedAt: string }
  >();
  readonly conflicts: (Kept & { conflictId: string })[] = [];
  /** Machines the others do not see in a listing yet, as a replica a moment behind would not. */
  readonly unseen = new Set<string>();
  seq = 0;
  onPlan = true;
  private clock = 0;
  private together: { count: number; release: () => void; done: Promise<void> } | null =
    null;

  /** Holds every registration until this many machines registered, so they all register before any reads. */
  registerTogether(count: number): void {
    let release = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.together = { count, release, done };
  }

  sendAs(machineId: string): CloudSend {
    // Cast is safe: the fake answers every route with the body type its caller asked for.
    return (async (request) => {
      const answered = this.answer(machineId, request);
      const together = this.together;
      if (
        together !== null &&
        request.path.endsWith('/keys/mine') &&
        request.method === 'PUT'
      ) {
        if (this.keys.size >= together.count) together.release();
        await together.done;
      }
      return answered;
    }) as CloudSend;
  }

  /** Each change to a key row a moment after the last, as the cloud stamps them. */
  private tick(): string {
    this.clock += 1;
    return new Date(NOW.getTime() + this.clock * 1000).toISOString();
  }

  private answer(
    machine: string,
    request: { path: string; method?: string; body?: unknown },
  ): CloudResponse<unknown> {
    const route = request.path.replace(/^\/v1\/workspaces\/ws_1\/personal-sync/, '');
    const method = request.method ?? 'GET';
    const paid = method === 'PUT' && (route === '/items' || route.startsWith('/keys'));
    if (paid && !this.onPlan)
      return {
        status: 403,
        body: { statusCode: 403, message: PLAN_REFUSAL, error: 'Forbidden' },
      };
    if (route.startsWith('/items?since=')) return this.page(Number(route.split('=')[1]));
    if (route === '/items') return this.upload(machine, request.body);
    if (route === '/summary') return this.summary();
    if (route === '/keys')
      return { status: 200, body: { machines: this.machineRows(machine) } };
    if (route === '/keys/mine' && method === 'PUT') {
      // Cast is safe: the client sends exactly this shape.
      const { publicKey } = request.body as { publicKey: string };
      this.keys.set(machine, { publicKey, updatedAt: this.tick() });
      return { status: 200, body: { machineId: machine, publicKey } };
    }
    if (route === '/keys/mine') {
      const row = this.keys.get(machine);
      return row === undefined
        ? { status: 404 }
        : { status: 200, body: { machineId: machine, ...row } };
    }
    const sealTo = /^\/keys\/([^/]+)\/envelope$/.exec(route);
    if (sealTo !== null) {
      const row = this.keys.get(sealTo[1] ?? '');
      if (row === undefined) return { status: 404 };
      // Cast is safe: the client sends exactly this shape.
      Object.assign(row, request.body as { envelope: string; keyId: string });
      row.updatedAt = this.tick();
      return { status: 204 };
    }
    if (route === '/conflicts')
      return { status: 200, body: { conflicts: this.conflictRows() } };
    const dismiss = /^\/conflicts\/(.+)$/.exec(route);
    if (dismiss !== null && method === 'DELETE') {
      const at = this.conflicts.findIndex((each) => each.conflictId === dismiss[1]);
      if (at < 0) return { status: 404 };
      this.conflicts.splice(at, 1);
      return { status: 204 };
    }
    return { status: 404 };
  }

  private machineRows(asking: string): unknown[] {
    return [...this.keys.entries()]
      .filter(([machineId]) => machineId === asking || !this.unseen.has(machineId))
      .map(([machineId, row]) => ({ machineId, ...row }));
  }

  private conflictRows(): unknown[] {
    return this.conflicts.map((each) => ({
      id: each.conflictId,
      kind: each.kind,
      itemId: each.id,
      version: each.version,
      keyId: each.keyId,
      ciphertext: each.ciphertext ?? '',
      writtenBy: each.updatedBy,
      keptAt: NOW.toISOString(),
    }));
  }

  private page(since: number): CloudResponse<unknown> {
    const items = [...this.items.values()]
      .filter((item) => item.seq > since)
      .sort((a, b) => a.seq - b.seq);
    return { status: 200, body: { items, next: this.seq, more: false, reset: false } };
  }

  private summary(): CloudResponse<unknown> {
    const machines = [...this.keys.entries()].map(([machineId, row]) => ({
      machineId,
      registered: true,
      sealed: row.envelope !== undefined,
    }));
    return {
      status: 200,
      body: { newestSeq: this.seq, conflicts: this.conflicts.length, machines },
    };
  }

  private upload(machine: string, body: unknown): CloudResponse<unknown> {
    // Cast is safe: the client sends exactly this shape.
    const { items } = body as { items: (Kept & { baseVersion: number })[] };
    const results = items.map((upload) => {
      const at = `${upload.kind}:${upload.id}`;
      const held = this.items.get(at);
      this.seq += 1;
      const version = (held === undefined ? 0 : held.version) + 1;
      const lost =
        held !== undefined &&
        held.version !== upload.baseVersion &&
        held.ciphertext !== undefined;
      const conflictId = lost ? `c${this.conflicts.length + 1}` : undefined;
      if (lost && held !== undefined)
        this.conflicts.push({ ...held, conflictId: conflictId ?? '' });
      this.items.set(at, {
        kind: upload.kind,
        id: upload.id,
        version,
        seq: this.seq,
        keyId: upload.keyId,
        ...(upload.ciphertext === undefined
          ? { deleted: true }
          : { ciphertext: upload.ciphertext }),
        updatedAt: NOW.toISOString(),
        updatedBy: machine,
      });
      return {
        kind: upload.kind,
        id: upload.id,
        version,
        seq: this.seq,
        ...(conflictId === undefined ? {} : { conflictId }),
      };
    });
    return { status: 200, body: { items: results } };
  }
}

function memorySecrets(): SecretStore {
  const kept = new Map<string, string>();
  return {
    get: async (name) => kept.get(name),
    set: async (name, value) => {
      kept.set(name, value);
    },
    remove: async (name) => {
      kept.delete(name);
    },
  };
}

interface Machine {
  deps: SyncDeps;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  sign(id: string | undefined): Promise<void>;
}

async function machine(cloud: FakeCloud, machineId: string): Promise<Machine> {
  const home = await mkdtemp(join(tmpdir(), `memnox-personal-sync-${machineId}-`));
  await writeAccount(home, {
    version: 1,
    baseUrl: 'https://cloud.example',
    workspaceId: 'ws_1',
    machineId,
    token: `token-${machineId}`,
    privateKey: 'unused',
    enrolledAt: NOW.toISOString(),
  });
  const deps: SyncDeps = {
    home,
    secrets: memorySecrets(),
    now: () => NOW,
    send: cloud.sendAs(machineId),
  };
  return {
    deps,
    ask: (request) =>
      personalSyncAnswer(
        {
          id: 1,
          method: DAEMON_METHOD.PERSONAL_SYNC_STATUS,
          ...request,
        } as DaemonRequest,
        deps,
      ),
    sign: async (id) => {
      const proposal = id === undefined ? null : await new Proposals(home).read(id);
      if (proposal === null) throw new Error('nothing was proposed');
      expect(await applyPersonalSyncProposal(home, proposal.change, deps)).toMatchObject({
        ok: true,
      });
    },
  };
}

function verifiedFact(home: string, statement: string): void {
  const store = SqliteMemoryStore.forHome(home);
  const added = store.add(
    {
      kind: MEMORY_KIND.FACT,
      statement,
      subject: 'deploys',
      scope: MEMORY_SCOPE.PERSONAL,
      origin: MEMORY_ORIGIN.PERSON,
      tainted: false,
      evidence: [],
    },
    NOW.toISOString(),
  );
  if ('added' in added)
    store.decide(added.added.id, MEMORY_STATUS.VERIFIED, {
      by: 'me',
      at: NOW.toISOString(),
    });
  store.close();
}

/** Two machines of one person, the second holding the key once the person compared fingerprints. */
async function paired(cloud: FakeCloud, laptop: Machine): Promise<{ desktop: Machine }> {
  const desktop = await machine(cloud, 'm-desktop');
  await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
  const waiting = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
  expect(waiting.personalSync?.state).toBe(PERSONAL_SYNC_STATE.WAITING_FOR_KEY);
  const offered = await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER });
  const [shown] = offered.personalSync?.waiting ?? [];
  const offer = await laptop.ask({
    method: DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER,
    syncMachineId: 'm-desktop',
    syncFingerprint: shown?.fingerprint ?? '',
  });
  await laptop.sign(offer.proposed);
  const arrived = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT });
  expect(arrived.personalSync?.arrivedFingerprint).toBe(shown?.fingerprint);
  const accept = await desktop.ask({
    method: DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT,
    syncFingerprint: arrived.personalSync?.arrivedFingerprint ?? '',
  });
  await desktop.sign(accept.proposed);
  return { desktop };
}

describe('personal sync between two machines of one person', () => {
  it('are methods a screen asks', () => {
    expect(isVoiceMethod(DAEMON_METHOD.PERSONAL_SYNC_NOW)).toBe(true);
  });

  it('sends ciphertext under ids the cloud cannot read a name from', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    await writeHub(laptop.deps.home, withServer(emptyHub(), LINEAR));
    const synced = await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(synced.personalSync?.state).toBe(PERSONAL_SYNC_STATE.READY);
    expect(synced.personalSync?.keyId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(cloud.items.size).toBe(1);
    for (const item of cloud.items.values()) {
      expect(item.id).not.toContain('linear');
      const bytes = Buffer.from(item.ciphertext ?? '', 'base64');
      expect(bytes.includes('linear')).toBe(false);
      expect(bytes.includes('linear-mcp')).toBe(false);
    }
  });

  it('carries servers, deny rules and verified facts to the second machine once its key is signed', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    await writeHub(laptop.deps.home, withServer(emptyHub(), LINEAR));
    await writeMachineRules(laptop.deps.home, [rule('no-force-push', 'deny')]);
    verifiedFact(laptop.deps.home, 'Deploys go out on Tuesdays');
    const { desktop } = await paired(cloud, laptop);
    const synced = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(synced.personalSync?.state).toBe(PERSONAL_SYNC_STATE.READY);
    const hub = await readHub(desktop.deps.home);
    expect(hub.servers).toEqual([LINEAR]);
    expect(hub.assignments).toEqual([]);
    expect((await editableRules(desktop.deps.home)).map((each) => each.name)).toContain(
      'no-force-push',
    );
    const store = SqliteMemoryStore.forHome(desktop.deps.home);
    const facts = store.items({ statuses: [MEMORY_STATUS.VERIFIED] });
    store.close();
    expect(facts.map((fact) => fact.statement)).toEqual(['Deploys go out on Tuesdays']);
  });

  it('holds an allow from the other machine for a signature', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    await writeMachineRules(laptop.deps.home, [rule('let-force-push', 'allow')]);
    const { desktop } = await paired(cloud, laptop);
    const synced = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(synced.personalSync?.skipped.join(' ')).toContain('waits on your signature');
    expect(await editableRules(desktop.deps.home)).toEqual([]);
    const open = await new Proposals(desktop.deps.home).open(NOW.toISOString());
    expect(open.map((each) => each.change.kind)).toContain(PROPOSAL_KIND.RULES);
  });

  it('refuses a fingerprint the person did not see', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    const desktop = await machine(cloud, 'm-desktop');
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const offer = await laptop.ask({
      method: DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER,
      syncMachineId: 'm-desktop',
      syncFingerprint: '00000 00000 00000 00000 00000 00000',
    });
    expect(offer.ok).toBe(false);
    expect(offer.reason).toContain('not the fingerprint');
  });

  it('keeps the copy that lost for the person to choose from', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    await writeHub(laptop.deps.home, withServer(emptyHub(), LINEAR));
    const { desktop } = await paired(cloud, laptop);
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    await writeHub(
      laptop.deps.home,
      withServer(emptyHub(), { ...LINEAR, args: ['laptop'] }),
    );
    await writeHub(
      desktop.deps.home,
      withServer(emptyHub(), { ...LINEAR, args: ['desktop'] }),
    );
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const raced = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(raced.personalSync?.conflicts).toBe(1);
    expect((await readHub(desktop.deps.home)).servers[0]?.args).toEqual(['desktop']);
    const listed = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_CONFLICTS });
    const [conflict] = listed.syncConflicts ?? [];
    expect(conflict?.name).toBe('linear');
    expect(conflict?.theirs).toContain('laptop');
    expect(conflict?.mine).toContain('desktop');
    if (conflict === undefined) return;
    const kept = await desktop.ask({
      method: DAEMON_METHOD.PERSONAL_SYNC_RESOLVE,
      syncConflictId: conflict.id,
      syncKeep: SYNC_KEEP.MINE,
    });
    expect(kept.ok).toBe(true);
    expect(cloud.conflicts).toHaveLength(0);
  });

  it('settles two machines registering at once on the key of the one that registered first', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    const desktop = await machine(cloud, 'm-desktop');
    await writeHub(laptop.deps.home, withServer(emptyHub(), LINEAR));
    await writeHub(desktop.deps.home, withServer(emptyHub(), { ...LINEAR, args: ['d'] }));
    cloud.registerTogether(2);
    const [first, second] = await Promise.all([
      laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW }),
      desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW }),
    ]);
    expect(first.personalSync?.state).toBe(PERSONAL_SYNC_STATE.READY);
    expect(second.personalSync?.state).toBe(PERSONAL_SYNC_STATE.WAITING_FOR_KEY);
    expect(second.personalSync?.keyId).toBeUndefined();
    const keyIds = new Set([...cloud.items.values()].map((item) => item.keyId));
    expect([...keyIds]).toEqual([first.personalSync?.keyId]);
  });

  it('lets go of a key made here before sealing anything, once an earlier machine comes into view', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    cloud.unseen.add('m-laptop');
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const desktop = await machine(cloud, 'm-desktop');
    const made = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(made.personalSync?.state).toBe(PERSONAL_SYNC_STATE.READY);
    cloud.unseen.clear();
    const offer = await desktop.ask({
      method: DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER,
      syncMachineId: 'm-laptop',
      syncFingerprint: '00000 00000 00000 00000 00000 00000',
    });
    expect(offer.ok).toBe(false);
    expect(offer.reason).toContain('registered first');
    const waiting = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(waiting.personalSync?.state).toBe(PERSONAL_SYNC_STATE.WAITING_FOR_KEY);
    expect(cloud.keys.get('m-laptop')?.envelope).toBeUndefined();
    expect(cloud.items.size).toBe(0);
  });

  it('takes a skill deleted on one machine out of the other, and never sends it back', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    const skills = (
      home: string,
      request: Partial<DaemonRequest>,
    ): Promise<DaemonResponse> =>
      skillsHubAnswer(
        home,
        { id: 2, method: DAEMON_METHOD.SKILLS_HUB, ...request } as DaemonRequest,
        NOW,
      );
    const put = await skills(laptop.deps.home, {
      method: DAEMON_METHOD.SKILL_PUT,
      skillScope: SKILL_SCOPE.PERSONAL,
      skillDraft: {
        name: 'review',
        version: '1.0.0',
        description: 'Review a change before it is pushed',
        instructions: '# Review\n\nRead the diff, then say what is risky.\n',
      },
    });
    expect(put.ok).toBe(true);
    const { desktop } = await paired(cloud, laptop);
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const held = await readSkillsHub(desktop.deps.home);
    expect(held.skills.map((skill) => skill.name)).toEqual(['review']);
    const accepted = await skills(desktop.deps.home, {
      method: DAEMON_METHOD.SKILL_ACCEPT,
      skillName: 'review',
    });
    expect(accepted.ok).toBe(true);
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });

    const removed = await skills(laptop.deps.home, {
      method: DAEMON_METHOD.SKILL_REMOVE,
      skillName: 'review',
    });
    expect(removed.ok).toBe(true);
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const [tombstone] = [...cloud.items.values()];
    expect(tombstone?.deleted).toBe(true);

    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect((await readSkillsHub(desktop.deps.home)).skills).toEqual([]);
    expect(existsSync(join(desktop.deps.home, '.memnox', 'skills', 'review'))).toBe(
      false,
    );
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect([...cloud.items.values()].map((item) => item.deleted)).toEqual([true]);
    expect((await readSkillsHub(laptop.deps.home)).skills).toEqual([]);
  });

  it('keeps a deletion waiting on a signature here as a tombstone, so the copy here is not sent back', async () => {
    const cloud = new FakeCloud();
    const laptop = await machine(cloud, 'm-laptop');
    await writeMachineRules(laptop.deps.home, [rule('no-force-push', 'deny')]);
    const { desktop } = await paired(cloud, laptop);
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    await writePolicyDocumentFile(machinePolicyPath(laptop.deps.home), {
      version: 1,
      policies: [],
    });
    await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    const waits = await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(waits.personalSync?.skipped.join(' ')).toContain('waits on your signature');
    await desktop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect([...cloud.items.values()].map((item) => item.deleted)).toEqual([true]);
  });

  it('says plainly when the plan does not carry personal sync', async () => {
    const cloud = new FakeCloud();
    cloud.onPlan = false;
    const laptop = await machine(cloud, 'm-laptop');
    const synced = await laptop.ask({ method: DAEMON_METHOD.PERSONAL_SYNC_NOW });
    expect(synced.personalSync?.state).toBe(PERSONAL_SYNC_STATE.NOT_ON_PLAN);
    expect(synced.personalSync?.said).toBe(PLAN_REFUSAL);
  });
});

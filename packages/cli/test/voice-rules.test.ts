import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_EVENT,
  loadPoliciesFromFile,
  PolicyEngine,
  Proposals,
  readPolicyRegistry,
  RULE_SCOPE,
  writeAccount,
  type RuleScope,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { machinePolicyPath } from '../src/protect/machine-rules';
import { scopeAnswered, scopedRules } from '../src/protect/rule-scope';
import { readLocalDecisions } from '../src/sync/local-decisions';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

/**
 * A rule a person says while holding the rule keys: proposed with the places it could hold, and
 * put in force only where they picked, with the pick itself covered by their Touch ID.
 */

const NOW = new Date('2026-10-04T12:00:00.000Z');
const AGENT = { agentName: 'claude-code' };

const SEAMS: RewindSeams = {
  build: () => {
    throw new Error('no milestones here');
  },
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-rules-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
    runMemnox: async () => ({ exitCode: 0, output: '' }),
  };
}

/** A key registered as the Mac's, and a way to sign exactly one answer with it. */
async function macKey(
  home: string,
): Promise<(subject: string, answer: string) => string> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  return (subject, answer) => signWith(privateKey, subject, answer);
}

function signWith(key: KeyObject, subject: string, answer: string): string {
  return sign('sha256', Buffer.from(confirmationMessage(subject, answer)), key).toString(
    'base64',
  );
}

async function proposeDenyPushToMain(
  deps: SessionToolDeps,
  project?: string,
): Promise<{ proposed: string; scopes: RuleScope[] }> {
  const { proposed } = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
    action: 'git push',
    effect: 'deny',
    branches: 'main',
    reason: 'nobody pushes to main by hand',
    ...(project === undefined ? {} : { project }),
  })) as { proposed: string };
  const [event] = (await new WaitingFeed(deps.home).current(NOW.toISOString())).filter(
    (each) => each.kind === DAEMON_EVENT.PROPOSAL,
  );
  return { proposed, scopes: event?.rule?.scopes ?? [] };
}

describe('a rule said with the rule keys', () => {
  it('reaches the Mac with what it does and where it could hold, the whole Mac first', async () => {
    const deps = await depsAt();
    await proposeDenyPushToMain(deps);
    const [event] = await new WaitingFeed(deps.home).current(NOW.toISOString());
    expect(event?.rule).toMatchObject({
      summary: expect.stringContaining('on main'),
      effect: 'deny',
      branches: ['main'],
      reason: 'nobody pushes to main by hand',
    });
    expect(event?.rule?.scopes[0]).toMatchObject({
      kind: RULE_SCOPE.MACHINE,
      suggested: true,
    });
  });

  it('suggests the repository they named, and offers it beside the whole Mac', async () => {
    const deps = await depsAt();
    const shop = join(deps.home, 'shop');
    await mkdir(shop);
    const { scopes } = await proposeDenyPushToMain(deps, shop);
    expect(scopes.map((scope) => scope.kind)).toEqual([
      RULE_SCOPE.MACHINE,
      RULE_SCOPE.REPOSITORY,
    ]);
    expect(scopes[1]).toMatchObject({ label: 'shop', folder: shop, suggested: true });
    expect(scopes[0]?.suggested).toBeUndefined();
  });

  it('holds only inside the repository picked, once the pick is signed', async () => {
    const deps = await depsAt();
    const shop = join(deps.home, 'shop');
    await mkdir(shop);
    const signed = await macKey(deps.home);
    const { proposed, scopes } = await proposeDenyPushToMain(deps, shop);
    const repository = scopes.find((scope) => scope.kind === RULE_SCOPE.REPOSITORY);
    if (repository === undefined) throw new Error('no repository offered');

    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: repository.id,
        signature: signed(proposed, repository.id),
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: true });

    const file = join(shop, 'memnox.policies.toml');
    expect(
      await readPolicyRegistry(join(deps.home, '.memnox', 'policies.json')),
    ).toContain(file);
    const engine = new PolicyEngine(await loadPoliciesFromFile(file));
    const push = { action: 'git.push', branch: 'main' };
    expect(
      engine.evaluate({ ...push, workingDirectory: join(shop, 'src') }, AGENT).effect,
    ).toBe('deny');
    expect(
      engine.evaluate({ ...push, workingDirectory: join(deps.home, 'elsewhere') }, AGENT)
        .matchedPolicies,
    ).toEqual([]);
    expect(
      engine.evaluate(
        { action: 'git.push', branch: 'feature', workingDirectory: shop },
        AGENT,
      ).matchedPolicies,
    ).toEqual([]);
    expect(existsSync(machinePolicyPath(deps.home))).toBe(false);
  });

  it('holds on the whole Mac when that is picked, in the machine file', async () => {
    const deps = await depsAt();
    const shop = join(deps.home, 'shop');
    await mkdir(shop);
    const signed = await macKey(deps.home);
    const { proposed } = await proposeDenyPushToMain(deps, shop);

    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: RULE_SCOPE.MACHINE,
        signature: signed(proposed, RULE_SCOPE.MACHINE),
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: true });

    const engine = new PolicyEngine(
      await loadPoliciesFromFile(machinePolicyPath(deps.home)),
    );
    expect(
      engine.evaluate(
        { action: 'git.push', branch: 'main', workingDirectory: '/anywhere' },
        AGENT,
      ).effect,
    ).toBe('deny');
    expect(existsSync(join(shop, 'memnox.policies.toml'))).toBe(false);
  });

  it('refuses a pick the signature does not cover, so nobody else chooses its reach', async () => {
    const deps = await depsAt();
    const shop = join(deps.home, 'shop');
    await mkdir(shop);
    const signed = await macKey(deps.home);
    const { proposed, scopes } = await proposeDenyPushToMain(deps, shop);
    const repository = scopes.find((scope) => scope.kind === RULE_SCOPE.REPOSITORY);
    if (repository === undefined) throw new Error('no repository offered');

    // Signed for the repository, sent as the whole Mac.
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: RULE_SCOPE.MACHINE,
        signature: signed(proposed, repository.id),
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: false });
    // A place this proposal never offered.
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: 'repository-9',
        signature: signed(proposed, 'repository-9'),
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: false });
    expect(existsSync(machinePolicyPath(deps.home))).toBe(false);
    expect(existsSync(join(shop, 'memnox.policies.toml'))).toBe(false);
    expect(await new Proposals(deps.home).open(NOW.toISOString())).toHaveLength(1);
  });

  it('is declined with no Touch ID and writes nothing', async () => {
    const deps = await depsAt();
    const { proposed } = await proposeDenyPushToMain(deps);
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: 'declined',
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: true, outcome: 'declined' });
    expect(existsSync(machinePolicyPath(deps.home))).toBe(false);
  });
});

describe('where a rule goes', () => {
  const machine: RuleScope = {
    id: RULE_SCOPE.MACHINE,
    kind: RULE_SCOPE.MACHINE,
    label: 'This Mac',
  };
  const shop: RuleScope = {
    id: 'repository-1',
    kind: RULE_SCOPE.REPOSITORY,
    label: 'shop',
    folder: '/code/shop',
    suggested: true,
  };

  it('takes the suggested place for a plain confirmed, and exactly the one named otherwise', () => {
    expect(scopeAnswered([machine, shop], 'confirmed')).toBe(shop);
    expect(scopeAnswered([machine, shop], RULE_SCOPE.MACHINE)).toBe(machine);
    expect(scopeAnswered([machine, shop], 'repository-2')).toBeUndefined();
  });

  it('narrows a repository rule to its folder and leaves a machine rule as it is', () => {
    const rule = {
      name: 'r',
      match: { actions: ['git.push'] },
      decision: { effect: 'deny' as const },
    };
    expect(scopedRules([rule], shop)[0]?.match.workingDirectories).toEqual([
      '/code/shop',
      '/code/shop/*',
    ]);
    expect(scopedRules([rule], machine)[0]?.match.workingDirectories).toBeUndefined();
  });
});

describe('a rule picked for the team', () => {
  it('is offered only on a Mac connected to a team, written to no file, and kept for the next sync', async () => {
    const alone = await proposeDenyPushToMain(await depsAt());
    expect(alone.scopes.map((scope) => scope.kind)).not.toContain(RULE_SCOPE.TEAM);

    const deps = await depsAt();
    await writeAccount(deps.home, {
      version: 1,
      baseUrl: 'https://cloud.test',
      workspaceId: 'acme',
      machineId: 'mch_1',
      token: 'machine-token',
      privateKey: 'unused-here',
      enrolledAt: '2026-09-24T09:00:00.000Z',
    });
    const signed = await macKey(deps.home);
    const { proposed, scopes } = await proposeDenyPushToMain(deps);
    const team = scopes.find((scope) => scope.kind === RULE_SCOPE.TEAM);
    if (team === undefined) throw new Error('no team offered');
    expect(team.suggested).toBeUndefined();

    const answered = await confirmAnswer(deps.home, {
      subject: proposed,
      answer: team.id,
      signature: signed(proposed, team.id),
      at: NOW.toISOString(),
    });
    expect(answered).toMatchObject({
      ok: true,
      outcome: expect.stringContaining('offered to the team'),
    });
    expect(existsSync(machinePolicyPath(deps.home))).toBe(false);
    expect(await readLocalDecisions(deps.home)).toMatchObject([
      { operation: 'git.push', effect: 'deny' },
    ]);
  });
});

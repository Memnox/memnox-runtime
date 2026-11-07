import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECISION_EFFECT, LocalGate, loadPoliciesFromFile } from '@memnox/core';

import {
  applyBundle,
  orgPolicyPath,
  PULL_OUTCOME,
  type Bundle,
  type BundleRule,
} from '../src/sync/bundle';
import { documentFrom } from '../src/sync/bundle-document';

/**
 * The team's copy of a rule a machine wrote for itself has to match exactly what the
 * source matched. `memnox setup` denies reading `~/.ssh`, `~/.aws` and `.env` files; the
 * copy that came back down named no targets, so every machine that pulled it refused
 * every file read.
 */

const CREDENTIAL_TARGETS = [
  '**/.ssh',
  '**/.ssh/**',
  '**/.aws',
  '**/.aws/**',
  '**/.gcloud',
  '**/.gcloud/**',
  '**/.kube',
  '**/.kube/**',
  '**/.env',
  '**/.env.*',
];

/** The credentials deny as the control plane sends it: under the spelling a pre-scope runtime skips. */
const CREDENTIALS_DENY: BundleRule = {
  id: '542631307680a248b68c11a8fc94a005',
  policyHash: 'p1',
  line: 1,
  domain: 'filesystem',
  effect: DECISION_EFFECT.DENY,
  specificity: 15,
  match: 'memnox.requires-scoped-rules',
  scopedMatch: 'filesystem.read',
  targets: CREDENTIAL_TARGETS,
  reason: 'you chose to deny this: almost no task needs the key itself',
};

const bundleOf = (rules: BundleRule[]): Bundle => ({
  hash: 'h1',
  policies: [],
  rules,
  conditions: [],
  tags: [],
});

interface Written {
  policies: { name: string; match: Record<string, unknown> }[];
}

describe('a published rule reaches the gate with every condition it was published with', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-bundle-conditions-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('keeps the targets, so only credential files are refused', async () => {
    const result = await applyBundle(home, bundleOf([CREDENTIALS_DENY]));
    expect(result.outcome).toBe(PULL_OUTCOME.APPLIED);

    const policies = await loadPoliciesFromFile(orgPolicyPath(home));
    expect(policies[0]?.match.actions).toEqual(['filesystem.read']);
    expect(policies[0]?.match.targets).toEqual(CREDENTIAL_TARGETS);

    const gate = new LocalGate(policies, { agentName: 'claude-code' });
    const read = (target: string): string =>
      gate.evaluate({ action: 'filesystem.read', target }).effect;
    expect(read('/home/dev/.ssh/id_ed25519')).toBe(DECISION_EFFECT.DENY);
    expect(read('/home/dev/app/.env')).toBe(DECISION_EFFECT.DENY);
    expect(read('/home/dev/app/README.md')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('keeps every action a rule names', () => {
    const document = documentFrom(
      bundleOf([
        {
          id: 'r2',
          policyHash: 'p1',
          line: 2,
          domain: 'git',
          effect: DECISION_EFFECT.DENY,
          specificity: 14,
          match: 'git.push-force',
          actions: ['git.push-force', 'git.reset-hard', 'git.clean'],
        },
      ]),
    ) as Written;

    expect(document.policies[0]?.match).toEqual({
      actions: ['git.push-force', 'git.reset-hard', 'git.clean'],
    });
  });

  it('carries every other condition onto the match, and the gate holds the rule to it', async () => {
    const conditioned: BundleRule = {
      id: 'r3',
      policyHash: 'p1',
      line: 3,
      domain: 'deploy',
      effect: DECISION_EFFECT.DENY,
      specificity: 10,
      match: 'memnox.requires-conditioned-rules',
      actions: ['deploy.run'],
      conditions: { environments: ['production'], unless: [{ project: 'sandbox' }] },
      unless: [{ agents: ['release-bot'] }],
    };

    expect((documentFrom(bundleOf([conditioned])) as Written).policies[0]?.match).toEqual(
      {
        actions: ['deploy.run'],
        environments: ['production'],
        unless: [{ project: 'sandbox' }, { agents: ['release-bot'] }],
      },
    );

    await applyBundle(home, bundleOf([conditioned]));
    const gate = new LocalGate(await loadPoliciesFromFile(orgPolicyPath(home)), {
      agentName: 'claude-code',
    });
    const deploy = (environment: string): string =>
      gate.evaluate({ action: 'deploy.run', environment }).effect;
    expect(deploy('production')).toBe(DECISION_EFFECT.DENY);
    expect(deploy('staging')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('holds a rule to its classes and capabilities, which every machine used to skip', async () => {
    const neverDelete: BundleRule = {
      ...CREDENTIALS_DENY,
      id: 'r5',
      domain: '*',
      match: 'memnox.requires-conditioned-rules',
      actions: ['*'],
      targets: undefined,
      conditions: { classes: ['destructive'] },
      reason: 'Never delete anything.',
    };
    const askBeforeDeploy: BundleRule = {
      ...CREDENTIALS_DENY,
      id: 'r6',
      domain: '*',
      effect: DECISION_EFFECT.ASK,
      match: 'memnox.requires-conditioned-rules',
      actions: ['*'],
      targets: undefined,
      conditions: { capabilities: ['deploy'] },
      reason: 'Ask before deploying.',
    };

    const result = await applyBundle(home, bundleOf([neverDelete, askBeforeDeploy]));
    expect(result.notEnforced).toEqual([]);
    const gate = new LocalGate(await loadPoliciesFromFile(orgPolicyPath(home)), {
      agentName: 'claude-code',
    });
    const decide = (action: string, toolClass: string): string =>
      gate.evaluate({ action, toolClass }).effect;
    expect(decide('shell.execute', 'destructive')).toBe(DECISION_EFFECT.DENY);
    expect(decide('filesystem.read', 'read')).toBe(DECISION_EFFECT.ALLOW);
    // The capability is read off the action itself, as on every call.
    expect(decide('vercel.deploy', 'write')).toBe(DECISION_EFFECT.ASK);
    expect(decide('filesystem.write', 'write')).toBe(DECISION_EFFECT.ALLOW);
  });
});

/* The validator drops a match key it does not know, so a condition from a newer control plane
   would be read as no condition at all. The rule is never written under its own name then: a
   deny or an ask is asked about instead, wider and named apart, and every one is reported. */
describe('a rule naming a condition this gate cannot read', () => {
  const unreadable = (overrides: Partial<BundleRule>): BundleRule => ({
    ...CREDENTIALS_DENY,
    id: 'r4',
    match: 'memnox.requires-conditioned-rules',
    actions: ['filesystem.read'],
    conditions: { owners: ['ana'] },
    ...overrides,
  });

  it('is asked about instead, under a name of its own, and never written as the rule', () => {
    const document = documentFrom(
      bundleOf([unreadable({}), CREDENTIALS_DENY]),
    ) as Written & {
      notEnforced: unknown[];
    };

    expect(document.policies.map((policy) => policy.name)).toEqual([
      'r4.asked-instead',
      CREDENTIALS_DENY.id,
    ]);
    const [fallback] = document.policies as unknown as {
      match: Record<string, unknown>;
      decision: { effect: string; reason: string };
    }[];
    expect(fallback?.match).toEqual({
      actions: ['filesystem.read'],
      targets: CREDENTIAL_TARGETS,
    });
    expect(fallback?.decision.effect).toBe(DECISION_EFFECT.ASK);
    expect(fallback?.decision.reason).toContain('cannot read owners');
    expect(fallback?.decision.reason).toContain(
      'instead of enforcing the rule as written',
    );
    expect(document.notEnforced).toEqual([
      { id: 'r4', effect: DECISION_EFFECT.DENY, keys: ['owners'], fallback: 'ask' },
    ]);
  });

  it('asks nothing about a rule over every action, which would stop all work, and reports it', () => {
    const document = documentFrom(
      bundleOf([unreadable({ actions: ['*'], targets: undefined })]),
    ) as Written & {
      notEnforced: unknown[];
    };
    expect(document.policies).toEqual([]);
    expect(document.notEnforced).toEqual([
      { id: 'r4', effect: DECISION_EFFECT.DENY, keys: ['owners'], fallback: 'none' },
    ]);
  });

  it('skips an allow, which permits nothing by being absent, and reports it', () => {
    const document = documentFrom(
      bundleOf([unreadable({ effect: DECISION_EFFECT.ALLOW })]),
    ) as Written & {
      notEnforced: unknown[];
    };
    expect(document.policies).toEqual([]);
    expect(document.notEnforced).toEqual([
      { id: 'r4', effect: DECISION_EFFECT.ALLOW, keys: ['owners'], fallback: 'none' },
    ]);
  });

  it('is returned by the pull, so the heartbeat can say so', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-bundle-unreadable-'));
    try {
      const result = await applyBundle(home, bundleOf([unreadable({})]));
      expect(result.notEnforced).toEqual([
        { id: 'r4', effect: DECISION_EFFECT.DENY, keys: ['owners'], fallback: 'ask' },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

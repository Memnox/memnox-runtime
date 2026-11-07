import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  DECISION_EFFECT,
  EarnedAllowances,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  proposalCapability,
  Proposals,
  readPolicyDocumentFile,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  RULE_SOURCE,
  writePolicyDocumentFile,
  type DaemonRequest,
  type DaemonResponse,
  type Policy,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { isPolicyMethod, policiesAnswer } from '../src/daemon/policies-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { registerPolicyFile } from '../src/policy-registry';
import { machinePolicyPath } from '../src/protect/machine-rules';

/**
 * The Policy Studio's daemon methods: every rule with where it came from, a widening change only
 * as a proposal the person signs, a narrowing one at once, and a dry run that records nothing.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const DENY_PUSH: Policy = {
  name: 'no-push-main',
  match: { actions: ['git.push*'], branches: ['main'] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'main is protected' },
};

const ALLOW_TESTS: Policy = {
  name: 'tests-run',
  match: { actions: ['npm test'] },
  decision: { effect: DECISION_EFFECT.ALLOW, reason: 'tests are safe' },
};

interface Fixture {
  home: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  confirm(subject: string): Promise<void>;
}

async function fixture(rules: Policy[] = []): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-studio-'));
  if (rules.length > 0) {
    await mkdir(dirname(machinePolicyPath(home)), { recursive: true });
    await writePolicyDocumentFile(machinePolicyPath(home), {
      version: 1,
      policies: rules,
    });
    await registerPolicyFile(home, machinePolicyPath(home));
  }
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  let id = 0;
  return {
    home,
    ask: (request) => {
      id += 1;
      const full = {
        id,
        method: DAEMON_METHOD.POLICY_RULES,
        ...request,
      } as DaemonRequest;
      return policiesAnswer(home, full, { now: NOW, env: {} });
    },
    confirm: async (subject) => {
      const signature = sign(
        'sha256',
        Buffer.from(confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED)),
        privateKey,
      ).toString('base64');
      const result = await confirmAnswer(home, {
        subject,
        answer: PROPOSAL_ANSWER.CONFIRMED,
        signature,
        at: NOW.toISOString(),
      });
      expect(result).toMatchObject({ ok: true });
    },
  };
}

async function machineRuleNames(home: string): Promise<string[]> {
  const document = await readPolicyDocumentFile(machinePolicyPath(home));
  return (document?.policies ?? []).map((rule) => rule.name);
}

describe('the Policy Studio methods', () => {
  it('are voice methods a phone may read, and propose through only', () => {
    expect(isPolicyMethod('rules')).toBe(true);
    expect(isVoiceMethod('rule-propose')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.POLICY_RULES)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.RULE_TEST)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.RULE_PROPOSE)).toBe(REMOTE_CAPABILITY.ASK);
    expect(remoteCapabilityFor(DAEMON_METHOD.AUTOPILOT_REVOKE)).toBe(
      REMOTE_CAPABILITY.ASK,
    );
    expect(
      proposalCapability({ kind: PROPOSAL_KIND.RULE_REMOVE, file: 'f', rule: 'r' }),
    ).toBe(REMOTE_CAPABILITY.RULES);
  });

  it('lists a person rule as editable, with its sentence and its file', async () => {
    const at = await fixture([DENY_PUSH]);
    const answer = await at.ask({});
    const rule = answer.policyRules?.rules.find((each) => each.name === 'no-push-main');
    expect(rule).toMatchObject({
      effect: DECISION_EFFECT.DENY,
      source: RULE_SOURCE.PERSON,
      file: machinePolicyPath(at.home),
      editable: true,
      match: { actions: ['git.push*'], branches: ['main'] },
    });
    expect(rule?.sentence).toContain('may not');
  });

  it('lists an autopilot grant as in force until it ends, and never editable', async () => {
    const at = await fixture();
    await new EarnedAllowances(at.home).add({
      id: 'ern_1',
      actions: ['npm test'],
      targets: ['src/*'],
      agents: ['claude-code'],
      by: 'memnox autopilot',
      since: '2026-10-29T00:00:00.000Z',
      until: '2026-11-05T00:00:00.000Z',
    });
    const rules = (await at.ask({})).policyRules?.rules ?? [];
    expect(rules.find((each) => each.name === 'ern_1')).toMatchObject({
      source: RULE_SOURCE.AUTOPILOT,
      effect: DECISION_EFFECT.ALLOW,
      until: '2026-11-05T00:00:00.000Z',
      editable: false,
    });
  });

  it('proposes a drafted rule and puts it in force only once the person signs', async () => {
    const at = await fixture();
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_PROPOSE,
      ruleDraft: {
        effect: DECISION_EFFECT.ASK,
        action: 'git.push*',
        reason: 'pushes are looked at',
        agents: ['codex-cli'],
        workingDirectories: ['/srv/*'],
        classes: ['write'],
      },
    });
    expect(answer.proposed).toMatch(/^prp_/);
    expect(answer.ruleProposed?.summary).toContain('Only in /srv/*');
    expect(await machineRuleNames(at.home)).toEqual([]);
    await at.confirm(answer.proposed ?? '');
    const document = await readPolicyDocumentFile(machinePolicyPath(at.home));
    expect(document?.policies[0]?.match).toMatchObject({
      agents: ['codex-cli', 'codex', 'agt_codex-cli'],
      workingDirectories: ['/srv/*'],
      classes: ['write'],
    });
  });

  it('refuses a draft the validator would not load', async () => {
    const at = await fixture();
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_PROPOSE,
      ruleDraft: { effect: 'allow', action: 'x', reason: '', classes: ['teleport'] },
    });
    expect(answer.ok).toBe(false);
    expect(answer.reason).toContain('teleport');
  });

  it('removes a person allow at once, since that only narrows', async () => {
    const at = await fixture([ALLOW_TESTS, DENY_PUSH]);
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_REMOVE,
      ruleName: 'tests-run',
    });
    expect(answer.ok).toBe(true);
    expect(answer.proposed).toBeUndefined();
    expect(await machineRuleNames(at.home)).toEqual(['no-push-main']);
  });

  it('removes a person deny only once the person signs, since that widens', async () => {
    const at = await fixture([DENY_PUSH]);
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_REMOVE,
      ruleName: 'no-push-main',
    });
    expect(answer.proposed).toMatch(/^prp_/);
    expect(await machineRuleNames(at.home)).toEqual(['no-push-main']);
    await at.confirm(answer.proposed ?? '');
    expect(await machineRuleNames(at.home)).toEqual([]);
  });

  it('refuses to remove a rule nobody added here', async () => {
    const at = await fixture();
    const answer = await at.ask({ method: DAEMON_METHOD.RULE_REMOVE, ruleName: 'nope' });
    expect(answer.ok).toBe(false);
  });

  it('rules on an action without recording anything', async () => {
    const noLaunch: Policy = {
      name: 'no-rocket-launch',
      match: { actions: ['rocket.launch'] },
      decision: { effect: DECISION_EFFECT.DENY, reason: 'not today' },
    };
    const at = await fixture([noLaunch]);
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_TEST,
      ruleTest: { action: 'rocket.launch', agent: 'codex' },
    });
    expect(answer.ruleVerdict).toMatchObject({
      effect: DECISION_EFFECT.DENY,
      rule: 'no-rocket-launch',
    });
  });

  it('exports the person rules as TOML and imports a pack only as proposals', async () => {
    const at = await fixture([DENY_PUSH]);
    const exported = await at.ask({ method: DAEMON_METHOD.RULES_EXPORT });
    expect(exported.rulesToml).toContain('no-push-main');
    const other = await fixture();
    const imported = await other.ask({
      method: DAEMON_METHOD.RULE_PACK_IMPORT,
      rulePack: exported.rulesToml ?? '',
    });
    expect(imported.packProposed).toHaveLength(1);
    expect(await machineRuleNames(other.home)).toEqual([]);
    const proposal = await new Proposals(other.home).read(
      imported.packProposed?.[0] ?? '',
    );
    expect(proposal?.change.kind).toBe(PROPOSAL_KIND.RULES);
  });

  it('refuses a pack that will not load', async () => {
    const at = await fixture();
    const answer = await at.ask({
      method: DAEMON_METHOD.RULE_PACK_IMPORT,
      rulePack: 'version = 1\n[[policies]]\nname = "x"\n',
    });
    expect(answer.ok).toBe(false);
  });

  it('answers progress in counts, and takes an autopilot grant back at once', async () => {
    const at = await fixture();
    await new EarnedAllowances(at.home).add({
      id: 'ern_2',
      actions: ['npm test'],
      by: 'memnox autopilot',
      since: '2026-10-29T00:00:00.000Z',
      until: '2026-11-05T00:00:00.000Z',
    });
    const progress = await at.ask({ method: DAEMON_METHOD.PROGRESS });
    expect(progress.progress?.grants.map((each) => each.id)).toEqual(['ern_2']);
    expect(progress.progress?.ladder.level).toBe('observe');
    expect(progress.progress?.thisWeek).toMatchObject({ asked: 0, handedOver: 0 });
    const revoked = await at.ask({
      method: DAEMON_METHOD.AUTOPILOT_REVOKE,
      grantId: 'ern_2',
    });
    expect(revoked.progress?.grants).toEqual([]);
  });
});

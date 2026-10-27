import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  TOOL_CLASS,
  type MemnoxEvent,
} from '../src/index';
import {
  allowanceFor,
  EarnedAllowances,
  FileAllowances,
  type Allowance,
} from '../src/gate/allowances';
import { PROMOTION_THRESHOLD } from '../src/session/autonomy';
import {
  AUTOPILOT_BY,
  EARNED_DAYS,
  earnedGrants,
  revokedByRefusal,
} from '../src/session/earned';

const NOW = '2026-09-05T10:00:00.000Z';
const later = (hours: number): string =>
  new Date(Date.parse(NOW) + hours * 60 * 60_000).toISOString();

const event = (over: Partial<MemnoxEvent> = {}): MemnoxEvent => ({
  id: `evt_${Math.random().toString(36).slice(2, 10)}`,
  schemaVersion: EVENT_SCHEMA_VERSION,
  at: NOW,
  sessionId: 'ses_1',
  agent: 'claude-code',
  actorType: ACTOR_TYPE.AGENT,
  surface: EVENT_SURFACE.SHELL,
  operation: 'vercel.deploy-preview',
  target: 'shop-web',
  class: TOOL_CLASS.WRITE,
  effect: DECISION_EFFECT.ASK,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'held',
  ...over,
});

const approved = (n: number, over: Partial<MemnoxEvent> = {}): MemnoxEvent[] =>
  Array.from({ length: n }, () => event({ authorizedBy: 'ada', ...over }));

let ids = 0;
const id = (): string => `ern_${(ids += 1)}`;

describe('what an agent earned', () => {
  it('hands over a habit to the agent that earned it, on those targets, for a week', () => {
    const [grant] = earnedGrants(approved(PROMOTION_THRESHOLD), [], { now: NOW, id });
    expect(grant?.allowance).toMatchObject({
      actions: ['vercel.deploy-preview'],
      targets: ['shop-web'],
      agents: ['claude-code'],
      by: AUTOPILOT_BY,
      since: NOW,
      until: later(EARNED_DAYS * 24),
    });
  });

  it('counts each agent on its own, so one agent never earns for another', () => {
    const events = [
      ...approved(PROMOTION_THRESHOLD - 1),
      ...approved(1, { agent: 'cursor' }),
    ];
    expect(earnedGrants(events, [], { now: NOW, id })).toEqual([]);
  });

  it('grants nothing after a single refusal', () => {
    const events = [
      ...approved(PROMOTION_THRESHOLD + 3),
      event({ effect: DECISION_EFFECT.DENY }),
    ];
    expect(earnedGrants(events, [], { now: NOW, id })).toEqual([]);
  });

  it('never hands over something destructive or outward, however often it was approved', () => {
    for (const toolClass of [TOOL_CLASS.DESTRUCTIVE, TOOL_CLASS.COMMUNICATION]) {
      const events = approved(PROMOTION_THRESHOLD * 2, { class: toolClass });
      expect(earnedGrants(events, [], { now: NOW, id })).toEqual([]);
    }
  });

  it('never hands over a target named like production', () => {
    const events = approved(PROMOTION_THRESHOLD, { target: 'shop-web-prod' });
    expect(earnedGrants(events, [], { now: NOW, id })).toEqual([]);
  });

  it('never hands over an action whose approvals named no target', () => {
    const events = approved(PROMOTION_THRESHOLD, { target: undefined });
    expect(earnedGrants(events, [], { now: NOW, id })).toEqual([]);
  });

  it('does not grant twice what is already held', () => {
    const [grant] = earnedGrants(approved(PROMOTION_THRESHOLD), [], { now: NOW, id });
    const held = grant === undefined ? [] : [grant.allowance];
    expect(earnedGrants(approved(PROMOTION_THRESHOLD), held, { now: NOW, id })).toEqual(
      [],
    );
  });
});

describe('taking a grant back', () => {
  const grant: Allowance = {
    id: 'ern_x',
    actions: ['vercel.deploy-preview'],
    targets: ['shop-web'],
    agents: ['claude-code'],
    by: AUTOPILOT_BY,
    since: NOW,
    until: later(EARNED_DAYS * 24),
  };

  it('is taken back by a refusal after it began', () => {
    const refusal = event({ effect: DECISION_EFFECT.DENY, at: later(1) });
    const [revoked] = revokedByRefusal([refusal], [grant], later(2));
    expect(revoked?.allowance.id).toBe('ern_x');
  });

  it('is not taken back by a refusal of another agent, or one before it began', () => {
    const elsewhere = event({
      effect: DECISION_EFFECT.DENY,
      agent: 'cursor',
      at: later(1),
    });
    const before = event({ effect: DECISION_EFFECT.DENY, at: later(-1) });
    expect(revokedByRefusal([elsewhere, before], [grant], later(2))).toEqual([]);
  });

  it('ends on its own, and only covers the agent and targets it names', () => {
    const request = { action: 'vercel.deploy-preview', target: 'shop-web' };
    expect(
      allowanceFor([grant], request, { agentName: 'claude-code', now: later(1) }),
    ).toBe(grant);
    expect(
      allowanceFor([grant], request, { agentName: 'cursor', now: later(1) }),
    ).toBeNull();
    expect(
      allowanceFor(
        [grant],
        { ...request, target: 'admin-web' },
        {
          agentName: 'claude-code',
          now: later(1),
        },
      ),
    ).toBeNull();
    expect(
      allowanceFor([grant], request, {
        agentName: 'claude-code',
        now: later(EARNED_DAYS * 24 + 1),
      }),
    ).toBeNull();
  });
});

describe('where grants are kept', () => {
  it('reaches the gate beside what a person allowed, and can be revoked from either door', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-earned-'));
    const grant: Allowance = {
      id: 'ern_y',
      actions: ['npm.install'],
      agents: ['claude-code'],
      targets: ['shop-web'],
      by: AUTOPILOT_BY,
      since: NOW,
      until: later(24),
    };
    await new EarnedAllowances(home).add(grant);
    const gate = new FileAllowances(home);
    expect((await gate.inForce(later(1))).map((each) => each.id)).toEqual(['ern_y']);
    expect(gate.inForceNow(later(1)).map((each) => each.id)).toEqual(['ern_y']);
    expect(await gate.all()).toEqual([]);

    await gate.revoke('ern_y', later(2));
    expect(await gate.inForce(later(3))).toEqual([]);
  });
});

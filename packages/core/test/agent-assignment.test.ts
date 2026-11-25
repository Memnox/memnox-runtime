import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentScopeRole,
  ASSIGNMENT_LEASE_SECONDS_MAX,
  ASSIGNMENT_SCOPE,
  assignmentBlockFrom,
  assignmentStandingFor,
  assignmentStandingNow,
  assignmentStandingOn,
  assignmentsPathFor,
  confirmAssignments,
  DECISION_EFFECT,
  LocalGate,
  markAssignmentsPending,
  readHeldAssignments,
  renewAssignments,
  STANDING,
  type AssignmentBlock,
  type AssignmentClock,
  type HeldAssignments,
  type Policy,
} from '../src/index';

/**
 * Two agents both running Claude Code, with different rules: "Payments release" is strict,
 * "Docs helper" is relaxed. A rule written for one agent must reach its installs and no
 * other, and anything less than a fresh, unambiguous assignment must fail closed.
 */

const STRICT = 'prof-payments';
const RELAXED = 'prof-docs';

const strictAsksBeforeDeploy: Policy = {
  name: 'payments-asks-before-deploy',
  match: { actions: ['deploy.*'], roles: [agentScopeRole(STRICT)] },
  decision: { effect: DECISION_EFFECT.ASK, reason: 'payments deploys need a person' },
};
const strictRefusesProdDelete: Policy = {
  name: 'payments-never-deletes-prod',
  match: { actions: ['file.delete'], roles: [agentScopeRole(STRICT)] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'payments never deletes' },
};
const relaxedAllowsDeploy: Policy = {
  name: 'docs-may-deploy',
  match: { actions: ['deploy.*'], roles: [agentScopeRole(RELAXED)] },
  decision: { effect: DECISION_EFFECT.ALLOW, reason: 'docs deploys itself' },
};
const everyoneAsksBeforePush: Policy = {
  name: 'everyone-asks-before-force-push',
  match: { actions: ['git.push-force'] },
  decision: { effect: DECISION_EFFECT.ASK, reason: 'force push needs a person' },
};
/** The old leak: a rule written for a product reaches every install of it. */
const productRule: Policy = {
  name: 'every-claude-code-asks',
  match: { actions: ['net.fetch'], agents: ['claude-code'] },
  decision: { effect: DECISION_EFFECT.ASK, reason: 'product wide' },
};

const RULES = [
  strictAsksBeforeDeploy,
  strictRefusesProdDelete,
  relaxedAllowsDeploy,
  everyoneAsksBeforePush,
  productRule,
];

const block = (
  assignments: AssignmentBlock['assignments'],
  version = 1,
): AssignmentBlock => ({
  version,
  leaseSeconds: ASSIGNMENT_LEASE_SECONDS_MAX,
  assignments,
});

/** One machine running two Claude Code installs under different names, each in its own agent. */
const twoAgentsOneMachine = block([
  { id: 'agt-1', scope: ASSIGNMENT_SCOPE.AGENT, names: ['claude-code'], profile: STRICT },
  {
    id: 'agt-2',
    scope: ASSIGNMENT_SCOPE.AGENT,
    names: ['claude-code-docs'],
    profile: RELAXED,
  },
]);

const T0: AssignmentClock = { wall: 1_800_000_000_000, mono: 5_000_000 };
const later = (ms: number, from: AssignmentClock = T0): AssignmentClock => ({
  wall: from.wall + ms,
  mono: from.mono + ms,
});

const heldAt = (
  given: AssignmentBlock,
  clock: AssignmentClock = T0,
): HeldAssignments => ({
  block: given,
  confirmedAtWall: clock.wall,
  confirmedAtMono: clock.mono,
  highWaterWall: clock.wall,
  since: {},
});

const gateFor = (
  agentName: string,
  held: HeldAssignments | null,
  clock: AssignmentClock = T0,
): LocalGate =>
  new LocalGate(RULES, {
    agentName,
    assignment: assignmentStandingFor(held, agentName, clock),
    now: new Date(clock.wall),
  });

describe('agent scoped rules reach exactly their agent', () => {
  it('holds the strict agent and lets the relaxed one deploy, though both are Claude Code', () => {
    const held = heldAt(twoAgentsOneMachine);
    expect(gateFor('claude-code', held).evaluate({ action: 'deploy.prod' }).effect).toBe(
      DECISION_EFFECT.ASK,
    );
    expect(
      gateFor('claude-code-docs', held).evaluate({ action: 'deploy.prod' }).effect,
    ).toBe(DECISION_EFFECT.ALLOW);
  });

  it('never gives one install the refusal written for the other agent', () => {
    const held = heldAt(twoAgentsOneMachine);
    expect(gateFor('claude-code', held).evaluate({ action: 'file.delete' }).effect).toBe(
      DECISION_EFFECT.DENY,
    );
    expect(
      gateFor('claude-code-docs', held).evaluate({ action: 'file.delete' }).effect,
    ).toBe(DECISION_EFFECT.ALLOW);
  });

  it('applies general rules to every install, whichever agent it is in', () => {
    const held = heldAt(twoAgentsOneMachine);
    for (const name of ['claude-code', 'claude-code-docs', 'codex']) {
      expect(gateFor(name, held).evaluate({ action: 'git.push-force' }).effect).toBe(
        DECISION_EFFECT.ASK,
      );
    }
  });

  it('applies no agent rule to an install in no agent, with no product fallback', () => {
    const held = heldAt(twoAgentsOneMachine);
    const gate = gateFor('codex', held);
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ALLOW);
    expect(gate.evaluate({ action: 'file.delete' }).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('reaches two different products in one agent alike', () => {
    const held = heldAt(
      block([
        {
          id: 'a',
          scope: ASSIGNMENT_SCOPE.AGENT,
          names: ['claude-code'],
          profile: STRICT,
        },
        { id: 'b', scope: ASSIGNMENT_SCOPE.AGENT, names: ['codex'], profile: STRICT },
      ]),
    );
    for (const name of ['claude-code', 'codex']) {
      expect(gateFor(name, held).evaluate({ action: 'deploy.prod' }).effect).toBe(
        DECISION_EFFECT.ASK,
      );
    }
  });

  it('matches the agent under the ledger key the runtime uses too', () => {
    const held = heldAt(
      block([
        {
          id: 'a',
          scope: ASSIGNMENT_SCOPE.AGENT,
          names: ['agt_cursor'],
          profile: STRICT,
        },
      ]),
    );
    expect(gateFor('cursor', held).evaluate({ action: 'deploy.prod' }).effect).toBe(
      DECISION_EFFECT.ASK,
    );
  });
});

describe('precedence between an install and its whole machine', () => {
  const mixed = block([
    { id: 'm', scope: ASSIGNMENT_SCOPE.MACHINE, profile: RELAXED },
    { id: 'a', scope: ASSIGNMENT_SCOPE.AGENT, names: ['claude-code'], profile: STRICT },
  ]);

  it("prefers the install's own assignment over the machine wide one", () => {
    const standing = assignmentStandingFor(heldAt(mixed), 'claude-code', T0);
    expect(standing).toMatchObject({ state: STANDING.CURRENT, profile: STRICT });
  });

  it('gives an install with none of its own the machine wide agent', () => {
    const standing = assignmentStandingFor(heldAt(mixed), 'gemini-cli', T0);
    expect(standing).toMatchObject({ state: STANDING.CURRENT, profile: RELAXED });
  });

  it('trusts neither agent when two claim one install, and holds what either covers', () => {
    const contested = heldAt(
      block([
        {
          id: 'a',
          scope: ASSIGNMENT_SCOPE.AGENT,
          names: ['claude-code'],
          profile: STRICT,
        },
        {
          id: 'b',
          scope: ASSIGNMENT_SCOPE.AGENT,
          names: ['claude-code'],
          profile: RELAXED,
        },
      ]),
    );
    expect(assignmentStandingFor(contested, 'claude-code', T0).state).toBe(
      STANDING.AMBIGUOUS,
    );
    // The relaxed agent's allow is never trusted while the conflict stands.
    const verdict = gateFor('claude-code', contested).evaluate({ action: 'deploy.prod' });
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.signals).toContain('assignment:ambiguous');
  });
});

describe('a lease that is not fresh fails closed', () => {
  const relaxedOnly = block([
    { id: 'a', scope: ASSIGNMENT_SCOPE.AGENT, names: ['claude-code'], profile: RELAXED },
  ]);

  it('holds an action an agent rule covers once the lease runs out', () => {
    const held = heldAt(relaxedOnly);
    const after = later(ASSIGNMENT_LEASE_SECONDS_MAX * 1000);
    const verdict = gateFor('claude-code', held, after).evaluate({
      action: 'deploy.prod',
    });
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.signals).toContain('assignment:expired');
  });

  it('keeps refusing what an agent rule refuses, rather than relaxing it to a question', () => {
    const held = heldAt(heldAt(twoAgentsOneMachine).block);
    const after = later(ASSIGNMENT_LEASE_SECONDS_MAX * 1000);
    expect(
      gateFor('claude-code-docs', held, after).evaluate({ action: 'file.delete' }).effect,
    ).toBe(DECISION_EFFECT.DENY);
  });

  it('leaves actions no agent rule covers alone', () => {
    const held = heldAt(relaxedOnly);
    const after = later(ASSIGNMENT_LEASE_SECONDS_MAX * 1000);
    expect(
      gateFor('claude-code', held, after).evaluate({ action: 'file.read' }).effect,
    ).toBe(DECISION_EFFECT.ALLOW);
  });

  it('never lets a bundle ask for a lease longer than the ceiling', () => {
    const held = heldAt({ ...relaxedOnly, leaseSeconds: 24 * 60 * 60 });
    const standing = assignmentStandingFor(
      held,
      'claude-code',
      later(ASSIGNMENT_LEASE_SECONDS_MAX * 1000),
    );
    expect(standing.state).toBe(STANDING.EXPIRED);
  });

  it('cannot be lengthened by turning the wall clock back', () => {
    const held = heldAt(relaxedOnly);
    const rolledBack = { wall: T0.wall - 60 * 60 * 1000, mono: T0.mono + 1000 };
    expect(assignmentStandingFor(held, 'claude-code', rolledBack).state).toBe(
      STANDING.EXPIRED,
    );
  });

  it('expires on the monotonic clock even when the wall clock stands still', () => {
    const held = heldAt(relaxedOnly);
    const frozenWall = {
      wall: T0.wall + 1000,
      mono: T0.mono + ASSIGNMENT_LEASE_SECONDS_MAX * 1000,
    };
    expect(assignmentStandingFor(held, 'claude-code', frozenWall).state).toBe(
      STANDING.EXPIRED,
    );
  });

  it('expires on the wall clock across a sleep the monotonic clock did not count', () => {
    const held = heldAt(relaxedOnly);
    const slept = {
      wall: T0.wall + ASSIGNMENT_LEASE_SECONDS_MAX * 1000,
      mono: T0.mono + 1000,
    };
    expect(assignmentStandingFor(held, 'claude-code', slept).state).toBe(
      STANDING.EXPIRED,
    );
  });

  it('counts a restart as unconfirmed until the next pull', () => {
    const held = heldAt(relaxedOnly);
    const rebooted = { wall: T0.wall + 1000, mono: 10 };
    expect(assignmentStandingFor(held, 'claude-code', rebooted).state).toBe(
      STANDING.UNCONFIRMED,
    );
  });

  it('counts a machine that never heard from the cloud as unconfirmed', () => {
    expect(assignmentStandingFor(null, 'claude-code', T0).state).toBe(
      STANDING.UNCONFIRMED,
    );
    expect(gateFor('claude-code', null).evaluate({ action: 'deploy.prod' }).effect).toBe(
      DECISION_EFFECT.ASK,
    );
  });

  it('does not let a person allowance answer a hold for an unconfirmed agent', () => {
    const gate = new LocalGate(RULES, {
      agentName: 'claude-code',
      assignment: assignmentStandingFor(null, 'claude-code', T0),
      now: new Date(T0.wall),
      allowances: [
        {
          id: 'al-1',
          actions: ['deploy.*'],
          by: 'person',
          since: new Date(T0.wall - 1000).toISOString(),
          until: new Date(T0.wall + 60_000).toISOString(),
        },
      ],
    });
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ASK);
  });
});

describe('moving an install between agents', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-assign-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const inRelaxed = block(
    [
      {
        id: 'agt-1',
        scope: ASSIGNMENT_SCOPE.AGENT,
        names: ['claude-code'],
        profile: RELAXED,
      },
    ],
    1,
  );
  const inStrict = block(
    [
      {
        id: 'agt-1',
        scope: ASSIGNMENT_SCOPE.AGENT,
        names: ['claude-code'],
        profile: STRICT,
      },
    ],
    2,
  );

  it('is stale the moment the cloud says a pull is due, and fresh once it lands', async () => {
    await confirmAssignments(home, inRelaxed, T0);
    await markAssignmentsPending(home, later(1000));
    const pending = await assignmentStandingOn(home, 'claude-code', later(2000));
    expect(pending.state).toBe(STANDING.STALE);

    await confirmAssignments(home, inStrict, later(3000));
    const moved = await assignmentStandingOn(home, 'claude-code', later(4000));
    expect(moved).toMatchObject({ state: STANDING.CURRENT, profile: STRICT, version: 2 });
  });

  it("holds the relaxed agent's allow while stale, then applies the strict agent's rules", async () => {
    await confirmAssignments(home, inRelaxed, T0);
    await markAssignmentsPending(home, later(1000));
    const stale = new LocalGate(RULES, {
      agentName: 'claude-code',
      assignment: assignmentStandingNow(home, 'claude-code', () => later(2000)),
    });
    expect(stale.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ASK);

    await confirmAssignments(home, inStrict, later(3000));
    expect(stale.evaluate({ action: 'file.delete' }).effect).toBe(DECISION_EFFECT.DENY);
  });

  it('drops permission a person gave under the agent the install left', async () => {
    await confirmAssignments(home, inRelaxed, T0);
    const given = new Date(T0.wall + 500).toISOString();
    await confirmAssignments(home, inStrict, later(1000));
    const standing = await assignmentStandingOn(home, 'claude-code', later(2000));
    const gate = new LocalGate(RULES, {
      agentName: 'claude-code',
      assignment: standing,
      now: new Date(later(2000).wall),
      allowances: [
        {
          id: 'old',
          actions: ['deploy.*'],
          by: 'person',
          since: given,
          until: new Date(T0.wall + 60 * 60_000).toISOString(),
        },
      ],
    });
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ASK);
  });

  it('keeps permission given after the move', async () => {
    await confirmAssignments(home, inStrict, T0);
    const standing = await assignmentStandingOn(home, 'claude-code', later(2000));
    const gate = new LocalGate(RULES, {
      agentName: 'claude-code',
      assignment: standing,
      now: new Date(later(2000).wall),
      allowances: [
        {
          id: 'new',
          actions: ['deploy.*'],
          by: 'person',
          since: new Date(later(1000).wall).toISOString(),
          until: new Date(T0.wall + 60 * 60_000).toISOString(),
        },
      ],
    });
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('renews only the version it holds, and clears a pending mark when it does', async () => {
    await confirmAssignments(home, inRelaxed, T0);
    await markAssignmentsPending(home, later(1000));
    expect(await renewAssignments(home, 99, later(2000))).toBe(false);
    expect(await renewAssignments(home, 1, later(2000))).toBe(true);
    expect((await assignmentStandingOn(home, 'claude-code', later(3000))).state).toBe(
      STANDING.CURRENT,
    );
  });

  it('catches a clock turned back below what a gate already saw', async () => {
    await confirmAssignments(home, inRelaxed, T0);
    // A gate sees the clock well past the confirmation and writes its mark.
    await assignmentStandingOn(home, 'claude-code', later(60_000));
    const turnedBack = { wall: T0.wall + 10_000, mono: T0.mono + 61_000 };
    expect((await assignmentStandingOn(home, 'claude-code', turnedBack)).state).toBe(
      STANDING.EXPIRED,
    );
  });

  it('treats a torn or forged file as nothing held', async () => {
    await mkdir(dirname(assignmentsPathFor(home)), { recursive: true });
    await writeFile(assignmentsPathFor(home), '{"block":{"version":"x"}}');
    expect(await readHeldAssignments(home)).toBeNull();
    expect((await assignmentStandingOn(home, 'claude-code', T0)).state).toBe(
      STANDING.UNCONFIRMED,
    );
  });
});

describe('reading a block from the network', () => {
  it('reads the agent ids Memnox Cloud makes, underscores included', () => {
    const read = assignmentBlockFrom({
      version: 1,
      leaseSeconds: 600,
      assignments: [
        {
          id: 'agent:agt_claude-code',
          scope: 'agent',
          names: ['agt_claude-code'],
          profile: 'prf_3f2a',
        },
      ],
    });
    expect(read?.assignments[0]?.profile).toBe('prf_3f2a');
  });

  it('refuses the whole block when one entry does not read', () => {
    expect(
      assignmentBlockFrom({
        version: 3,
        leaseSeconds: 600,
        assignments: [
          { id: 'a', scope: 'agent', names: ['claude-code'], profile: STRICT },
          { id: 'b', scope: 'agent', profile: RELAXED },
        ],
      }),
    ).toBeNull();
  });

  it('refuses a profile id that could name a path or a pattern', () => {
    expect(
      assignmentBlockFrom({
        version: 1,
        leaseSeconds: 600,
        assignments: [{ id: 'a', scope: 'machine', profile: '../*' }],
      }),
    ).toBeNull();
  });
});

describe('a gate that never reads assignments', () => {
  it('applies no agent rule at all, as the daemon gate with no install identity does', () => {
    const gate = new LocalGate(RULES, { agentName: 'agent' });
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ALLOW);
    expect(gate.evaluate({ action: 'file.delete' }).effect).toBe(DECISION_EFFECT.ALLOW);
    expect(gate.evaluate({ action: 'git.push-force' }).effect).toBe(DECISION_EFFECT.ASK);
  });
});

describe('a gate serving every agent on a computer', () => {
  it('holds what any agent rule covers, never trusting an agent allow it cannot attribute', () => {
    const gate = new LocalGate(RULES, {
      agentName: 'agent',
      assignment: { state: STANDING.UNCONFIRMED, reason: 'it cannot tell agents apart' },
    });
    expect(gate.evaluate({ action: 'deploy.prod' }).effect).toBe(DECISION_EFFECT.ASK);
    expect(gate.evaluate({ action: 'file.delete' }).effect).toBe(DECISION_EFFECT.DENY);
    expect(gate.evaluate({ action: 'file.read' }).effect).toBe(DECISION_EFFECT.ALLOW);
  });
});

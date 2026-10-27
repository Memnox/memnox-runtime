import { join } from 'node:path';

import {
  activitySince,
  discoverDefinitions,
  ENFORCEMENT_MODE,
  fleetBudgets,
  goesToWorkspace,
  loadOrCreateConfig,
  MEMNOX_HOME,
  NodeFindingsStore,
  NodeMachineReader,
  NodeSnapshotStore,
  PendingApprovals,
  plainAsk,
  redactSecrets,
  protectionStopped,
  markRevoked,
  readAccount,
  readAcceptedSkills,
  readBudgets,
  readJsonFile,
  reviewSkills,
  SqliteEventStore,
  windowHoursOf,
  writeFleetSpend,
  type Account,
  type Budget,
  type EnforcementMode,
  type PendingApproval,
  type SkillFinding,
} from '@memnox/core';

import { CLI_VERSION } from '../defaults';
import { kindOf, listRecords, sponsoredBy } from '../agents/onboarding';
import { orgPolicyPath, PULL_OUTCOME, pullBundle, type PullResult } from './bundle';
import { callCloud, CloudUnreachable } from './client';
import {
  applyAnswers,
  applyApprovalRoute,
  applyMode,
  type HeartbeatAnswer,
} from './heartbeat-reply';
import { pullMemory, type MemoryPull } from './memory';
import type { HeartbeatBeats } from './beat';
import { BACKOFF_MS, HEARTBEAT_MS, waitUntilDue } from './pace';
import {
  pushCensus,
  pushEvents,
  pushFindings,
  pushSkills,
  pushDecisions,
  pushProtection,
  PUSH_OUTCOME,
  type PushResult,
} from './push';

/**
 * One pass: pull the rules, send what happened, say you are alive. Pull first, so a
 * machine given a stricter rule set is governed by it before it reports anything.
 */

export interface Pass {
  pull?: PullResult;
  /** What the workspace has settled, kept for the hooks and the session tools. */
  memory?: MemoryPull;
  push?: PushResult;
  /** What this machine can do, sent once per scan. Absent when no scan is kept. */
  census?: PushResult;
  /** What that scan found wrong. Absent when `doctor` has never run here. */
  findings?: PushResult;
  /** Skills the agents here wrote for themselves. Absent when none changed. */
  skills?: PushResult;
  /** Rules a person decided here, offered to the team as proposals. */
  decisions?: PushResult;
  /** Somebody stopping or starting protection here, which the team has to see. */
  protection?: PushResult;
  /** Set when nothing could be reached, which is not an error worth printing. */
  unreachable?: boolean;
  /** True once the credential is gone: stop until somebody logs in again. */
  revoked?: boolean;
}

type SendKey = 'push' | 'census' | 'findings' | 'skills' | 'decisions' | 'protection';

interface Send {
  key: SendKey;
  run: () => Promise<PushResult>;
}

/** What the control plane may say back about a call this machine is holding. */

interface HeartbeatReply {
  answers?: HeartbeatAnswer[];
  fleetSpend?: { name: string; spent: number }[];
  /** What the workspace has this machine set to. Applied only when it changes. */
  mode?: string;
  /** Where the workspace wants questions to go: `session`, `dm` or `both`. Likewise. */
  approvals?: string;
}

/** What one beat reports, gathered before the call so the call is only the call. */
interface BeatState {
  running: EnforcementMode;
  applied: string | undefined;
  holding: PendingApproval[];
  /** Budgets counted across the workspace; a machine budget needs no round trip. */
  asking: Budget[];
}

/** What one pass does. The daemon's early passes send, and leave the pulls to the minute or a beat. */
interface PassOptions {
  /** Pull the rules and the memory. Only a pass due on the minute, or one a relay beat brought, needs to. */
  pull: boolean;
}

const FULL_PASS: PassOptions = { pull: true };

interface LoopSeams {
  sleep?: (ms: number) => Promise<void>;
  pass?: (home: string, options: PassOptions) => Promise<Pass>;
  log?: (message: string) => void;
  /** Injected so a test states what is held rather than writing files to say it. */
  holding?: (home: string) => Promise<readonly string[]>;
  /** The relay's beats; absent, or with no link up, a held call is polled every two seconds. */
  beats?: HeartbeatBeats;
  /** Whether an agent here did something since then, so it is sent at once. */
  active?: (home: string, since: number) => Promise<boolean>;
}

export async function onePass(
  home: string,
  options: PassOptions = FULL_PASS,
): Promise<Pass> {
  const account = await readAccount(home);
  // Not logged in: no call is made at all, which is the whole promise.
  if (account === null) return {};
  // Removed from its workspace: a revoked machine is never restored, so nothing is sent.
  if (account.revokedAt !== undefined) return { revoked: true };

  try {
    const pass = await passFor(home, account, options);
    if (pass.revoked === true) await markRevoked(home, new Date());
    return pass;
  } catch (err) {
    if (err instanceof CloudUnreachable) return { unreachable: true };
    throw err;
  }
}

/**
 * The loop the daemon runs. Stops on a revocation and on nothing else, because an
 * unreachable control plane is usually a closed laptop lid and is waited out.
 */
export async function syncLoop(
  home: string,
  running: () => boolean,
  seams: LoopSeams = {},
): Promise<void> {
  const beats = seams.beats;
  const sleep = seams.sleep ?? (beats === undefined ? sleepFor : (ms) => beats.sleep(ms));
  const pass = seams.pass ?? onePass;
  const holding = seams.holding ?? heldHere;

  // Counted in the time this loop waited rather than off a clock, so the minute is the
  // same minute however the waits are served.
  let sincePull: number | undefined;
  // A beat means a rule, a condition or an answer changed, so the pass it brings pulls whatever the minute says.
  let beaten = false;
  while (running()) {
    const passStarted = Date.now();
    const pulling = beaten || sincePull === undefined || sincePull >= HEARTBEAT_MS;
    beaten = false;
    // Read before the pass, so a call raised during it still counts as not yet carried up.
    const carried = new Set(await holding(home));
    let result: Pass;
    try {
      result = await pass(home, { pull: pulling });
    } catch (err) {
      // A pass that throws must not end the daemon; the gate is what matters.
      seams.log?.(err instanceof Error ? err.message : String(err));
      await sleep(BACKOFF_MS);
      // A quarter of an hour away, so the pass after it pulls whatever changed meanwhile, a beat included.
      beats?.take();
      sincePull = undefined;
      continue;
    }
    if (result.revoked === true) {
      seams.log?.('this machine has been revoked; the rules it holds still apply');
      return;
    }
    // Waited out whole, because polling fast for an answer with nowhere to come from changes nothing.
    if (result.unreachable === true) {
      await sleep(BACKOFF_MS);
      beats?.take();
      sincePull = undefined;
      continue;
    }
    if (pulling) sincePull = 0;
    const due = await waitUntilDue({
      home,
      idleMs: HEARTBEAT_MS - (sincePull ?? 0),
      since: passStarted,
      sleep,
      holding,
      active: seams.active ?? activitySince,
      carried,
      ...(beats === undefined
        ? {}
        : { relayed: () => beats.linked(), beaten: () => beats.take() }),
    });
    sincePull = (sincePull ?? 0) + due.waited;
    beaten = due.beaten;
  }
}

async function passFor(
  home: string,
  account: Account,
  options: PassOptions,
): Promise<Pass> {
  const pass: Pass = {};
  if (options.pull) {
    const pull = await pullBundle(home, account, await heldHash(home));
    if (pull.outcome === PULL_OUTCOME.REVOKED) return { pull, revoked: true };
    pass.pull = pull;
    // After the rules, since a rule governs and a memory only informs.
    pass.memory = await pullMemory(home, account);
  }
  for (const send of sendsFor(home, account)) {
    const result = await send.run();
    pass[send.key] = result;
    if (result.outcome === PUSH_OUTCOME.REVOKED) return { ...pass, revoked: true };
  }
  await beat(home, account, pass.pull);
  return pass;
}

/** Most time-critical first: the actions somebody is waiting on, then what is as true in a minute. */
function sendsFor(home: string, account: Account): Send[] {
  const kept = join(home, MEMNOX_HOME);
  return [
    { key: 'push', run: () => pushLedger(home, account) },
    {
      key: 'census',
      run: async () =>
        pushCensus(home, account, await new NodeSnapshotStore(kept).latest()),
    },
    {
      key: 'findings',
      run: async () =>
        pushFindings(home, account, await new NodeFindingsStore(kept).latest()),
    },
    // Reviewed every pass rather than read from a snapshot, because it is cheap and must be current.
    {
      key: 'skills',
      run: async () => pushSkills(home, account, await skillReview(home)),
    },
    { key: 'decisions', run: () => pushDecisions(home, account) },
    { key: 'protection', run: () => pushProtection(home, account) },
  ];
}

async function pushLedger(home: string, account: Account): Promise<PushResult> {
  const ledger = SqliteEventStore.forHome(home);
  try {
    return await pushEvents(home, account, ledger);
  } finally {
    ledger.close();
  }
}

/**
 * What the agents here taught themselves and what somebody installed, against what
 * anybody accepted. A failure reports nothing, so the heartbeat still beats.
 */
async function skillReview(
  home: string,
): Promise<{ findings: SkillFinding[]; takenAt: string } | null> {
  try {
    const found = await discoverDefinitions(new NodeMachineReader());
    const accepted = await readAcceptedSkills(home);
    return {
      findings: reviewSkills(found, accepted),
      takenAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * What this machine runs, which bundle it applied, and the calls it is holding, with
 * whatever came back. The only per-machine round trip, so remote answers ride on it.
 */
async function beat(
  home: string,
  account: Account,
  pull: PullResult | undefined,
): Promise<void> {
  const approvals = new PendingApprovals(home);
  const moment = new Date().toISOString();
  const state = await readBeatState({ home, pull, approvals, moment });

  const response = await callCloud<HeartbeatReply>({
    baseUrl: account.baseUrl,
    path: `/v1/workspaces/${account.workspaceId}/machines/${account.machineId}/heartbeat`,
    method: 'POST',
    token: account.token,
    body: await heartbeatBody(home, account, state),
  });

  await applyAnswers(home, approvals, response.body?.answers ?? [], moment);
  await applyMode({ home, account, running: state.running, told: response.body?.mode });
  await applyApprovalRoute(home, response.body?.approvals);

  // Written even when the reply is empty, so a fleet count nobody can confirm falls back to this machine's.
  if (state.asking.length > 0) {
    await writeFleetSpend(
      home,
      (response.body?.fleetSpend ?? []).map((each) => ({ ...each, at: moment })),
    );
  }
}

/** Off while `memnox stop` holds, since that is what every seam here is running. */
async function runningMode(home: string): Promise<EnforcementMode> {
  if (await protectionStopped(home)) return ENFORCEMENT_MODE.OFF;
  return (await loadOrCreateConfig(home)).mode;
}

async function readBeatState(input: {
  home: string;
  /** Absent on a pass that pulled nothing, which reports the bundle already held. */
  pull: PullResult | undefined;
  approvals: PendingApprovals;
  moment: string;
}): Promise<BeatState> {
  const { home, pull } = input;
  return {
    running: await runningMode(home),
    applied:
      pull !== undefined && pull.outcome === PULL_OUTCOME.APPLIED
        ? pull.hash
        : await heldHash(home),
    // A question somebody asked to keep in the session never leaves the machine.
    holding: (await input.approvals.list(input.moment)).filter(goesToWorkspace),
    asking: fleetBudgets(await readBudgets(home)).filter(
      (budget) => windowHoursOf(budget) > 0,
    ),
  };
}

async function heartbeatBody(
  home: string,
  account: Account,
  state: BeatState,
): Promise<Record<string, unknown>> {
  return {
    // Every beat, so the fleet page shows what runs now rather than what was installed.
    runtimeVersion: CLI_VERSION,
    ...(state.applied === undefined ? {} : { bundleHashApplied: state.applied }),
    // The mode applied here, which somebody at this box may have changed from the workspace's.
    mode: state.running,
    budgets: state.asking.map((budget) => ({
      name: budget.name,
      actions: budget.actions,
      windowHours: windowHoursOf(budget),
    })),
    agents: await enrolledAgents(home, account),
    holding: state.holding.map(describeHeld),
  };
}

/**
 * Which agent each enrolled principal is for, so the control plane can join a typed
 * name to its id. This enrolment's own records only, since a moved or re-enrolled machine keeps the old.
 */
async function enrolledAgents(
  home: string,
  account: Account,
): Promise<Record<string, unknown>[]> {
  return (await listRecords(home))
    .filter((record) => sponsoredBy(record, account))
    .map((record) => ({
      machineId: record.machineId,
      agentId: record.agentId,
      agentKind: kindOf(record),
    }));
}

/** Names only: the operation and what it is about, never the arguments. */
function describeHeld(each: PendingApproval): Record<string, unknown> {
  // Raised by a shell wrapper, a call has no words written yet, so they are written here.
  const plain = each.plain ?? plainAsk(each.request);
  // Masked again here, since a question raised before masking existed carries its words unmasked.
  return {
    summary: redactSecrets(plain.summary),
    why: redactSecrets(plain.why),
    ...(plain.task === undefined ? {} : { task: redactSecrets(plain.task) }),
    ...(each.request.class === undefined ? {} : { class: each.request.class }),
    id: each.id,
    agent: each.request.agent,
    operation: each.request.operation,
    reason: redactSecrets(each.request.reason),
    askedAt: each.askedAt,
    expiresAt: each.expiresAt,
    ...(each.request.target === undefined
      ? {}
      : { target: redactSecrets(each.request.target) }),
    // The rule by name, so the workspace can put the question to that rule's approvers.
    ...(each.request.rule === undefined ? {} : { ruleId: each.request.rule }),
  };
}

/** The hash of what is already on disk, so an unchanged bundle costs one 304. */
async function heldHash(home: string): Promise<string | undefined> {
  const document = await readJsonFile<{ bundleHash?: string }>(orgPolicyPath(home));
  return document?.bundleHash;
}

/** The calls this machine is stopped on. Local, so it costs no request to ask. */
async function heldHere(home: string): Promise<readonly string[]> {
  try {
    return (await new PendingApprovals(home).list(new Date().toISOString())).map(
      (each) => each.id,
    );
  } catch {
    // No queue is the same answer as an empty one, and neither is worth a fast loop.
    return [];
  }
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

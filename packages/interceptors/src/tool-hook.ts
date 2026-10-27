import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CloudActions,
  configPathFor,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  FIRST_RUN_MODE,
  describeAlternative,
  MEMNOX_HOME,
  NodeSnapshotStore,
  openLedger,
  overlaysInForce,
  parseConfig,
  protectionStopped,
  provenanceOf,
  TOOL_CLASS,
  UNNAMED_SESSION,
  type EnforcementMode,
  type EventSink,
  FileGrants,
  grantSubjectFor,
  ANSWER_PLACE,
  holdInChat,
  HOLD_ANSWER,
  pairedCanAnswer,
  openQuestionFor,
  PendingApprovals,
  readApprovalRoute,
  SessionTasks,
  voiceListening,
  waitForAnswer,
  type AnswerPlace,
  type ApprovalRoute,
  type ChatQuestion,
  type PendingApproval,
  toolDeclarations,
  type SharedActions,
  type ToolDeclarations,
} from '@memnox/core';

import { HookAuthorizer } from './hook-authorizer';
import { claimedElsewhere } from './mcp-claims';
import { containmentFor } from './containment-loader';
import { withinSession } from './within-session';
import { readHookConfig } from './hook-config';
import { loadHookGate } from './hook-gate-loader';
import { toolCallOf, type ToolCall } from './tool-calls';
import { reportToDaemon } from './daemon-client';
import {
  isWorthRecording,
  putsQuestion,
  refusedUnasked,
  ruleOnTool,
  toolEventFor,
  toolReply,
  type ToolReply,
  type ToolRuling,
} from './tool-policy';

/**
 * The editor hook's policy half, as one process sees it: the rules the registry names,
 * the machine's mode from `config.toml`, the verdict in the host's words, and one row.
 * No daemon round trip, because the verdict needs the rule's name and the arguments.
 */

/** Who the hook speaks for and where, read once where the process starts. */
export interface ToolHookContext {
  home: string;
  /** The agent the hook's command names, or the one `memnox run` set. */
  agent: string;
  /** The session `memnox run` set, which a row is filed under where there is one. */
  runSession: string | undefined;
  env: NodeJS.ProcessEnv;
  /** True where the host will show a person the question an `ask` puts. */
  personThere: boolean;
  now: () => Date;
}

/** Injected by tests; each falls back to what the process would build for itself. */
export interface ToolHookSeams {
  authorizer?: HookAuthorizer;
  /** The workspace's register of outward actions, so a test needs no control plane. */
  actions?: SharedActions;
  mode?: EnforcementMode;
  /** Null records nothing. */
  sink?: EventSink | null;
  route?: ApprovalRoute;
  declared?: ToolDeclarations;
  /** Whether the Mac voice is listening, so a held question waits for a spoken answer. */
  voiceThere?: () => Promise<boolean>;
  voiceWaitMs?: number;
  /** Whether a paired phone may answer, so a held question opens no picker it could not close. */
  pairedThere?: () => Promise<boolean>;
}

/**
 * How long a held call waits for the voice to put it and Touch ID to sign the answer, under
 * the minute the host gives a hook by default, so a spoken yes lets the call straight through.
 */
const VOICE_ANSWER_WAIT_MS = 50_000;

/** What the hook decided, and what it says to the host, or null for no reply. */
export interface ToolAnswer {
  call: ToolCall;
  ruling: ToolRuling;
  reply: ToolReply | null;
  /** True where the host puts the question to a person, whose yes the tool running is. */
  asked: boolean;
}

/**
 * The mode `memnox protect --enforce` wrote, read and never created, and off while
 * `memnox stop` holds, since a stop is off with the mode kept for `start` to return to.
 */
export async function readMachineMode(home: string): Promise<EnforcementMode> {
  if (await protectionStopped(home)) return ENFORCEMENT_MODE.OFF;
  let raw: string;
  try {
    raw = await readFile(configPathFor(home), 'utf8');
  } catch (err) {
    // No settings yet is the first run, which observes before it enforces.
    if (isMissing(err)) return FIRST_RUN_MODE;
    // There and unreadable is not a first run, and a firewall that cannot read its rules fails closed.
    return ENFORCEMENT_MODE.ENFORCE;
  }
  // The first run writes the mode, so settings without one were emptied or mangled after it.
  if (!MODE_LINE.test(raw)) return ENFORCEMENT_MODE.ENFORCE;
  return parseConfig(raw).mode;
}

const MODE_LINE = /^\s*mode\s*=/m;

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** What the last scan heard each MCP server say about its tools, since a hook sees only names. */
export async function declaredTools(home: string): Promise<ToolDeclarations> {
  const snapshot = await new NodeSnapshotStore(join(home, MEMNOX_HOME)).latest();
  return toolDeclarations(snapshot);
}

/** Rules on the tool call in this payload, and records it. Null where there is none. */
export async function answerToolCall(
  payload: unknown,
  context: ToolHookContext,
  seams: ToolHookSeams = {},
): Promise<ToolAnswer | null> {
  const declared = seams.declared ?? (await declaredTools(context.home));
  const call = toolCallOf(payload, context.home, declared);
  if (call === null) return null;
  const mode = seams.mode ?? (await readMachineMode(context.home));
  // Off means nothing is ruled on or recorded, which is what somebody turning it off wants.
  if (mode === ENFORCEMENT_MODE.OFF) return null;
  const route = seams.route ?? (await readApprovalRoute(context.home));

  const authorizer = seams.authorizer ?? (await authorizerFor(context, call.sessionId));
  const ruled = await ruleOnTool(call, {
    authorizer,
    mode,
    env: context.env,
    home: context.home,
  });
  const sessionId = sessionFor(call, context);
  const granted = await withSessionGrant(ruled, sessionId, context.home);
  const answered = await withChatAnswer(granted, sessionId, context);
  const ruling = await withDuplicateCheck(answered, call, { sessionId, context, seams });
  // The breaker counts drift for a session only the hooks see, which reports nothing else.
  if (ruling.effect === DECISION_EFFECT.ALLOW && ruling.outOfScope === true) {
    await reportToDaemon(context.home, {
      action: ruling.action,
      ...(ruling.target === undefined ? {} : { target: ruling.target }),
      sessionId: sessionFor(call, context),
      outOfScope: true,
      driftOnly: true,
    }).catch(() => null);
  }
  if (isWorthRecording(ruling)) {
    const sink = seams.sink === undefined ? openLedger(context.home) : seams.sink;
    await keep(sink, call, ruling, context);
  }
  const asked = putsQuestion(call, ruling, context.personThere);
  const raised =
    ruling.effect === DECISION_EFFECT.ASK && !asked
      ? await heldFor(ruling, { call, sessionId }, route, context)
      : null;
  const places = raised === null ? [] : await answerPlaces(context, seams);
  const spoken =
    raised !== null && places.includes(ANSWER_PLACE.MAC)
      ? await spokenAnswer(raised, ruling, { sessionId, context, seams })
      : null;
  if (spoken !== null) {
    return { call, ruling: spoken, reply: toolReply(call, spoken, false), asked: false };
  }
  const held = raised === null ? null : await alsoOn(raised, places, context.home);
  return {
    call,
    ruling,
    reply: toolReply(call, ruling, context.personThere, held),
    asked,
  };
}

/** Where beside the session this question can be answered: the listening Mac app, a paired phone. */
async function answerPlaces(
  context: ToolHookContext,
  seams: ToolHookSeams,
): Promise<AnswerPlace[]> {
  const voice =
    seams.voiceThere ?? ((): Promise<boolean> => voiceListening(context.home));
  const paired =
    seams.pairedThere ?? ((): Promise<boolean> => pairedCanAnswer(context.home));
  const [mac, phone] = await Promise.all([
    voice().catch(() => false),
    paired().catch(() => false),
  ]);
  return [...(mac ? [ANSWER_PLACE.MAC] : []), ...(phone ? [ANSWER_PLACE.PAIRED] : [])];
}

/**
 * The answer said on the Mac while the call waited, or null where nobody answered in time.
 * A spoken yes lets the call straight through, so nobody waits for the turn to end.
 */
async function spokenAnswer(
  held: PendingApproval,
  ruling: ToolRuling,
  where: { sessionId: string; context: ToolHookContext; seams: ToolHookSeams },
): Promise<ToolRuling | null> {
  const { sessionId, context, seams } = where;
  const answer = await waitForAnswer({
    approvals: new PendingApprovals(context.home),
    id: held.id,
    // Real time on purpose: a wait is wall clock, whatever clock the ruling was made on.
    deadline: Date.now() + (seams.voiceWaitMs ?? VOICE_ANSWER_WAIT_MS),
  });
  if (answer === null) return null;
  const after = await withChatAnswer(ruling, sessionId, context);
  return after.effect === DECISION_EFFECT.ASK ? null : after;
}

/**
 * The question marked with where else it can be answered, so the agent opens no picker: only a
 * click closes one, and an answer on the Mac or a phone would leave it on screen asking.
 */
async function alsoOn(
  held: PendingApproval,
  places: readonly AnswerPlace[],
  home: string,
): Promise<PendingApproval> {
  if (places.length === 0) return held;
  const approvals = new PendingApprovals(home);
  // Read again, so an answer landing during the wait is not written over.
  const latest = (await approvals.read(held.id).catch(() => null)) ?? held;
  const marked: PendingApproval = { ...latest, alsoOn: [...places] };
  await approvals.keep(marked).catch(() => undefined);
  return marked;
}

/** Best effort and false on any failure, since a call nobody could place asks for the fingerprint. */
async function staysInSession(
  call: ToolCall,
  context: ToolHookContext,
): Promise<boolean> {
  try {
    const containment = await containmentFor({
      home: context.home,
      env: context.env,
      cwd: call.cwd ?? process.cwd(),
      now: context.now(),
      agent: context.agent,
    });
    return withinSession(call, containment, context.env);
  } catch {
    return false;
  }
}

/** The question written down for a person, or null where it could not be, which refuses as before. */
async function heldFor(
  ruling: ToolRuling,
  { call, sessionId }: { call: ToolCall; sessionId: string },
  route: ApprovalRoute,
  context: ToolHookContext,
): Promise<PendingApproval | null> {
  const question = {
    ...questionOf(ruling, sessionId, context.agent),
    ...(await taskOf(context.home, sessionId)),
    withinSession: await staysInSession(call, context),
  };
  return holdInChat(
    new PendingApprovals(context.home),
    question,
    route,
    context.now().toISOString(),
  ).catch(() => null);
}

/**
 * The retry after a person answered a held question: a yes lets it through, "for this
 * session" stops the asking, and a no refuses it with their word rather than a rule's.
 */
async function withChatAnswer(
  ruling: ToolRuling,
  sessionId: string,
  context: ToolHookContext,
): Promise<ToolRuling> {
  if (ruling.effect !== DECISION_EFFECT.ASK) return ruling;
  const approvals = new PendingApprovals(context.home);
  const question = questionOf(ruling, sessionId, context.agent);
  const held = await openQuestionFor(
    approvals,
    question,
    context.now().toISOString(),
  ).catch(() => null);
  if (held?.answer === undefined) return ruling;
  await approvals.clear(held.id).catch(() => undefined);
  const by = held.answeredBy ?? 'a person';
  if (held.answer === HOLD_ANSWER.SESSION)
    await grantSession(ruling, sessionId, context.home);
  if (held.answer === HOLD_ANSWER.ONCE || held.answer === HOLD_ANSWER.SESSION) {
    return {
      ...ruling,
      effect: DECISION_EFFECT.ALLOW,
      reason: `${by} allowed this (${held.id})`,
    };
  }
  // Their reason beside the rule's way forward, which `reasonFor` adds, so a no reads as narrow it rather than stop.
  const said = held.answerReason === undefined ? '' : `, and said: ${held.answerReason}`;
  return {
    ...ruling,
    effect: DECISION_EFFECT.DENY,
    reason: `${by} said no to this (${held.id})${said}`,
  };
}

/**
 * An ask a person already answered in this session, twice or "for this session", is let
 * through rather than put to them again. Only an ask: a refusal is never granted around.
 */
async function withSessionGrant(
  ruling: ToolRuling,
  sessionId: string,
  home: string,
): Promise<ToolRuling> {
  if (ruling.effect !== DECISION_EFFECT.ASK) return ruling;
  const covered = await new FileGrants(home)
    .covers(grantSubjectFor(questionOf(ruling, sessionId, '')))
    .catch(() => false);
  if (!covered) return ruling;
  return {
    ...ruling,
    effect: DECISION_EFFECT.ALLOW,
    reason: `a person already allowed ${ruling.action} in this session`,
  };
}

/** The person's ask this session, best effort, since a question without it still stands. */
async function taskOf(home: string, sessionId: string): Promise<{ task?: string }> {
  const task = await new SessionTasks(home).read(sessionId).catch(() => null);
  return task === null ? {} : { task: task.statement };
}

/** What a held question is about, from the ruling that raised it. */
function questionOf(ruling: ToolRuling, sessionId: string, agent: string): ChatQuestion {
  return {
    sessionId,
    agent,
    action: ruling.action,
    ...(ruling.target === undefined ? {} : { target: ruling.target }),
    class: ruling.class,
    reason: ruling.reason,
    ...(ruling.rule === undefined ? {} : { rule: ruling.rule }),
    ...(ruling.alternative === undefined
      ? {}
      : { alternative: describeAlternative(ruling.alternative) }),
  };
}

/** "For this session", kept where the next call looks for it. Best effort, like every grant. */
async function grantSession(
  ruling: ToolRuling,
  sessionId: string,
  home: string,
): Promise<void> {
  await new FileGrants(home)
    .grant(grantSubjectFor(questionOf(ruling, sessionId, '')))
    .catch(() => undefined);
}

/**
 * An MCP call another agent already has, refused as the proxy refuses it, since a server a
 * project declares cannot always be put behind the proxy. Only an allowed call is asked.
 */
async function withDuplicateCheck(
  ruling: ToolRuling,
  call: ToolCall,
  where: { sessionId: string; context: ToolHookContext; seams: ToolHookSeams },
): Promise<ToolRuling> {
  if (ruling.effect !== DECISION_EFFECT.ALLOW) return ruling;
  const { sessionId, context, seams } = where;
  const reason = await claimedElsewhere(
    call,
    seams.actions ?? new CloudActions(context.home),
    { agent: context.agent, sessionId, pid: process.ppid },
  );
  if (reason === null) return ruling;
  // Observing blocks nothing, so the meeting is recorded as what enforce would have done.
  if (ruling.mode === ENFORCEMENT_MODE.OBSERVE) {
    return { ...ruling, shadowEffect: DECISION_EFFECT.DENY, reason };
  }
  return { ...ruling, effect: DECISION_EFFECT.DENY, reason, rule: DUPLICATE_WORK_RULE };
}

/** What a refused repeat is filed under, so `why` names it rather than a rule file. */
const DUPLICATE_WORK_RULE = 'duplicate-work';

/** The session `memnox run` set, then the host's own, the way every row here is filed. */
export function sessionFor(
  call: ToolCall,
  context: Pick<ToolHookContext, 'runSession'>,
): string {
  return context.runSession ?? (call.sessionId === '' ? UNNAMED_SESSION : call.sessionId);
}

/** Said when the rules could not be read, so a person knows the refusal is ours and why. */
const NOT_RULED =
  'the rules on this machine could not be checked, and it is in enforce, so nothing runs unchecked. "memnox doctor --wiring" says what is wrong.';

/**
 * What a hook says when ruling threw. In enforce it refuses, because a person who turned
 * enforcement on asked to be stopped rather than waved through by a broken check; in any
 * other mode it says nothing, since observing never stopped anything to begin with.
 */
export async function failedToolAnswer(
  payload: unknown,
  home: string,
): Promise<ToolAnswer | null> {
  if ((await readMachineMode(home)) !== ENFORCEMENT_MODE.ENFORCE) return null;
  const call = toolCallOf(payload, home);
  if (call === null) return null;
  const first = call.requests[0];
  const ruling: ToolRuling = {
    action: first === undefined ? call.tool : first.action,
    class: first === undefined ? TOOL_CLASS.UNKNOWN : first.class,
    effect: DECISION_EFFECT.DENY,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: NOT_RULED,
  };
  return { call, ruling, reply: toolReply(call, ruling, false), asked: false };
}

/** The same gate every seam loads, evaluated as the agent the hook was installed for. */
export async function authorizerFor(
  context: ToolHookContext,
  hostSessionId?: string,
): Promise<HookAuthorizer> {
  const config = await readHookConfig(context.env, context.home);
  const gate = await loadHookGate(
    {
      ...config,
      agentName: context.agent,
      ...(hostSessionId === undefined || hostSessionId === '' ? {} : { hostSessionId }),
    },
    context.home,
  );
  return new HookAuthorizer(gate === null ? {} : { gate });
}

/** Best effort: the verdict has been reached, and a ledger that stops the agent is removed. */
async function keep(
  sink: EventSink | null,
  call: ToolCall,
  ruling: ToolRuling,
  context: ToolHookContext,
): Promise<void> {
  if (sink === null) return;
  try {
    const at = context.now().toISOString();
    const provenance = await provenanceOf(
      context.home,
      await overlaysInForce(context.home),
      at,
    );
    const sessionId = sessionFor(call, context);
    await sink.append(
      toolEventFor(call, ruling, {
        ...provenance,
        agent: context.agent,
        sessionId,
        at,
        refused: refusedUnasked(call, ruling, context.personThere),
      }),
    );
  } catch {
    // Nothing to do about a lost row here, and nothing worth interrupting the agent for.
  }
}

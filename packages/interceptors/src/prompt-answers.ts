/**
 * A question Memnox put through the agent's own permission prompt, and the person's answer.
 * The host says nothing back when they say yes; the tool simply runs. So the question is
 * kept by its call, and the call returning is read as the yes, learned like any other.
 */
import { userInfo } from 'node:os';

import {
  ACTOR_TYPE,
  canonicalJson,
  DECISION_EFFECT,
  digest,
  ENFORCEMENT_MODE,
  FileGrants,
  grantKeyFor,
  EVENT_SCHEMA_VERSION,
  EXECUTION,
  localRuleRef,
  newEventId,
  openLedger,
  rememberAsk,
  SessionContextStore,
  takeAsk,
  TOOL_CLASS,
  UNNAMED_SESSION,
  type EnforcementMode,
  type EventSink,
  type Execution,
  type MemnoxEvent,
  type PendingAsk,
  type ToolClass,
} from '@memnox/core';

import { EDIT_HOST, HERMES_EVENT } from './agent-edits';
import { EDIT_HOOK_EVENT } from './edit-hook';
import type { HookAuthorizer } from './hook-authorizer';
import { fieldsOf, sessionOf } from './hook-payload';
import { OPENCLAW_EVENT, OPENCLAW_RESOLUTION } from './openclaw-payload';
import { COPILOT_EVENT } from './named-hosts';
import { toolCallOf } from './tool-calls';
import {
  authorizerFor,
  declaredTools,
  readMachineMode,
  type ToolAnswer,
} from './tool-hook';
import { ruleOnTool, surfaceOf } from './tool-policy';

/** Who the hook speaks for, and the seams a test replaces. */
interface PromptAnswerDeps {
  home: string;
  agent: string;
  runSession: string | undefined;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** Null records nothing. */
  sink?: EventSink | null;
  authorizer?: HookAuthorizer;
  mode?: EnforcementMode;
  /** The person at the keyboard, named in the row; the account name by default. */
  person?: () => string;
}

const TOOL_CLASSES: readonly string[] = Object.values(TOOL_CLASS);

/** The hosts whose own prompt Memnox can put a question through, and see the call run after. */
const ANSWERING_HOSTS: readonly string[] = [
  EDIT_HOST.PRE_TOOL_USE,
  EDIT_HOST.OPENCLAW,
  EDIT_HOST.COPILOT,
  EDIT_HOST.HERMES,
];

/** The events that say a call ran, which is how a yes at the host's own prompt arrives. */
const RAN_EVENTS: readonly unknown[] = [
  EDIT_HOOK_EVENT.POST_TOOL_USE,
  OPENCLAW_EVENT.AFTER_TOOL,
  COPILOT_EVENT.POST_TOOL,
  HERMES_EVENT.POST_TOOL_CALL,
];
const MODES: readonly string[] = Object.values(ENFORCEMENT_MODE);

/** The call as its host numbers it, or a digest of the tool and what it was given. */
export function toolFingerprint(payload: unknown): string | null {
  const hook = fieldsOf(payload);
  if (hook === null) return null;
  const id = hook['tool_use_id'];
  if (typeof id === 'string' && id !== '') return id;
  const tool = hook['tool_name'];
  if (typeof tool !== 'string') return null;
  return digest(`${tool}\u0000${canonicalJson(hook['tool_input'] ?? null)}`);
}

/**
 * Keeps a question the host is about to put to a person, by its call. The hosts that can
 * ask also send the same call again once it ran; elsewhere nothing would match it.
 */
export async function rememberQuestion(
  payload: unknown,
  answer: ToolAnswer,
  deps: PromptAnswerDeps,
): Promise<void> {
  const fingerprint = toolFingerprint(payload);
  if (!answer.asked || fingerprint === null) return;
  if (!ANSWERING_HOSTS.includes(answer.call.host)) return;
  const { ruling } = answer;
  const ask: PendingAsk = {
    fingerprint,
    at: deps.now().toISOString(),
    tool: answer.call.tool,
    action: ruling.action,
    ...(ruling.target === undefined ? {} : { target: ruling.target }),
    class: ruling.class,
    mode: ruling.mode,
    reason: ruling.reason,
    ...(ruling.rule === undefined ? {} : { rule: ruling.rule }),
  };
  const store = new SessionContextStore(deps.home);
  const session = sessionKey(deps, answer.call.sessionId);
  await store.write(session, rememberAsk(await store.read(session), ask));
}

/**
 * The tool Memnox asked about ran, so the person said yes: a row naming them, and noticing
 * taught, so the same new thing is not asked again. True when this was such an answer.
 */
export async function learnFromAnswer(
  payload: unknown,
  deps: PromptAnswerDeps,
): Promise<boolean> {
  const hook = fieldsOf(payload);
  const fingerprint = toolFingerprint(payload);
  if (hook === null || fingerprint === null) return false;
  if (!RAN_EVENTS.includes(hook['hook_event_name'])) return false;
  const store = new SessionContextStore(deps.home);
  const session = sessionKey(deps, sessionOf(hook));
  const taken = takeAsk(await store.read(session), fingerprint, deps.now().toISOString());
  if (taken.ask === null) return false;
  await store.write(session, taken.state);
  await recordYes(taken.ask, session, deps);
  await countYes(taken.ask, session, deps.home);
  await teachNotice(hook, deps).catch(() => undefined);
  return true;
}

/** A no at the host's own prompt, by what the host says happened. */
const REFUSAL: Readonly<Record<string, { execution: Execution; reason: string }>> = {
  [OPENCLAW_RESOLUTION.DENY]: {
    execution: EXECUTION.BLOCKED,
    reason: "said no in {agent}'s own approval to what Memnox asked",
  },
  [OPENCLAW_RESOLUTION.TIMEOUT]: {
    execution: EXECUTION.TIMED_OUT,
    reason: "left {agent}'s approval unanswered until it timed out",
  },
  [OPENCLAW_RESOLUTION.CANCELLED]: {
    execution: EXECUTION.BLOCKED,
    reason: '{agent} had nowhere to show the question, or the call was cancelled',
  },
};

/**
 * What the person answered where the host says so outright. A yes is learned when the call
 * runs, as everywhere else; a no, a timeout or a question nobody could see is a row here,
 * which Claude Code's own prompt never tells anybody. True when this was such an answer.
 */
export async function learnFromRefusal(
  payload: unknown,
  deps: PromptAnswerDeps,
): Promise<boolean> {
  const hook = fieldsOf(payload);
  if (hook?.['hook_event_name'] !== OPENCLAW_EVENT.APPROVAL_RESOLVED) return false;
  const decision = hook['decision'];
  const refusal = typeof decision === 'string' ? REFUSAL[decision] : undefined;
  const fingerprint = toolFingerprint(payload);
  if (refusal === undefined || fingerprint === null) return true;
  const store = new SessionContextStore(deps.home);
  const session = sessionKey(deps, sessionOf(hook));
  const taken = takeAsk(await store.read(session), fingerprint, deps.now().toISOString());
  if (taken.ask === null) return true;
  await store.write(session, taken.state);
  const sink = deps.sink === undefined ? openLedger(deps.home) : deps.sink;
  if (sink === null) return true;
  const personSaid = decision === OPENCLAW_RESOLUTION.DENY;
  await sink
    .append(noRow({ ask: taken.ask, sessionId: session, refusal, personSaid }, deps))
    .catch(() => undefined);
  return true;
}

/** The no being recorded: the question it answers, where, and what the host said happened. */
interface Refused {
  ask: PendingAsk;
  sessionId: string;
  refusal: { execution: Execution; reason: string };
  personSaid: boolean;
}

function noRow(refused: Refused, deps: PromptAnswerDeps): MemnoxEvent {
  const { ask, sessionId, refusal, personSaid } = refused;
  const person = personOf(deps);
  const what = refusal.reason.replace('{agent}', deps.agent);
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: deps.now().toISOString(),
    sessionId,
    agent: deps.agent,
    // Only a no was somebody's act; a timeout or a question nobody saw is the agent's call stopped.
    actorType: personSaid ? ACTOR_TYPE.HUMAN : ACTOR_TYPE.AGENT,
    ...(personSaid ? { principal: person } : {}),
    surface: surfaceOf(ask.action),
    operation: ask.action,
    class: classOf(ask.class),
    effect: DECISION_EFFECT.DENY,
    mode: modeOf(ask.mode),
    reason: `${personSaid ? `${person} ` : ''}${what}: ${ask.reason} (${ask.tool})`,
    argsDigest: digest(ask.target ?? ask.tool),
    execution: refusal.execution,
    ...(ask.target === undefined ? {} : { target: ask.target }),
    ...(ask.rule === undefined ? {} : { rule: localRuleRef(ask.rule) }),
  };
}

/**
 * Counted toward the session's grants, so the second yes to the same action is the last
 * one anybody is asked for. Best effort, since the tool already ran.
 */
async function countYes(ask: PendingAsk, sessionId: string, home: string): Promise<void> {
  await new FileGrants(home)
    .approved({
      sessionId,
      operation: grantKeyFor(ask.action, ask.target),
      fingerprint: ask.target ?? ask.action,
      class: ask.class,
    })
    .catch(() => undefined);
}

/** The same call ruled on again in this process, so noticing holds the question, then the yes. */
async function teachNotice(
  hook: Record<string, unknown>,
  deps: PromptAnswerDeps,
): Promise<void> {
  const before = { ...hook, hook_event_name: EDIT_HOOK_EVENT.PRE_TOOL_USE };
  const call = toolCallOf(before, deps.home, await declaredTools(deps.home));
  if (call === null) return;
  const authorizer =
    deps.authorizer ?? (await authorizerFor({ ...deps, personThere: true }));
  const mode = deps.mode ?? (await readMachineMode(deps.home));
  await ruleOnTool(call, { authorizer, mode, env: deps.env });
  authorizer.personAllowed();
}

/** Best effort: the tool already ran, and a lost row is not worth interrupting anybody for. */
async function recordYes(
  ask: PendingAsk,
  sessionId: string,
  deps: PromptAnswerDeps,
): Promise<void> {
  const sink = deps.sink === undefined ? openLedger(deps.home) : deps.sink;
  if (sink === null) return;
  try {
    await sink.append(yesRow(ask, sessionId, deps));
  } catch {
    // Nothing to do about a lost row here.
  }
}

function yesRow(ask: PendingAsk, sessionId: string, deps: PromptAnswerDeps): MemnoxEvent {
  const person = personOf(deps);
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: deps.now().toISOString(),
    sessionId,
    agent: deps.agent,
    actorType: ACTOR_TYPE.HUMAN,
    principal: person,
    surface: surfaceOf(ask.action),
    operation: ask.action,
    class: classOf(ask.class),
    effect: DECISION_EFFECT.ALLOW,
    mode: modeOf(ask.mode),
    reason: `${person} said yes in ${deps.agent}'s own prompt to what Memnox asked: ${ask.reason} (${ask.tool})`,
    // A digest of what was named, never the input: a row carries names, not contents.
    argsDigest: digest(ask.target ?? ask.tool),
    ...(ask.target === undefined ? {} : { target: ask.target }),
    ...(ask.rule === undefined ? {} : { rule: localRuleRef(ask.rule) }),
    authorizedBy: `${person} (${deps.agent} prompt)`,
  };
}

/** Only enforce puts a question, so a mode this does not know is read as enforce. */
function modeOf(mode: string): EnforcementMode {
  // Checked against the modes on the line above, so the cast names one of them.
  return MODES.includes(mode) ? (mode as EnforcementMode) : ENFORCEMENT_MODE.ENFORCE;
}

/** A class the ledger does not know is recorded as unknown, never as a safe one. */
function classOf(value: string): ToolClass {
  // Checked against the classes on the line above, so the cast names one of them.
  return TOOL_CLASSES.includes(value) ? (value as ToolClass) : TOOL_CLASS.UNKNOWN;
}

function personOf(deps: PromptAnswerDeps): string {
  try {
    return (deps.person ?? ((): string => userInfo().username))();
  } catch {
    // An account with no name is still a person at the keyboard.
    return 'a person';
  }
}

/** The session `memnox run` set, then the host's own, the way every row here is filed. */
function sessionKey(deps: PromptAnswerDeps, hostSession: string): string {
  return deps.runSession ?? (hostSession === '' ? UNNAMED_SESSION : hostSession);
}

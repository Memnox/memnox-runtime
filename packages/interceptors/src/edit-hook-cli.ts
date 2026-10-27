import { homedir, userInfo } from 'node:os';

import {
  desktopNotice,
  AGENT_FLAG,
  CloudLeases,
  DECISION_EFFECT,
  ENV_AGENT_NAME,
  LeaseRegistry,
  protectionStopped,
  SESSION_VAR,
  SessionHosts,
} from '@memnox/core';

import {
  agentEditsOf,
  CURSOR_EVENT,
  EDIT_HOST,
  EDIT_MOMENT,
  endedSessionOf,
  type AgentEdits,
} from './agent-edits';
import { claimAll, type EditHookContext } from './edit-claims';
import { answerAgentQuestion } from './agent-question';
import { answerPicker } from './held-picker';
import { checkpointBeforeFirstWrite } from './checkpoint-seam';
import { canAskPerson, withAddedContext } from './edit-hook';
import { fingerprintHold } from './fingerprint-hold';
import { keepBeforeShell, takeOwedReport } from './shell-written';
import { fieldsOf } from './hook-payload';
import { answerPause } from './edit-pause';
import { keepSessionSummary } from './session-summary-row';
import {
  answeredApproval,
  answeredSessionStart,
  beforePause,
  replyInSession,
} from './in-session';
import { log, readStdin } from './seam-runtime';
import { noteSessionHost } from './session-host-note';
import { clearTerminalQuestion, noteTerminalQuestion } from './terminal-question';
import { noteCursorAsking } from './cursor-asking';
import { sessionEventOf } from './session-events';
import { answerToolCall, failedToolAnswer, type ToolAnswer } from './tool-hook';
import { DEFAULT_AGENT_NAME, TOOL_POLICY_FLAG } from './tool-hook.constants';
import { refusalReply, type ToolReply } from './tool-policy';
import { canonicalPayload, isOpenClawPayload } from './openclaw-payload';
import { isBorrowedClaudeHook } from './borrowed-hook';
import { HERMES_PLUGIN_MARK } from './agent-edits';
import { HOST_EVENT_FLAG, isCopilotPayload, namedHostPayload } from './named-hosts';

/**
 * The hook an editor runs before a tool call and when a session ends: with `--policy` it
 * rules on the call, and it takes a lease before a write. Silent and exit zero means go
 * ahead, which is also what anything unreadable gets.
 */

/** The exit code Windsurf reads as "blocked", with the reason on stderr. */
const WINDSURF_BLOCK = 2;

/** The payload being answered, kept so a failure can still refuse the call it was about. */
let received: unknown = null;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const context = contextFrom(args, process.env);
  const payload = await readPayload(args, context);
  // Not a payload this hook was written for, so it says nothing about it.
  if (payload === null) return;
  received = payload;

  // Cursor running Claude Code's entry: Cursor's own entry rules on this call.
  if (isBorrowedClaudeHook(payload, context.agent, process.env)) return;
  if (await answeredApproval(payload, context)) return;
  const ended = endedSessionOf(payload);
  if (ended !== null) return releaseSession(ended, context);
  if (await nothingToRule(payload, context)) return;
  await noteSessionHost(payload, context);
  if (await answeredSessionStart(payload, context, process.env)) return;
  if (await answeredPicker(payload, context)) return;
  if (await answeredOutLoud(payload, context)) return;

  // The rules first, so nothing takes a lease on a write it was never allowed to make.
  const ruled = args.includes(TOOL_POLICY_FLAG)
    ? await answerPolicy(payload, context)
    : null;
  const stopped = ruled === null ? null : await stoppedHere(ruled, context);
  if (stopped !== null) return emit(stopped.reply);
  if (ruled !== null) await keepTreeBeforeShell(payload, ruled, context);
  const reply =
    ruled === null ? null : await replyInSession(payload, ruled, context, process.env);

  // Windsurf's `post_write_code` is both an edit to
  // claim and a tool to record, so the claim goes first.
  const pause = sessionEventOf(payload);
  const unconfirmed: string[] = [];
  if (await answerEdits(payload, context, unconfirmed)) return;
  await noteCursorAsking(payload, reply !== null, context);
  emit(toldUnconfirmed(payload, reply, unconfirmed));
  if (pause === null) return;
  const said = await beforePause(payload, pause, context, process.env);
  process.stdout.write(await answerPause(pause, context, said));
}

/**
 * The payload in the names every reader takes: OpenClaw's, Copilot's, Devin's and OpenCode's
 * read into them, any other host's as it came. Null where stdin is not JSON.
 */
async function readPayload(
  args: readonly string[],
  context: EditHookContext,
): Promise<unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readStdin());
  } catch {
    return null;
  }
  const hostEvent = flagValue(args, HOST_EVENT_FLAG);
  return canonicalPayload(
    namedHostPayload(raw, {
      agent: context.agent,
      env: process.env,
      ...(hostEvent === null ? {} : { hostEvent }),
    }),
  );
}

/**
 * The rules on this tool call. A failure in observe rules on nothing, as the lease half
 * does, because a hook that refuses everything while only watching gets taken out.
 */
async function answerPolicy(
  payload: unknown,
  context: EditHookContext,
): Promise<ToolAnswer | null> {
  try {
    return await answerToolCall(payload, {
      home: context.home,
      agent: context.agent,
      runSession: context.runSession,
      env: process.env,
      personThere: personThere(payload, context.agent),
      now: context.now,
    });
  } catch (err) {
    log(`tool policy failed: ${String(err)}`);
    // Observe lets it through as before; enforce refuses, since a broken check is not a yes.
    return failedToolAnswer(payload, context.home).catch(() => null);
  }
}

/** Cursor shows its prompt before a command or an MCP call; Claude Code does when attended. */
const CURSOR_ASKING: readonly unknown[] = [
  CURSOR_EVENT.BEFORE_SHELL,
  CURSOR_EVENT.BEFORE_MCP,
];

/** The reply that ends the call before anything is claimed, or null where it goes on. */
async function stoppedHere(
  ruled: ToolAnswer,
  context: EditHookContext,
): Promise<{ reply: ToolReply | null } | null> {
  if (ruled.ruling.effect === DECISION_EFFECT.DENY) return { reply: ruled.reply };
  // Held for a person, so their question is what is shown, and nothing is claimed until they answer.
  if (ruled.ruling.effect === DECISION_EFFECT.ASK && !ruled.asked)
    return { reply: ruled.reply };
  // A report its host could not hear after the last command is heard here, once.
  const owed = await takeOwedReport(
    context.home,
    context.runSession ?? ruled.call.sessionId,
  );
  if (owed !== null) return { reply: refusalReply(ruled.call.host, owed) };
  // Before any lease, so a write sent back to record the fingerprint claims nothing.
  const recordFirst = await heldForFingerprint(ruled, context);
  return recordFirst === null ? null : { reply: recordFirst };
}

/** Best effort: a tree not kept only means this command's lines go unchecked afterwards. */
async function keepTreeBeforeShell(
  payload: unknown,
  ruled: ToolAnswer,
  context: EditHookContext,
): Promise<void> {
  try {
    await keepBeforeShell(payload, ruled, context);
  } catch (err) {
    log(`keeping the tree before a command failed: ${String(err)}`);
  }
}

/** Best effort: a hold that failed to work out lets the write through as it would have gone. */
async function heldForFingerprint(
  ruled: ToolAnswer,
  context: EditHookContext,
): Promise<ToolReply | null> {
  try {
    return await fingerprintHold(ruled, context);
  } catch (err) {
    log(`fingerprint hold failed, letting the write through: ${String(err)}`);
    return null;
  }
}

function personThere(payload: unknown, agent: string): boolean {
  const hook = fieldsOf(payload);
  if (hook !== null && CURSOR_ASKING.includes(hook['hook_event_name'])) return true;
  // OpenClaw's approval reaches its person, and blocks the call where it has nowhere to;
  // Copilot asks at its terminal and refuses an ask in autopilot.
  if (isOpenClawPayload(payload) || isCopilotPayload(payload)) return true;
  // Hermes's approval reaches its person through Memnox's plugin, and fails closed where none.
  if (hook?.[HERMES_PLUGIN_MARK] === true) return true;
  return agent === DEFAULT_AGENT_NAME && canAskPerson(payload);
}

function emit(reply: ToolReply | null): void {
  if (reply === null) return;
  if (reply.stdout !== undefined) process.stdout.write(`${reply.stdout}\n`);
  if (reply.stderr !== undefined) process.stderr.write(`${reply.stderr}\n`);
  if (reply.exitCode !== undefined) process.exitCode = reply.exitCode;
}

/** Claude Code names what started it here, which is how a panel session is told from a terminal one. */
const ENTRYPOINT_VAR = 'CLAUDE_CODE_ENTRYPOINT';

/**
 * Which agent this hook speaks for: the environment
 * `memnox run` sets, then its own `--agent` flag.
 */
function contextFrom(args: readonly string[], env: NodeJS.ProcessEnv): EditHookContext {
  return {
    home: homedir(),
    agent: env[ENV_AGENT_NAME] ?? agentFlag(args) ?? DEFAULT_AGENT_NAME,
    runSession: env[SESSION_VAR],
    pid: process.pid,
    cwd: process.cwd(),
    now: () => new Date(),
    ...(env[ENTRYPOINT_VAR] === undefined ? {} : { entrypoint: env[ENTRYPOINT_VAR] }),
  };
}

/** `--agent cursor`, where the installed command names one. */
function agentFlag(args: readonly string[]): string | null {
  return flagValue(args, AGENT_FLAG);
}

/** The value after a flag, or null where the flag is absent or bare. */
function flagValue(args: readonly string[], flag: string): string | null {
  const at = args.indexOf(flag);
  if (at === -1) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith('-') ? null : value;
}

/**
 * Everything the session held, here and in the workspace,
 * let go at once so nobody waits out a window.
 */
async function releaseSession(ended: string, context: EditHookContext): Promise<void> {
  // Closed by the person, so the voice, the cards and the waiting list stop tracking it at once.
  await new SessionHosts(context.home).end(
    context.runSession ?? ended,
    context.now().toISOString(),
  );
  await new LeaseRegistry(context.home).releaseSession(
    ended,
    context.now().toISOString(),
  );
  await new CloudLeases(context.home).releaseSession({
    agent: context.agent,
    sessionId: context.runSession ?? ended,
    pid: context.pid,
  });
  // A session `memnox run` started is summed up when it exits, on the terminal.
  if (context.runSession === undefined) {
    const line = await keepSessionSummary(context.home, ended, context.now());
    // On the screen as well, since a session ending has nobody watching its terminal.
    if (line !== null) desktopNotice(line);
  }
}

/**
 * Claims the writes in this payload and answers
 * the host. True when the write was refused.
 */
async function answerEdits(
  payload: unknown,
  context: EditHookContext,
  unconfirmed: string[],
): Promise<boolean> {
  const found = agentEditsOf(payload);
  if (found === null) return false;
  const refusal = await claimAll(found, canAskPerson(payload), context, unconfirmed);
  if (refusal === null) {
    await keepBeforeFirstWrite(found, context);
    // Cursor reads a permission reply that is not JSON
    // as a block, so an allow is an empty object.
    if (found.host === EDIT_HOST.CURSOR && found.moment === EDIT_MOMENT.BEFORE) {
      process.stdout.write('{}\n');
    }
    return false;
  }
  // Windsurf reads a refusal from stderr on exit code 2; every other host reads stdout.
  if (found.host === EDIT_HOST.WINDSURF) {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = WINDSURF_BLOCK;
  } else {
    process.stdout.write(`${refusal}\n`);
  }
  return true;
}

/**
 * The reply with what could not be checked added for the model where its host reads
 * context before a tool runs, and on stderr for the person everywhere else.
 */
function toldUnconfirmed(
  payload: unknown,
  reply: ToolReply | null,
  unconfirmed: readonly string[],
): ToolReply | null {
  if (unconfirmed.length === 0) return reply;
  const note = unconfirmed.join(' ');
  const found = agentEditsOf(payload);
  const before =
    found?.host === EDIT_HOST.PRE_TOOL_USE && found.moment === EDIT_MOMENT.BEFORE;
  const added = before ? withAddedContext(reply?.stdout, note) : null;
  if (added !== null) return { ...(reply ?? {}), stdout: added };
  log(note);
  return reply;
}

/**
 * The tree as it was before this session's first write, taken while the write
 * still waits on this hook. An edit already on disk is too late to keep.
 */
async function keepBeforeFirstWrite(
  found: AgentEdits,
  context: EditHookContext,
): Promise<void> {
  const [edit] = found.edits;
  if (edit === undefined || found.moment !== EDIT_MOMENT.BEFORE) return;
  await checkpointBeforeFirstWrite({
    home: context.home,
    sessionId: context.runSession ?? edit.sessionId,
    agent: context.agent,
    place: edit.cwd ?? context.cwd,
    now: context.now,
    log,
  });
}

main().catch(async (err: unknown) => {
  log(`edit hook failed: ${String(err)}`);
  // In enforce a broken hook refuses a tool call, since saying nothing lets it through.
  const refused = await failedToolAnswer(received, homedir()).catch(() => null);
  emit(refused?.reply ?? null);
});

function personName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'a person';
  }
}

/** An agent's own question, answered out loud when the voice is there to read it. */
async function answeredOutLoud(
  payload: unknown,
  context: EditHookContext,
): Promise<boolean> {
  const reply = await answerAgentQuestion(payload, context).catch((err: unknown) => {
    log(`agent question failed: ${String(err)}`);
    return null;
  });
  if (reply === null) return false;
  emit({ stdout: reply });
  return true;
}

/**
 * Stopped on purpose, so no rule, lease or pause stands in the way until `memnox start`; or the
 * agent asking its person something in its terminal, which is news for the voice and no tool call.
 */
async function nothingToRule(
  payload: unknown,
  context: EditHookContext,
): Promise<boolean> {
  return (await protectionStopped(context.home)) || askedInTerminal(payload, context);
}

/** A question the agent asks in its terminal is posted for the voice; any other hook means it was answered. */
async function askedInTerminal(
  payload: unknown,
  context: EditHookContext,
): Promise<boolean> {
  try {
    if (await noteTerminalQuestion(payload, context)) return true;
    await clearTerminalQuestion(payload, context);
  } catch (err) {
    // The voice reading it out is a convenience: the agent's own prompt is still on screen.
    log(`terminal question failed: ${String(err)}`);
  }
  return false;
}

/** A held question asked in the host's own picker is answered here, and nowhere else. */
async function answeredPicker(
  payload: unknown,
  context: EditHookContext,
): Promise<boolean> {
  const picked = await answerPicker(payload, { ...context, person: personName }).catch(
    (err: unknown) => {
      log(`held picker failed: ${String(err)}`);
      return null;
    },
  );
  if (picked === null) return false;
  emit(picked.stdout === undefined ? null : { stdout: picked.stdout });
  return true;
}

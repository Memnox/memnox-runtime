/**
 * The boundary said once when a session starts, and a decision already taken said where the agent
 * meets it. Read from disk, never from a model; the one network call is a logged in machine's
 * bounded ask at a session's start, and its failure says nothing rather than holding the session.
 */
import {
  ACTION,
  boundaryContext,
  candidatesAbout,
  describeCandidate,
  describeFact,
  factsAbout,
  MOST_CANDIDATES_PER_CALL,
  MOST_FACTS_PER_CALL,
  MOST_PROMPT_WORDS,
  readWorkspaceMemory,
  decisionsCovering,
  decisionsMentioned,
  describeDecision,
  describeFingerprint,
  DISCOVERED_AGENT_KIND,
  ENFORCEMENT_MODE,
  readCodeFingerprint,
  rememberRepository,
  markShown,
  MOST_DECISIONS_PER_CALL,
  notYetShown,
  pruneSessionFiles,
  readProtectionStop,
  rulesHere,
  SessionContextStore,
  stopHasEnded,
  type DecisionFound,
  type DecisionSubject,
  type FactQuery,
  type ProtectionStop,
  isWorkBriefId,
  renderWorkBrief,
  WORK_BRIEF_VAR,
  WorkBriefs,
} from '@memnox/core';

import { CURSOR_EVENT } from './agent-edits';
import { containmentFor } from './containment-loader';
import { EDIT_HOOK_EVENT } from './edit-hook';
import { readHookConfig } from './hook-config';
import { cwdOf, fieldsOf, sessionOf } from './hook-payload';
import { repositoryRootOf } from './seam-runtime';
import { sessionBriefLine, type SessionBriefFetch } from './session-brief-line';
import { readMachineMode } from './tool-hook';

/** Who and where, as the hook process reads it once where it starts. */
export interface SessionContextDeps {
  home: string;
  agent: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: () => Date;
  /** Injected so a test states the repository rather than asking git. */
  rootOf?: (cwd: string) => string | null;
  /** The `memnox run` session a declared task is filed under, where there is one. */
  runSession?: string;
  /** Injected so a test states what the workspace answers rather than asking it. */
  brief?: SessionBriefFetch;
  /** Injected so a test names the remote rather than asking git. */
  remoteOf?: (root: string) => string | undefined;
}

/** A session that just began, where the host sends one. */
interface SessionStart {
  sessionId: string;
  cwd?: string;
  /** Cursor reads its own shape back; every other host reads Claude Code's. */
  cursor?: boolean;
}

/** Where a decision is being looked for: one tool call's actions, or a person's words. */
interface DecisionLookup {
  sessionId: string;
  cwd?: string;
  subjects?: readonly DecisionSubject[];
  prompt?: string;
}

/** Claude Code, Codex and Gemini CLI all name it `SessionStart`; Cursor, `sessionStart`. */
export function sessionStartOf(payload: unknown): SessionStart | null {
  const hook = fieldsOf(payload);
  const event = hook?.['hook_event_name'];
  const cursor = event === CURSOR_EVENT.SESSION_START;
  if (hook === null || (event !== EDIT_HOOK_EVENT.SESSION_START && !cursor)) return null;
  const cwd = cwdOf(hook);
  return {
    sessionId: sessionOf(hook),
    ...(cwd === undefined ? {} : { cwd }),
    ...(cursor ? { cursor } : {}),
  };
}

/** The boundary as added context, or empty where Memnox is off and has nothing to say. */
export async function answerSessionStart(
  start: SessionStart,
  deps: SessionContextDeps,
): Promise<string> {
  // A session start is rare and unhurried, which makes it the place for the sweep.
  await pruneSessionFiles(deps.home, deps.now()).catch(() => 0);
  const stop = await readProtectionStop(deps.home);
  // Said rather than silent, so an agent and its person know nothing is being checked.
  if (stop !== null && !stopHasEnded(stop, deps.now())) {
    return `${sessionStartReply(start, stoppedLine(stop), null)}\n`;
  }
  const mode = await readMachineMode(deps.home);
  if (mode === ENFORCEMENT_MODE.OFF) return '';
  const cwd = start.cwd ?? deps.cwd;
  const containment = await containmentFor({
    home: deps.home,
    env: deps.env,
    cwd,
    now: deps.now(),
    agent: deps.agent,
    ...(deps.rootOf === undefined ? {} : { rootOf: deps.rootOf }),
  });
  const root = containment === null ? undefined : containment.root;
  const { rules } = await rulesFor(deps, root);
  const repository = (deps.rootOf ?? repositoryRootOf)(cwd);
  // Picked up the first time an agent works here, so the daemon wraps its MCP servers.
  if (repository !== null) rememberRepository(deps.home, repository);
  // Started before the reads below, so its one bounded round trip overlaps them.
  const workspaceBrief = workspaceBriefFor(start, deps, cwd, repository);
  const fingerprint = await fingerprintHere(repository, deps.agent);
  const text = linesOf([
    boundaryContext({ mode, rules, containment }),
    await memoryLine(deps.home),
    await workBriefLine(deps.home, deps.env),
    await workspaceBrief,
    fingerprint.told,
  ]);
  if (text === '') return '';
  return `${sessionStartReply(start, text, fingerprint.notice)}\n`;
}

/** The parts that have something to say, one to a line. */
function linesOf(parts: readonly string[]): string {
  return parts.filter((each) => each !== '').join('\n');
}

/** What the workspace says about where this session starts, or nothing on any failure. */
function workspaceBriefFor(
  start: SessionStart,
  deps: SessionContextDeps,
  cwd: string,
  root: string | null,
): Promise<string> {
  return sessionBriefLine({
    home: deps.home,
    sessionId: deps.runSession ?? start.sessionId,
    cwd,
    root,
    ...(deps.brief === undefined ? {} : { brief: deps.brief }),
    ...(deps.remoteOf === undefined ? {} : { remoteOf: deps.remoteOf }),
  }).catch(() => '');
}

/** What the agent is told about the fingerprint, and what its person sees said about it. */
interface FingerprintHere {
  told: string;
  notice: string | null;
}

/**
 * How the repository writes code, said once a session before the agent writes any of it,
 * or, where it states none yet, the ask to record it, which the first agent here does once.
 * The person is shown a line too, since what only the agent is told looks like nothing.
 */
async function fingerprintHere(
  root: string | null,
  agent: string,
): Promise<FingerprintHere> {
  if (root === null) return { told: '', notice: null };
  const fingerprint = await readCodeFingerprint(root).catch(() => null);
  if (fingerprint === null)
    return { told: RECORD_FINGERPRINT, notice: noFingerprintYet(agent) };
  const checks = fingerprint.checks.length;
  return {
    told: describeFingerprint(fingerprint) ?? '',
    notice:
      checks === 0
        ? null
        : `Memnox: ${checks} check(s) from this repository's code fingerprint are enforced on every write.`,
  };
}

const RECORD_FINGERPRINT = `This repository does not yet state how its code is written. Before your first change here, read enough of it to see, and record it with the memnox-session "fingerprint" tool: call it without arguments for what to write. It is done once, for every agent after you, and your first write here is held until you have.`;

/** What the person types in each agent, since Codex files a custom prompt under `prompts:`. */
function noFingerprintYet(agent: string): string {
  const typed =
    agent === DISCOVERED_AGENT_KIND.CODEX_CLI ? '/prompts:fingerprint' : '/fingerprint';
  return `Memnox: this repository has no code fingerprint yet. Type ${typed} to record it now, or the agent records one before its first change here.`;
}

/** The context for the agent, and a line its person sees, in the reply its host reads. */
function sessionStartReply(
  start: SessionStart,
  text: string,
  notice: string | null,
): string {
  // Cursor has no line for its person here, so the agent is the one told.
  if (start.cursor === true) return JSON.stringify({ additional_context: text });
  return JSON.stringify({
    ...(notice === null ? {} : { systemMessage: notice }),
    hookSpecificOutput: {
      hookEventName: EDIT_HOOK_EVENT.SESSION_START,
      additionalContext: text,
    },
  });
}

/**
 * The work the person handed this session, read in before its first turn rather than left for it
 * to fetch, so it starts knowing the ticket, what was said about it and the decisions that bind it.
 */
async function workBriefLine(home: string, env: NodeJS.ProcessEnv): Promise<string> {
  const id = env[WORK_BRIEF_VAR];
  if (id === undefined || !isWorkBriefId(id)) return '';
  const brief = await new WorkBriefs(home).read(id).catch(() => null);
  return brief === null ? '' : renderWorkBrief(brief);
}

/** Said once a session, so an agent knows to ask what was settled before it plans a change. */
async function memoryLine(home: string): Promise<string> {
  const memory = await readWorkspaceMemory(home).catch(() => null);
  if (memory === null || memory.facts.length === 0) return '';
  return `Your workspace has settled ${memory.facts.length} decision(s), policies and owners. Before you change code, ask the memnox-session "brief" tool about the paths, or "memory" about the subject, and cite what it says.`;
}

/**
 * The decisions this call or prompt meets that the session has not been told, a few at
 * most, marked told. Null where there is nothing new to say.
 */
export async function decisionsAt(
  lookup: DecisionLookup,
  deps: SessionContextDeps,
): Promise<string | null> {
  const rules = await ruleLines(lookup, deps);
  const { facts, candidates } = await factLines(lookup, deps);
  if (rules.length === 0 && facts.length === 0 && candidates.length === 0) return null;

  const store = new SessionContextStore(deps.home);
  const state = await store.read(lookup.sessionId);
  const fresh = [
    ...notYetShown(state, rules.map(idOf)).slice(0, MOST_DECISIONS_PER_CALL),
    ...notYetShown(state, facts.map(idOf)).slice(0, MOST_FACTS_PER_CALL),
    ...notYetShown(state, candidates.map(idOf)).slice(0, MOST_CANDIDATES_PER_CALL),
  ];
  if (fresh.length === 0) return null;
  await store.write(lookup.sessionId, markShown(state, fresh, deps.now().toISOString()));
  return [...rules, ...facts, ...candidates]
    .filter((each) => fresh.includes(each.id))
    .map((each) => each.text)
    .join('\n');
}

/** One thing to say, under the id a session remembers having said it by. */
interface Line {
  id: string;
  text: string;
}

function idOf(line: Line): string {
  return line.id;
}

/** The rules a prompt names or a call meets, one line each. */
async function ruleLines(
  lookup: DecisionLookup,
  deps: SessionContextDeps,
): Promise<Line[]> {
  const root = (deps.rootOf ?? repositoryRootOf)(lookup.cwd ?? deps.cwd) ?? undefined;
  const { decisions } = await rulesFor(deps, root);
  const found =
    lookup.prompt !== undefined
      ? decisionsMentioned(decisions, lookup.prompt)
      : (lookup.subjects ?? []).flatMap((each) => decisionsCovering(decisions, each));
  return firstOfEach(found).map((each) => ({
    id: each.decision.id,
    text: describeDecision(each),
  }));
}

/** Only a change is worth a brief: an agent reading a file has not decided anything yet. */
const CHANGES: readonly string[] = [ACTION.FILESYSTEM_WRITE, ACTION.FILESYSTEM_DELETE];

/** Prefixed, so a fact and a rule can never be taken for each other in the session's record. */
const FACT_ID_PREFIX = 'fact:';

/** Prefixed apart from a fact, so approving a candidate later says it again as settled. */
const CANDIDATE_ID_PREFIX = 'candidate:';

/**
 * What the workspace settled about the words of a prompt, or about the paths a write is
 * about to change, and apart from it what connected tools said that nobody approved, each
 * line opening with that. Read from the memory this machine last pulled, with no network.
 */
async function factLines(
  lookup: DecisionLookup,
  deps: SessionContextDeps,
): Promise<{ facts: Line[]; candidates: Line[] }> {
  const none = { facts: [], candidates: [] };
  const memory = await readWorkspaceMemory(deps.home).catch(() => null);
  if (memory === null) return none;
  const query = factQueryOf(lookup);
  if (query === null) return none;
  return {
    facts: factsAbout(memory, query).map((found) => ({
      id: `${FACT_ID_PREFIX}${found.fact.id}`,
      text: describeFact(found),
    })),
    candidates: candidatesAbout(memory, query).map(({ candidate }) => ({
      id: `${CANDIDATE_ID_PREFIX}${candidate.id}`,
      text: describeCandidate(candidate),
    })),
  };
}

/** Context beside a tool call that goes ahead, in Claude Code's words; the prompt still runs. */
export function preToolContext(text: string): string {
  return addedContext(EDIT_HOOK_EVENT.PRE_TOOL_USE, text);
}

function addedContext(hookEventName: string, text: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext: text },
  });
}

async function rulesFor(
  deps: SessionContextDeps,
  root: string | undefined,
): ReturnType<typeof rulesHere> {
  const config = await readHookConfig(deps.env, deps.home);
  return rulesHere({
    home: deps.home,
    policyFiles: config.policyFiles,
    agent: deps.agent,
    ...(root === undefined ? {} : { root }),
  });
}

/** One sentence per decision, however many of its actions or words it matched. */
function firstOfEach(found: readonly DecisionFound[]): DecisionFound[] {
  const seen = new Set<string>();
  return found.filter((each) => {
    if (seen.has(each.decision.id)) return false;
    seen.add(each.decision.id);
    return true;
  });
}

/** Who stopped Memnox here, until when, and the one command that brings it back. */
function stoppedLine(stop: ProtectionStop): string {
  const until = stop.until === undefined ? '' : ` until ${stop.until}`;
  const why = stop.reason === undefined ? '' : ` (${stop.reason})`;
  return `Memnox: protection on this machine is stopped${until} by ${stop.by}${why}, so nothing is checked. "memnox start" turns it back on.`;
}

/** A prompt's words, bounded like the rule lookup's, or the paths a change is about to touch. */
function factQueryOf(lookup: DecisionLookup): FactQuery | null {
  if (lookup.prompt !== undefined) {
    const words = lookup.prompt.split(/\s+/).slice(0, MOST_PROMPT_WORDS);
    return { words, paths: words.filter((word) => word.includes('/')) };
  }
  const paths = (lookup.subjects ?? []).flatMap((each) =>
    CHANGES.includes(each.action) && each.target !== undefined ? [each.target] : [],
  );
  return paths.length > 0 ? { paths } : null;
}

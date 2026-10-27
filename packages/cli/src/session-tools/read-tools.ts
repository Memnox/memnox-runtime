/**
 * The four questions an agent may put to Memnox on its person's behalf: why, status,
 * replay and decisions. Each reads the record and writes nothing.
 */
import {
  ACTION,
  buildReplay,
  DECISION_EFFECT,
  delegationChain,
  LEDGER_LATEST_ONLY,
  LEDGER_RECENT_LIMIT,
  LEDGER_SESSION_LIMIT,
  LocalGate,
  PendingApprovals,
  resolveAction,
  SessionPauses,
  targetsRuledOn,
  type ActionRequest,
  type DisplayDelivery,
  type Sight,
  type LocalVerdict,
  type EditorApp,
  type StartableAgent,
  type MemnoxEvent,
  type Milestone,
  type PersonStanding,
  type ToolConnection,
} from '@memnox/core';
import type { SourceQuery, SourceRead, SourcesRead } from '../sync/workspace-reads';
import type {
  CheckedAccount,
  PersonalAnswer,
  PersonalRun,
  GithubRead,
  PersonalTools,
  WorkspaceRepositories,
} from '../sync/personal-work';

import { withEvents } from '../event-store';
import type { CommandRun } from './voice-commands';
import { policySetInForce } from '../policy-path';
import { readLocalDecisions } from '../sync/local-decisions';
import { scopeOf, type SessionScope } from './session-scope';
import type { PaneSeams } from './multiplexer';

/** What the tools read the machine through, injected so a test never reads the real one. */
export interface SessionToolDeps {
  home: string;
  cwd: string;
  /** The agent named on the launch line, so its own sessions are the ones read. */
  agent: string;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  readStatus: (home: string, project: string) => Promise<unknown>;
  milestonesAt: (place: string) => Promise<Milestone[]>;
  /** The live brief from the workspace, or null where it cannot be asked just now. */
  brief: (resources: readonly string[], repository?: string) => Promise<unknown>;
  /** Pulls the workspace memory again before it is read; absent where nothing can reach the workspace. */
  refreshMemory?: () => Promise<void>;
  /** Messages and tickets from the systems the workspace connects, or null where it cannot be asked. */
  sources?: (query: SourceQuery) => Promise<SourcesRead | null>;
  /** Who in the workspace answers to a name, or everybody; null where it cannot be asked. */
  people?: (name: string | undefined) => Promise<Record<string, unknown> | null>;
  /** Whether this Mac is enrolled in another workspace than the one the person signed in to. */
  personElsewhere?: () => Promise<boolean>;
  /** One item read whole by its link, or null where the workspace will not or cannot say. */
  source?: (link: string) => Promise<SourceRead | null>;
  /** The person's own accounts in their own tools; absent where nothing can reach the workspace. */
  personalWork?: {
    find: (what: string, toolkit?: string) => Promise<PersonalAnswer<PersonalTools>>;
    /** Unsigned, so the control plane runs only what reads. */
    run: (tool: string, argumentsText: string) => Promise<PersonalAnswer<PersonalRun>>;
    /** The page that signs the person in to one tool, opened by nobody. */
    link: (toolkit: string) => Promise<PersonalAnswer<string>>;
    /** Whose accounts their sign ins reached, each checked against them. */
    accounts: () => Promise<PersonalAnswer<CheckedAccount[]>>;
    /** The repositories the workspace connected through its GitHub App. */
    repositories?: (all?: boolean) => Promise<PersonalAnswer<WorkspaceRepositories>>;
    /** One read of a repository through that App: pull requests, issues, files, comments, commits. */
    github?: (read: GithubRead) => Promise<PersonalAnswer<unknown>>;
    /** The apps the workspace connected to the person, the same list the Mac's Tools panel shows. */
    connections?: () => Promise<PersonalAnswer<ToolConnection[]>>;
    /** Signs out of every sign in to one tool, answering how many were undone. */
    signOut: (toolkit: string) => Promise<PersonalAnswer<number>>;
    /** Opens the provider's one time sign in for any tool, which every person may connect as themselves. */
    signIn: (
      toolkit: string,
    ) => Promise<PersonalAnswer<{ url: string; opened: boolean }>>;
  };
  /** Starts the person's own Memnox sign in on the daemon, as the Mac's Account row does; null when no daemon answered. */
  memnoxSignIn?: () => Promise<PersonStanding | null>;
  /** The workspace's own name, or null when it has none or cannot be asked. */
  workspaceName?: () => Promise<string | null>;
  /** How the Mac says an instruction it typed landed, or null when it never said; absent where nobody types. */
  delivered?: (requestId: string, waitMs?: number) => Promise<DisplayDelivery | null>;
  /** Whether a session began in that repository since then, from its own start hook; absent where nothing can tell. */
  startSeen?: (repository: string, since: string) => Promise<string | null>;
  /** Where an app the person named by voice is installed, or null; absent means the folders apps are kept in. */
  findApp?: (name: string) => string | null;
  /** Ends an agent's process as closing its terminal would; absent means signalling it for real. */
  endAgent?: (pid: number) => Promise<boolean>;
  /** How tmux and WezTerm are asked about their panes and typed into; absent means the programs themselves. */
  panes?: PaneSeams;
  /** What the Mac saw for a LOOK, or null when it said nothing in time; absent means waiting on the file. */
  seen?: (requestId: string) => Promise<Sight | null>;
  /** Where an agent's command is, from the person's own shell or where it is installed, or null. */
  resolveCommand?: (agent: StartableAgent) => string | null;
  /** Where an agent's desktop app is installed, or null when it has none on this Mac. */
  resolveApp?: (agent: StartableAgent) => string | null;
  /** Where an editor is installed, so a test names one without it being on the machine. */
  resolveEditor?: (editor: EditorApp) => string | null;
  /** How a memnox command is run for the voice; absent means memnox itself, beside this module. */
  runMemnox?: (argv: readonly string[], timeoutMs: number) => Promise<CommandRun>;
  /** What a login by voice names this machine when they named nothing; the hostname outside tests. */
  machineName?: () => string;
}

/** Tool arguments as the host sent them, read field by field. */
export type ToolArgs = Record<string, unknown>;

export function textArg(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The fields of a decision a person asks about; never arguments, digests or output. */
function decisionOf(event: MemnoxEvent): Record<string, unknown> {
  return {
    event: event.id,
    at: event.at,
    effect: event.effect,
    operation: event.operation,
    ...(event.target === undefined ? {} : { target: event.target }),
    reason: event.reason,
    rule:
      event.rule === undefined ? 'none matched, so the default applied' : event.rule.name,
    ...(event.rule === undefined
      ? {}
      : {
          source: `${event.rule.file}${event.rule.line === undefined ? '' : `:${event.rule.line}`} (${event.rule.layer} layer)`,
        }),
    ...(event.alternative === undefined ? {} : { instead: event.alternative }),
    ...(event.authorizedBy === undefined ? {} : { releasedBy: event.authorizedBy }),
    ...(event.subagent === undefined ? {} : { by: delegationChain(event) }),
  };
}

/** The latest refusal or ask in this agent's session, or the event named. */
export async function whyTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const id = textArg(args, 'event');
  return withEvents(deps.home, async (store) => {
    if (id !== undefined) {
      const rows = await store.query({ limit: LEDGER_RECENT_LIMIT, withConfig: true });
      const found = rows.find((each) => each.id === id);
      return found === undefined ? { found: false, event: id } : decisionOf(found);
    }
    const scope = await scopeOf(store, deps, textArg(args, 'session'));
    if (scope.sessionId === null) return { ...scope, found: false };
    const rows = await store.query({
      sessionId: scope.sessionId,
      effects: [DECISION_EFFECT.DENY, DECISION_EFFECT.ASK],
      limit: LEDGER_LATEST_ONLY,
    });
    const latest = rows[rows.length - 1];
    if (latest === undefined)
      return {
        ...scope,
        found: false,
        said: 'nothing was refused or asked in this session',
      };
    return { ...scope, ...decisionOf(latest) };
  });
}

export async function statusTool(deps: SessionToolDeps): Promise<unknown> {
  return deps.readStatus(deps.home, deps.cwd);
}

/** The session step by step, compact: the newest steps, each one line. */
export async function replayTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const { scope, events } = await withEvents(deps.home, async (store) => {
    const found = await scopeOf(store, deps, textArg(args, 'session'));
    const rows =
      found.sessionId === null
        ? []
        : await store.query({ sessionId: found.sessionId, limit: LEDGER_SESSION_LIMIT });
    return { scope: found, events: rows };
  });
  if (scope.sessionId === null) return { ...scope, steps: [] };
  return compactReplay(deps, scope, events);
}

async function compactReplay(
  deps: SessionToolDeps,
  scope: SessionScope,
  events: MemnoxEvent[],
): Promise<unknown> {
  const sessionId = scope.sessionId ?? '';
  const replay = buildReplay({
    sessionId,
    events,
    pause: await new SessionPauses(deps.home).read(sessionId),
    pending: await new PendingApprovals(deps.home).list(deps.now().toISOString()),
    milestones: await deps.milestonesAt(deps.cwd),
  });
  return {
    ...scope,
    from: replay.startedAt,
    to: replay.endedAt,
    end: replay.end,
    ...(replay.endReason === undefined ? {} : { endReason: replay.endReason }),
    steps: replay.steps.map(
      (step) =>
        `${step.at} ${step.leadUp === true ? '> ' : ''}${step.summary}${step.by === undefined ? '' : `, by the ${step.by}`}${step.eventId === undefined ? '' : ` [${step.eventId}]`}`,
    ),
  };
}

/** What one action would meet, as argv or a namespaced verb, and the file it names. */
function requestsFor(
  action: string | undefined,
  path: string | undefined,
  env: NodeJS.ProcessEnv,
): ActionRequest[] {
  const target = path === undefined ? {} : { target: path };
  if (action === undefined) {
    return [ACTION.FILESYSTEM_READ, ACTION.FILESYSTEM_WRITE].map((verb) => ({
      action: verb,
      ...target,
    }));
  }
  if (!action.includes(' ') && action.includes('.')) return [{ action, ...target }];
  const argv = action.split(/\s+/);
  const resolved = resolveAction(argv[0] ?? action, argv.slice(1), env);
  if (path !== undefined) return [{ action: resolved.action, target: path }];
  return targetsRuledOn(resolved).map((each) => ({
    action: resolved.action,
    ...(each === undefined ? {} : { target: each }),
  }));
}

function verdictOf(
  request: ActionRequest,
  verdict: LocalVerdict,
): Record<string, unknown> {
  return {
    action: request.action,
    ...(request.target === undefined ? {} : { target: request.target }),
    effect: verdict.effect,
    reason: verdict.reason,
    rules: verdict.matchedPolicies.map((rule) => `${rule.name}: ${rule.effect}`),
    ...(verdict.alternative === undefined ? {} : { instead: verdict.alternative }),
  };
}

/** The rules and remembered decisions that cover an action or a path, evaluated and run nowhere. */
export async function decisionsTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const action = textArg(args, 'action');
  const path = textArg(args, 'path');
  if (action === undefined && path === undefined) {
    return { refused: 'name an action, a path, or both' };
  }
  const rules = await policySetInForce(deps.home);
  const gate = new LocalGate(rules.policies, { agentName: deps.agent });
  const requests = requestsFor(action, path, deps.env);
  const operations = new Set(requests.map((each) => each.action));
  const remembered = (await readLocalDecisions(deps.home)).filter((each) =>
    operations.has(each.operation),
  );
  return {
    agent: deps.agent,
    rules: requests.map((request) => verdictOf(request, gate.evaluate(request))),
    remembered: remembered.map((each) => ({
      operation: each.operation,
      effect: each.effect,
      decidedAt: each.decidedAt,
      ...(each.agent === undefined ? {} : { agent: each.agent }),
    })),
    said: 'Nothing was run and nothing changed. Only a person changes a rule, from "memnox protect" or the console.',
  };
}

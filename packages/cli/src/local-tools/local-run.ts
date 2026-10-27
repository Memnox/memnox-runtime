import { execFile } from 'node:child_process';
import {
  actionForCommand,
  classOf,
  DAEMON_METHOD,
  DECISION_EFFECT,
  inferToolEffect,
  redactSecrets,
  refineVerb,
  secondsToMs,
  targetIn,
  TOOL_CLASS,
  TOOL_EFFECT,
  verbTableFor,
  withOutgoingData,
  type DaemonResponse,
} from '@memnox/core';
import { socketDial } from '../remote/daemon-dial';
import type { PersonalAnswer, PersonalRun } from '../sync/personal-work';
import { LOCAL_SLUG, type LocalCli, type LocalServer } from './local-catalogue';
import type { McpPool } from './mcp-client';

/**
 * One call to a tool on this Mac, through the daemon's pauses, budgets, limits and rules as an agent's
 * call goes. A read runs on the voice's word and a change only after Touch ID; what comes back has its
 * secrets taken out and is marked as written by somebody else.
 */

/** Whose calls these are in the ledger and to every rule. */
const LOCAL_SESSION = 'memnox-operator';
const CLI_TIMEOUT_MS = secondsToMs(20);
const MOST_OUTPUT_BYTES = 1_000_000;

/** What a verdict says, as the daemon answers it; null when no daemon answered, which refuses. */
export interface LocalVerdict {
  effect: string;
  reason: string;
  alternative?: string;
}

/** The gate a local call passes, the daemon's own unless a test hands in another. */
export interface LocalGate {
  evaluate(
    action: string,
    target?: string,
    dataClassification?: string,
  ): Promise<LocalVerdict | null>;
  record(action: string, target: string | undefined, exitCode: number): Promise<void>;
}

export function daemonGate(home: string): LocalGate {
  const dial = socketDial(home);
  return {
    evaluate: async (action, target, dataClassification) =>
      verdictOf(
        await dial.ask({
          id: Date.now(),
          method: DAEMON_METHOD.EVALUATE,
          action,
          sessionId: LOCAL_SESSION,
          ...(target === undefined ? {} : { target }),
          ...(dataClassification === undefined ? {} : { dataClassification }),
        }),
      ),
    record: async (action, target, exitCode) => {
      await dial
        .ask({
          id: Date.now(),
          method: DAEMON_METHOD.RECORD,
          action,
          sessionId: LOCAL_SESSION,
          exitCode,
          ...(target === undefined ? {} : { target }),
        })
        .catch(() => null);
    },
  };
}

function verdictOf(answer: DaemonResponse | null): LocalVerdict | null {
  if (answer === null || answer.ok !== true || answer.effect === undefined) return null;
  return {
    effect: answer.effect,
    reason: answer.reason ?? '',
    ...(answer.alternative === undefined ? {} : { alternative: answer.alternative.note }),
  };
}

interface LocalRunDeps {
  servers: () => Promise<LocalServer[]>;
  clis: () => Promise<LocalCli[]>;
  pool: McpPool;
  gate: LocalGate;
  /** Runs a binary with no shell; injected so a test runs none. */
  exec?: RunBinary;
}

export type RunBinary = (
  path: string,
  argv: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

const runBinary: RunBinary = (path, argv) =>
  new Promise((resolve) => {
    execFile(
      path,
      [...argv],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: MOST_OUTPUT_BYTES, env: process.env },
      (err, stdout, stderr) => {
        const code = err === null ? 0 : typeof err.code === 'number' ? err.code : 1;
        resolve({ exitCode: code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export function isLocalSlug(slug: string): boolean {
  return slug.startsWith(LOCAL_SLUG.MCP) || slug.startsWith(LOCAL_SLUG.CLI);
}

/** One planned call: what the gate is asked about, whether it changes anything, and how it runs. */
interface Planned {
  action: string;
  target?: string;
  /** What goes out, classified the way an agent's call is, so a rule on customer data holds here too. */
  payload: unknown;
  changes: boolean;
  run: () => Promise<{ exitCode: number; data: Record<string, unknown> }>;
}

/** Runs a local tool; `confirmed` is the person's Touch ID on exactly this tool and these arguments. */
export async function runLocalTool(
  deps: LocalRunDeps,
  slug: string,
  argumentsText: string,
  confirmed: boolean,
): Promise<PersonalAnswer<PersonalRun>> {
  const args = objectOf(argumentsText);
  if (args === null) return refused('Pass arguments as a JSON object.');
  const planned = slug.startsWith(LOCAL_SLUG.CLI)
    ? await planCli(deps, slug.slice(LOCAL_SLUG.CLI.length), args)
    : await planMcp(deps, slug.slice(LOCAL_SLUG.MCP.length), args);
  if ('said' in planned) return refused(planned.said);
  if (planned.changes && !confirmed) {
    return refused(
      'That changes something, so it is not run on your word alone: write it down with propose_tool, and it runs once they confirm with Touch ID.',
    );
  }
  const verdict = await strictest(deps.gate, planned);
  if (verdict === null)
    return refused(
      'Memnox could not check that against the rules just now, so it was not run.',
    );
  if (verdict.effect === DECISION_EFFECT.DENY)
    return refused(`A rule stops that: ${verdict.reason}${insteadOf(verdict)}`);
  // An ask is answered by the person's own Touch ID on this very call, and by nothing less.
  if (verdict.effect === DECISION_EFFECT.ASK && !confirmed) {
    return refused(
      `A rule asks the person first: ${verdict.reason}. Write it down with propose_tool so they can confirm it with Touch ID.`,
    );
  }
  const ran = await planned.run();
  await deps.gate.record(planned.action, planned.target, ran.exitCode);
  return {
    ok: true,
    value: {
      workClass: planned.changes ? 'act' : 'read',
      data: { ...ran.data, untrusted: true },
    },
  };
}

async function planCli(
  deps: LocalRunDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<Planned | { said: string }> {
  const cli = (await deps.clis()).find((each) => each.name === name);
  const table = verbTableFor(name);
  if (cli === undefined || table === null)
    return { said: `${name} is not signed in on this Mac.` };
  const argv = Array.isArray(args['args'])
    ? args['args'].filter((each) => typeof each === 'string')
    : [];
  if (argv.length === 0)
    return { said: `Pass args: the words after ${name}, as a list.` };
  const verb = refineVerb(table, argv, classOf(table, argv));
  const target = targetIn(verb, argv);
  return {
    action: actionForCommand(name, table, argv, verb),
    ...(target === undefined ? {} : { target }),
    payload: { args: argv },
    changes: verb.class !== TOOL_CLASS.READ,
    run: async () => {
      const done = await (deps.exec ?? runBinary)(cli.path, argv);
      return {
        exitCode: done.exitCode,
        data: {
          exitCode: done.exitCode,
          output: redactSecrets(done.stdout),
          ...(done.stderr === '' ? {} : { errors: redactSecrets(done.stderr) }),
        },
      };
    },
  };
}

async function planMcp(
  deps: LocalRunDeps,
  rest: string,
  args: Record<string, unknown>,
): Promise<Planned | { said: string }> {
  const at = rest.indexOf(':');
  const serverName = at === -1 ? rest : rest.slice(0, at);
  const toolName = at === -1 ? '' : rest.slice(at + 1);
  const server = (await deps.servers()).find((each) => each.name === serverName);
  if (server === undefined || toolName === '')
    return { said: `No MCP server called ${serverName} is set up on this Mac.` };
  const session = deps.pool.session(server.name, server.launch);
  let declared;
  try {
    declared = (await session.tools()).find((each) => each.name === toolName);
  } catch {
    // Said rather than thrown: the voice tells the person in a sentence.
    return { said: `${serverName} would not start on this Mac just now.` };
  }
  if (declared === undefined)
    return { said: `${serverName} has no tool called ${toolName}.` };
  return {
    action: `mcp.${server.name}.${toolName}`,
    target: server.name,
    payload: args,
    changes: inferToolEffect(declared).effect !== TOOL_EFFECT.READ,
    run: () => callServer(session, toolName, args),
  };
}

async function callServer(
  session: ReturnType<McpPool['session']>,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ exitCode: number; data: Record<string, unknown> }> {
  try {
    const result = await session.call(toolName, args);
    return { exitCode: 0, data: { result: withoutSecrets(result) } };
  } catch (err) {
    const said = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, data: { error: redactSecrets(said) } };
  }
}

/** The result with any secret it carried taken out, as data where that still parses and as text where not. */
function withoutSecrets(result: unknown): unknown {
  const text = redactSecrets(JSON.stringify(result) ?? 'null');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A redaction landed across the JSON's own punctuation, so the text is what is left to read.
    return text;
  }
}

/** Deny before ask before allow, so the strictest of the call's readings decides it. */
const EFFECT_WEIGHT: Readonly<Record<string, number>> = {
  [DECISION_EFFECT.ALLOW]: 0,
  [DECISION_EFFECT.ASK]: 1,
  [DECISION_EFFECT.DENY]: 2,
};

/**
 * The call as the gate sees it, once where it stands and once for each place its payload goes
 * where that payload is sensitive, exactly as an agent's MCP call is asked. Null where any
 * reading went unanswered, which refuses.
 */
async function strictest(
  gate: LocalGate,
  planned: Planned,
): Promise<LocalVerdict | null> {
  const asked = withOutgoingData<{ target?: string; dataClassification?: string }>(
    planned.target === undefined ? {} : { target: planned.target },
    planned.payload,
  );
  let worst: LocalVerdict | null = null;
  for (const each of asked) {
    const verdict = await gate.evaluate(
      planned.action,
      each.target,
      each.dataClassification,
    );
    if (verdict === null) return null;
    if (worst === null || weightOf(verdict) > weightOf(worst)) worst = verdict;
  }
  return worst;
}

function weightOf(verdict: LocalVerdict): number {
  // An effect this file does not know is treated as the strictest, never as an allow.
  return EFFECT_WEIGHT[verdict.effect] ?? EFFECT_WEIGHT[DECISION_EFFECT.DENY] ?? 2;
}

function insteadOf(verdict: LocalVerdict): string {
  return verdict.alternative === undefined ? '' : `. Instead: ${verdict.alternative}`;
}

function refused<T>(said: string): PersonalAnswer<T> {
  return { ok: false, said };
}

function objectOf(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>) // a plain object, checked just above
      : null;
  } catch {
    // Not JSON, so there is nothing to run.
    return null;
  }
}

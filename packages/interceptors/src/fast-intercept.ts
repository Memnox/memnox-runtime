import { existsSync } from 'node:fs';

import {
  agentBehind,
  BROKER_VAR,
  DECISION_EFFECT,
  destructiveCommand,
  EXIT,
  HoldService,
  INTERCEPT_PLAN,
  isBrowserLauncher,
  overlaysInForce,
  pathValueOf,
  protectionStopped,
  provenanceOf,
  SESSION_VAR,
  touchesProtected,
  type AncestorArgv,
  type LocalGate,
} from '@memnox/core';

import { pauseHolding, pauseMessage } from './breaker-seam';
import type { Checkout } from './git-branch';
import { readHookConfig, type HookConfig } from './hook-config';
import { loadHookGate, type SeamScene } from './hook-gate-loader';
import {
  adviceLine,
  invokedFor,
  realPath,
  resolveReal,
  ruleOnCommand,
  type InterceptOutcome,
} from './interceptor';
import { ancestorsOf } from './process-ancestry';
import { readMachineMode } from './tool-hook';
import { repositoryRootOf } from './seam-runtime';
import type { RecordInput } from './record';
import { shellAction } from './shell-action';

/**
 * What `memnox-intercept` would do with one command line, worked out in the daemon for the
 * native wrapper. Every step is the Node interceptor's own function; wherever the daemon
 * could not reproduce the answer exactly, the plan is `node` and the Node one decides.
 */

/** What the native wrapper sent: the command, and the process it would run in. */
export interface FastScene {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  ppid: number;
}

export interface FastInterceptDeps {
  home: string;
  /** The daemon's own directory, which self protection resolves a relative target against. */
  ownCwd?: string;
  /** The daemon's own environment, which its git calls run with. */
  ownEnv?: NodeJS.ProcessEnv;
  ancestors?: (pid: number) => AncestorArgv[];
  rootOf?: (cwd: string) => string | null;
  exists?: (candidate: string) => boolean;
  /** Injected, so a test states the rules rather than writing policy files. */
  gateFor?: (
    config: HookConfig,
    scene: SeamScene,
    warn: (message: string) => void,
  ) => Promise<LocalGate | null>;
  now?: () => Date;
}

/** The row an allowed command is recorded with, finished once it reports how it ended. */
export interface PendingRun {
  row: RecordInput;
  /** Milliseconds, so the duration covers what the Node path's did. */
  started: number;
  outOfScope: boolean;
}

export type FastPlan =
  | { kind: typeof INTERCEPT_PLAN.NODE; why: string }
  | { kind: typeof INTERCEPT_PLAN.PASS; real: string; path: string }
  | {
      kind: typeof INTERCEPT_PLAN.REFUSE;
      notes: string[];
      exitCode: number;
      /** Absent for a pause, which the Node path does not record either. */
      row?: RecordInput;
    }
  | {
      kind: typeof INTERCEPT_PLAN.RUN;
      real: string;
      path: string;
      notes: string[];
      pending: PendingRun;
    };

function node(why: string): FastPlan {
  return { kind: INTERCEPT_PLAN.NODE, why };
}

/** The same order as the Node interceptor's main, step for step. */
export async function planIntercept(
  scene: FastScene,
  deps: FastInterceptDeps,
): Promise<FastPlan> {
  const located = locate(scene, deps);
  if (typeof located === 'string') return node(located);
  if (await passesThrough(scene, deps)) {
    return { kind: INTERCEPT_PLAN.PASS, real: located.real, path: located.path };
  }
  const sessionId = scene.env[SESSION_VAR];
  const held = await pauseHolding(deps.home, sessionId);
  if (held !== null) {
    return {
      kind: INTERCEPT_PLAN.REFUSE,
      notes: [pauseMessage(held)],
      exitCode: EXIT.FAILED,
    };
  }
  const ruling = await rule(located, scene, deps, sessionId);
  if (typeof ruling === 'string') return node(ruling);
  const now = deps.now ?? ((): Date => new Date());
  return ruling.outcome.allowed ? runPlan(located, ruling, now) : refusePlan(ruling, now);
}

/** The command and the real binary behind it, or why the daemon cannot find it as Node would. */
interface Located {
  binary: string;
  args: string[];
  real: string;
  path: string;
}

function locate(scene: FastScene, deps: FastInterceptDeps): Located | string {
  const { env } = scene;
  // node, then the interceptor's own path: the argv the Node one would be handed.
  const invocation = invokedFor(['node', 'memnox-intercept', ...scene.argv]);
  if (invocation === null) return 'not a wrapped binary';
  // Node reads its home from HOME, so another home is another set of rules.
  if (env['HOME'] !== deps.home) return 'a home the daemon does not serve';
  if ((env[BROKER_VAR] ?? '') !== '') return 'credentials come from a broker';
  // The repository is found by a git that runs with the daemon's environment, not the agent's.
  if (findsRepositoryElsewhere(env, deps.ownEnv ?? process.env)) {
    return 'git would look for the repository differently';
  }
  const path = realPath(pathValueOf(env), deps.home);
  const real = resolveReal(invocation.binary, path, deps.exists ?? existsSync);
  if (real === null) return 'not on PATH, which Node says in its own words';
  return { ...invocation, real, path };
}

/** A person at the keyboard, or protection stopped: nothing stands between them and the binary. */
async function passesThrough(
  scene: FastScene,
  deps: FastInterceptDeps,
): Promise<boolean> {
  const ancestors = deps.ancestors ?? ancestorsOf;
  // The markers first, so the process walk is paid only where they say nothing.
  const person =
    agentBehind(scene.env, []) === null &&
    agentBehind(scene.env, ancestors(scene.ppid)) === null;
  return person || (await protectionStopped(deps.home));
}

/** The verdict with what it is recorded against, read once as the Node interceptor reads it. */
interface Ruling {
  outcome: InterceptOutcome;
  notes: string[];
  base: Pick<RecordInput, 'outcome' | 'sessionId' | 'bundleHash' | 'conditionsInForce'>;
  started: number;
}

async function rule(
  located: Located,
  scene: FastScene,
  deps: FastInterceptDeps,
  sessionId: string | undefined,
): Promise<Ruling | string> {
  const { env, cwd } = scene;
  const notes: string[] = [];
  const gate = await gateIn(scene, deps, (message) => notes.push(`[memnox] ${message}`));
  const overlays = await overlaysInForce(deps.home);
  const now = deps.now ?? ((): Date => new Date());
  const provenance = await provenanceOf(deps.home, overlays, now().toISOString());
  const started = now().getTime();
  const terminal = noTerminal();
  const outcome = await ruleOnCommand(located.binary, located.args, {
    ...(gate === null ? {} : { gate }),
    mode: await readMachineMode(deps.home),
    overlays,
    env,
    hold: terminal.hold,
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  if (terminal.asked()) return 'a rule asks a person';
  const advice = adviceLine(outcome);
  if (advice !== null) notes.push(advice);
  // Self protection resolves against the process directory, and this one is the daemon's.
  if (
    outcome.target !== undefined &&
    protectedAnywhere(outcome.target, cwd, deps.ownCwd)
  ) {
    return 'the target may be a protected path';
  }
  const session = sessionId === undefined ? {} : { sessionId };
  return { outcome, notes, base: { ...provenance, outcome, ...session }, started };
}

/** Asking needs the agent's terminal, which only the Node interceptor has, so this only notes it. */
function noTerminal(): { hold: HoldService; asked: () => boolean } {
  let asked = false;
  const hold = new HoldService({
    ask: async () => {
      asked = true;
      return null;
    },
  });
  return { hold, asked: () => asked };
}

async function gateIn(
  scene: FastScene,
  deps: FastInterceptDeps,
  warn: (message: string) => void,
): Promise<LocalGate | null> {
  const config = await readHookConfig(scene.env, deps.home);
  const seam: SeamScene = {
    cwd: scene.cwd,
    env: scene.env,
    rootOf: once(deps.rootOf ?? repositoryRootOf),
  };
  if (deps.gateFor !== undefined) return deps.gateFor(config, seam, warn);
  const now = deps.now ?? ((): Date => new Date());
  return loadHookGate(config, deps.home, () => now().toISOString(), warn, seam);
}

function refusePlan(ruling: Ruling, now: () => Date): FastPlan {
  const { outcome } = ruling;
  if (outcome.edited !== undefined) return node('a person typed a replacement');
  return {
    kind: INTERCEPT_PLAN.REFUSE,
    notes: [...ruling.notes, outcome.message ?? 'denied'],
    exitCode: EXIT.FAILED,
    row: {
      ...ruling.base,
      effect: DECISION_EFFECT.DENY,
      reason: outcome.reason ?? 'denied',
      ...(outcome.rule === undefined ? {} : { rule: outcome.rule }),
      at: now().toISOString(),
    },
  };
}

/** What the Node interceptor does around running it, each of which only Node can do. */
function runPlan(located: Located, ruling: Ruling, now: () => Date): FastPlan {
  const { binary, args } = located;
  const { outcome } = ruling;
  if (isBrowserLauncher(binary)) return node('a browser is ruled on by where it goes');
  if (mayBeClaimed(binary, args, outcome)) return node('another agent may hold it');
  if (destructiveCommand([binary, ...args]) !== null)
    return node('a milestone comes first');
  return {
    kind: INTERCEPT_PLAN.RUN,
    real: located.real,
    path: located.path,
    notes: ruling.notes,
    pending: {
      row: {
        ...ruling.base,
        effect: DECISION_EFFECT.ALLOW,
        reason: outcome.reason ?? 'no rule matched',
        ...(outcome.rule === undefined ? {} : { rule: outcome.rule }),
        at: now().toISOString(),
      },
      started: ruling.started,
      outOfScope: outcome.outOfScope === true,
    },
  };
}

/** Variables that change which repository git finds, or how it reads its configuration. */
const GIT_DISCOVERY =
  /^(GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM|GIT_CONFIG.*|XDG_CONFIG_HOME)$/;

function findsRepositoryElsewhere(
  env: NodeJS.ProcessEnv,
  own: NodeJS.ProcessEnv,
): boolean {
  const names = new Set([...Object.keys(env), ...Object.keys(own)]);
  return [...names].some((name) => GIT_DISCOVERY.test(name) && env[name] !== own[name]);
}

/** One answer per plan: the repository a command runs in does not move while it is ruled on. */
function once(rootOf: (cwd: string) => string | null): (cwd: string) => string | null {
  const known = new Map<string, string | null>();
  return (cwd) => {
    if (!known.has(cwd)) known.set(cwd, rootOf(cwd));
    return known.get(cwd) ?? null;
  };
}

function protectedAnywhere(
  target: string,
  cwd: string,
  ownCwd: string | undefined,
): boolean {
  return (
    touchesProtected(target, cwd) || touchesProtected(target, ownCwd ?? process.cwd())
  );
}

/**
 * Whether the claim register could be asked, where any question about the checkout counts
 * as yes: that question would be answered from the daemon's directory, not the agent's.
 */
function mayBeClaimed(
  binary: string,
  args: readonly string[],
  outcome: InterceptOutcome,
): boolean {
  let consulted = false;
  const doubt = (): null => {
    consulted = true;
    return null;
  };
  const checkout: Checkout = { currentBranch: doubt, remoteUrl: doubt };
  const action = shellAction(binary, args, outcome, { repositoryOf: doubt, checkout });
  return consulted || action !== null;
}

/** The finished row, as `recordAllowed` writes it once the command has ended. */
export function finishedRow(
  pending: PendingRun,
  exitCode: number | undefined,
  now: () => Date = () => new Date(),
): RecordInput {
  const at = now();
  return {
    ...pending.row,
    at: at.toISOString(),
    ...(exitCode === undefined ? {} : { exitCode }),
    durationMs: at.getTime() - pending.started,
  };
}

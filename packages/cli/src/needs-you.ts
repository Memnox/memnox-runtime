import { readFile } from 'node:fs/promises';
import { basename, delimiter, join } from 'node:path';
import {
  CODEX_HOOK_TRUST,
  interceptorDirFor,
  MEMNOX_HOME,
  pathValueOf,
  readJsonFile,
  writeJsonFile,
  type CodexHookStanding,
} from '@memnox/core';
import { readCodexHookStanding } from './agents/codex-hooks';
import { EDIT_HOOK_TARGETS } from './protect/agent-hooks';
import { DEFAULT_SHELL, loginPathConfigured } from './protect/shell-profile';

/**
 * What only the person can do before everything setup wrote is in force, said at the end of
 * the run: an approval in another app, a restart, a new terminal. Each is said only when true,
 * because a list of maybes is a list nobody acts on.
 */

/** The agents that load Memnox as a plugin in their own process, read once when they start. */
const PLUGIN_HOSTS: readonly string[] = ['Hermes', 'OpenClaw', 'OpenCode'];

/** What setup found, from which the actions follow. */
interface PendingFacts {
  codex: CodexHookStanding;
  /** The login profile puts the interceptors first and this terminal's PATH does not. */
  staleTerminal: boolean;
  /** The agents whose hook or plugin this run wrote or changed, by the name a screen prints. */
  changed: readonly string[];
}

/** One thing the person has to do, in the words they act on. */
export function pendingActions(facts: PendingFacts): string[] {
  const actions: string[] = [];
  if (facts.codex.trust === CODEX_HOOK_TRUST.UNTRUSTED) {
    const events = (facts.codex.untrusted ?? []).join(', ');
    actions.push(`Approve the Memnox hooks in Codex: open /hooks and trust ${events}.`);
  }
  if (facts.codex.trust === CODEX_HOOK_TRUST.NOT_LOADED) {
    actions.push('Turn on hooks in Codex, then approve the Memnox hooks in /hooks.');
  }
  const restart = facts.changed.filter((name) => PLUGIN_HOSTS.includes(name));
  if (restart.length > 0) {
    actions.push(
      `Restart ${listed(restart)}, which ${restart.length === 1 ? 'loads' : 'load'} the Memnox plugin only when ${restart.length === 1 ? 'it starts' : 'they start'}.`,
    );
  }
  const sessions = facts.changed.filter((name) => !PLUGIN_HOSTS.includes(name));
  if (sessions.length > 0) {
    actions.push(
      `Start new sessions in ${listed(sessions)}, since sessions already open run without the new hook.`,
    );
  }
  if (facts.staleTerminal) {
    actions.push(
      'Open a new terminal, since this one started before the interceptors were on PATH.',
    );
  }
  return actions;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The text of every hooks file setup may write, taken before it does, to tell what it changed. */
export async function hookFilesOf(home: string): Promise<Map<string, string | null>> {
  const files = new Map<string, string | null>();
  for (const target of EDIT_HOOK_TARGETS) {
    files.set(
      target.name,
      await readFile(join(home, target.file), 'utf8').catch(() => null),
    );
  }
  return files;
}

/** Everything the actions are worked out from, once the machine is wired. */
export async function pendingFactsOf(
  home: string,
  project: string,
  before: ReadonlyMap<string, string | null>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingFacts> {
  const after = await hookFilesOf(home);
  const changed = [...after]
    .filter(([name, text]) => text !== null && text !== before.get(name))
    .map(([name]) => name);
  const first = pathValueOf(env).split(delimiter)[0] === interceptorDirFor(home);
  const shell = basename(env['SHELL'] ?? DEFAULT_SHELL);
  return {
    codex: await readCodexHookStanding(home, project),
    staleTerminal: !first && (await loginPathConfigured(shell, home)),
    changed,
  };
}

/** Where setup leaves what it changed, so the home can keep saying it until the agent shows it took. */
const CHANGED_FILE = join(MEMNOX_HOME, 'pending.json');

/** One agent setup gave a new hook or plugin, and since when. */
interface ChangedAgent {
  agent: string;
  name: string;
  since: string;
}

export async function readChanged(home: string): Promise<ChangedAgent[]> {
  const parsed = await readJsonFile<unknown>(join(home, CHANGED_FILE));
  if (!Array.isArray(parsed)) return [];
  // A hand-edited file is untrusted input like any other: keep only well-formed entries.
  return parsed.filter(
    (each): each is ChangedAgent =>
      typeof each === 'object' &&
      each !== null &&
      typeof (each as ChangedAgent).agent === 'string' &&
      typeof (each as ChangedAgent).name === 'string' &&
      !Number.isNaN(Date.parse((each as ChangedAgent).since)),
  );
}

/** The agents this run changed, merged over what earlier runs left, each since this run. */
export async function recordChanged(
  home: string,
  names: readonly string[],
  at: string,
): Promise<void> {
  const fresh = EDIT_HOOK_TARGETS.filter((target) => names.includes(target.name)).map(
    (target) => ({ agent: target.agent, name: target.name, since: at }),
  );
  const kept = (await readChanged(home)).filter(
    (each) => !fresh.some((agent) => agent.agent === each.agent),
  );
  await writeJsonFile(join(home, CHANGED_FILE), [...kept, ...fresh]);
}

/** The changed agents nothing has been heard from since, which is the proof a restart is still owed. */
function stillChanged(
  changed: readonly ChangedAgent[],
  events: readonly { agent: string; at: string }[],
): ChangedAgent[] {
  return changed.filter(
    (each) =>
      !events.some((event) => event.agent === each.agent && event.at > each.since),
  );
}

/** How long Codex's answer is trusted before it is asked again, so the home never waits on Codex. */
const CODEX_FRESH_MS = 5 * 60_000;

let codexLately: { at: number; standing: CodexHookStanding } | null = null;
let askingCodex = false;

/** Codex's answer as last heard, asked again in the background once it is old. */
export function codexStandingLately(
  home: string,
  now: number,
  ask: (home: string, cwd: string) => Promise<CodexHookStanding> = readCodexHookStanding,
): CodexHookStanding {
  const stale = codexLately === null || now - codexLately.at > CODEX_FRESH_MS;
  if (stale && !askingCodex) {
    askingCodex = true;
    void ask(home, home)
      .then((standing) => {
        codexLately = { at: now, standing };
      })
      .catch(() => undefined)
      .finally(() => {
        askingCodex = false;
      });
  }
  return codexLately?.standing ?? { trust: CODEX_HOOK_TRUST.ABSENT };
}

/** What the home says needs the person: Codex's approval, and each change no agent has picked up yet. */
export function needsYouOf(
  changed: readonly ChangedAgent[],
  events: readonly { agent: string; at: string }[],
  codex: CodexHookStanding,
): string[] {
  const owed = stillChanged(changed, events).map((each) => each.name);
  return pendingActions({ codex, staleTerminal: false, changed: owed });
}

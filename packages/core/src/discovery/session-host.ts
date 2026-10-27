import { basename, join } from 'node:path';
import { agentShown } from '../gate/plain-ask';
import { MEMNOX_HOME } from '../config/config';
import { JsonRecordDir } from '../store/json-records';

/**
 * Where a session's agent is running on screen: the app hosting it and the terminal it has.
 * Noted once when the session starts, so "show me" can bring that window forward rather
 * than guess which of five terminals the agent is in.
 */

export const SESSION_HOSTS_DIR = 'session-hosts';

export interface SessionHost {
  sessionId: string;
  agent: string;
  /** The process the hook ran under, which ends when the session does. */
  pid: number;
  /** The outermost app bundle above it, such as `/Applications/iTerm.app`. */
  appPath?: string;
  /** The app as a person names it: `iTerm`, `Visual Studio Code`, `Claude`. */
  app?: string;
  /** The terminal device, such as `ttys004`, which is how a tab is found in Terminal and iTerm2. */
  tty?: string;
  /** Runs in an editor's own agent panel, so any terminal its process inherited is not where it is typed into. */
  panel?: boolean;
  cwd?: string;
  /** The agent's own id when `memnox run` keys the ledger by another, which is what its transcript is named after. */
  agentSession?: string;
  seenAt: string;
  /** When the person closed it and its SessionEnd hook said so, which ends it whatever its pid now says. */
  endedAt?: string;
}

/** One process in a `ps` walk: its executable's full path, spaces kept, and its terminal. */
export interface HostProcess {
  pid: number;
  command: string;
  tty: string;
}

/** Shells between the hook and the agent, which end with the hook and so are never the agent. */
const SHELLS: readonly string[] = ['sh', 'bash', 'zsh', 'dash', 'fish', 'env'];

/** The agent's own process: the first one above the hook that is not a shell it ran through. */
export function agentProcessOf(chain: readonly HostProcess[]): HostProcess | undefined {
  return chain.find((each) => !SHELLS.includes(basename(each.command).replace(/^-/, '')));
}

/** Enough of a chain to hold agent, shells and the app, and never a walk up to launchd. */
const DEEPEST = 32;

/** What `ps` prints for a process with no terminal, `??` on macOS and `?` on Linux, which is not a tab anybody can find. */
const NO_TERMINAL: ReadonlySet<string> = new Set(['', '?', '??']);

/**
 * The app and terminal a chain of processes sits in, nearest first. The app is the outermost
 * one above the agent, never the agent's own bundle: Codex lives inside ChatGPT.app and still
 * runs in a Terminal tab, and an editor runs its terminal inside a helper nested in its bundle.
 */
export function hostOf(
  chain: readonly HostProcess[],
): Pick<SessionHost, 'app' | 'appPath' | 'tty'> {
  const tty = chain.find((each) => !NO_TERMINAL.has(each.tty))?.tty;
  const agent = agentProcessOf(chain);
  const above = chain.slice(agent === undefined ? 0 : chain.indexOf(agent) + 1, DEEPEST);
  const appPath = above
    .map((each) => outermostBundle(each.command))
    .filter((path) => path !== null)
    .pop();
  return {
    ...(tty === undefined ? {} : { tty }),
    ...(appPath === undefined || appPath === null
      ? {}
      : { appPath, app: basename(appPath).replace(/\.app$/, '') }),
  };
}

/** What Claude Code names the editor extension it was started by, as against `cli` in a terminal. */
const PANEL_ENTRYPOINTS: readonly string[] = ['claude-vscode'];

/**
 * Whether the agent was started by an editor's own panel. A terminal device alone cannot say:
 * an editor launched from a shell hands that shell's terminal to everything it starts.
 */
export function startedInPanel(entrypoint: string | undefined): boolean {
  return entrypoint !== undefined && PANEL_ENTRYPOINTS.includes(entrypoint);
}

/** Editors whose sessions run in their own terminal or in an agent's panel inside them. */
const EDITORS: readonly string[] = [
  'visual studio code',
  'code',
  'cursor',
  'windsurf',
  'zed',
];

/**
 * Where a session runs, in the words a person would use to find it: a Terminal tab, an
 * editor's own terminal, or an agent's panel inside the editor, with the folder it was opened on.
 */
export function describeHost(host: SessionHost): string | undefined {
  if (host.app === undefined) return undefined;
  const folder = host.cwd === undefined ? '' : `, opened on ${basename(host.cwd)}`;
  const editor = EDITORS.some((name) => host.app?.toLowerCase().includes(name) === true);
  if (!editor) return host.tty === undefined ? host.app : `a tab in ${host.app}${folder}`;
  return host.tty === undefined || host.panel === true
    ? `${host.app}, in its ${agentShown(host.agent)} panel${folder}`
    : `${host.app}, in its terminal${folder}`;
}

function outermostBundle(command: string): string | null {
  const at = command.indexOf('.app/');
  if (at === -1) return command.endsWith('.app') ? command : null;
  return command.slice(0, at + '.app'.length);
}

export class SessionHosts {
  private readonly records: JsonRecordDir<SessionHost>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, SESSION_HOSTS_DIR));
  }

  read(sessionId: string): Promise<SessionHost | null> {
    return this.records.read(idFor(sessionId));
  }

  /** Once per session: a second start of the same session keeps the first answer, bar the agent's own id. */
  async note(host: SessionHost): Promise<void> {
    const kept = await this.read(host.sessionId);
    // A closed session started again, as a resume does, is a fresh start rather than the closed one.
    if (kept === null || kept.endedAt !== undefined)
      return this.records.write(idFor(host.sessionId), host);
    // A cleared or resumed conversation under one `memnox run` is a new transcript in the same session.
    if (host.agentSession === undefined || host.agentSession === kept.agentSession)
      return;
    await this.records.write(idFor(host.sessionId), {
      ...kept,
      agentSession: host.agentSession,
    });
  }

  /** Marked ended when the person closes it, so it stops being tracked though its pid may live on. */
  async end(sessionId: string, at: string): Promise<void> {
    const kept = await this.read(sessionId);
    if (kept === null || kept.endedAt !== undefined) return;
    await this.records.write(idFor(sessionId), { ...kept, endedAt: at });
  }

  all(): Promise<SessionHost[]> {
    return this.records.all();
  }

  async forget(sessionId: string): Promise<void> {
    await this.records.remove(idFor(sessionId));
  }
}

/** A session id as a file name, since an agent's own ids can hold characters a path cannot. */
function idFor(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}

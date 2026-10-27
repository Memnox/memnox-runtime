import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * A new agent session the person asked for out loud: which agent, in which repository, on what
 * task. It is read back first and started only on their yes, the way a spoken instruction is.
 */

export const STARTS_DIR = 'starts';

/** What every start's id begins with, so a display that opens one is told from one typed into an open chat. */
export const START_ID_PREFIX = 'stt_';

/** Long enough to hear it read back and say yes, short enough that a stale one never starts. */
export const START_TTL_MS = 5 * 60 * 1_000;

/** The agents by the id the ledger keys them on and every tool names them by. */
export const AGENT_ID = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  CURSOR: 'cursor',
  HERMES: 'hermes',
} as const;

export type AgentId = (typeof AGENT_ID)[keyof typeof AGENT_ID];

/** The agents a voice may start, each with the one command that starts it; nothing else is ever typed. */
export const STARTABLE_AGENT = {
  [AGENT_ID.CLAUDE_CODE]: 'claude',
  [AGENT_ID.CODEX]: 'codex',
  /** Cursor's own terminal agent; the editor itself is reached through its desktop app instead. */
  [AGENT_ID.CURSOR]: 'cursor-agent',
  [AGENT_ID.HERMES]: 'hermes',
} as const;

export type StartableAgent = keyof typeof STARTABLE_AGENT;

/**
 * Where each agent's command is installed when it is not on PATH, `~` for the home folder.
 * Codex most often arrives inside the ChatGPT app, which never puts it on PATH.
 */
export const INSTALL_PLACES: Readonly<Record<StartableAgent, readonly string[]>> = {
  'claude-code': [
    '~/.claude/local/claude',
    '~/.local/bin/claude',
    '/opt/homebrew/bin/claude',
  ],
  codex: [
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '~/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '~/Applications/ChatGPT.app/Contents/Resources/codex',
    '~/.local/bin/codex',
    '/opt/homebrew/bin/codex',
  ],
  cursor: ['~/.local/bin/cursor-agent', '/opt/homebrew/bin/cursor-agent'],
  hermes: ['~/.local/bin/hermes', '/opt/homebrew/bin/hermes'],
};

/** What goes between an agent's command and its task, for an agent that takes no bare task. */
const TASK_FLAG: Partial<Record<StartableAgent, string>> = {
  /** On a terminal, `chat -q` seeds an interactive session with the task as its first turn. */
  hermes: 'chat -q',
};

export interface SessionStart {
  id: string;
  agent: StartableAgent;
  /** What starts it: its bare command when the shell finds it, else the full path it was found at. */
  command: string;
  /**
   * The repository's root, checked to exist before it was ever proposed; absent only for a chat in
   * an agent's desktop app the person named no folder for, since a chat needs none.
   */
  repository?: string;
  task: string;
  /** Started with `--hold-credentials`, so its environment carries no token for it to leak. */
  holdCredentials?: boolean;
  /** The workspace brief the agent is handed before its first turn, when the person named work. */
  brief?: string;
  /** The agent's desktop app bundle, when it starts there rather than in a terminal tab. */
  app?: string;
  /** The editor's app bundle, when it starts in a new terminal inside that editor rather than a terminal tab. */
  editor?: string;
  /** tmux or WezTerm, when it starts in a new window of the one running here. */
  pane?: string;
  /** In the editor's Claude Code panel as a new conversation, rather than in a terminal inside the editor. */
  panel?: boolean;
  /** Any other terminal app's bundle, such as Ghostty, when it starts in a new window there. */
  terminal?: string;
  said?: string;
  proposedAt: string;
  expiresAt: string;
}

export interface StartProposal {
  agent: StartableAgent;
  command: string;
  repository?: string;
  task: string;
  holdCredentials?: boolean;
  brief?: string;
  app?: string;
  editor?: string;
  pane?: string;
  panel?: boolean;
  terminal?: string;
  said?: string;
  at: string;
}

export function isStartableAgent(agent: string): agent is StartableAgent {
  return Object.hasOwn(STARTABLE_AGENT, agent);
}

/**
 * One line, because a `cd` sent on its own reached the shell after the agent and started it at home.
 * Every value is single quoted, so a path or a task can say anything and still only be words.
 */
export function startCommand(start: SessionStart): string {
  const task = start.task.split(/\r?\n/).join(' ').trim();
  const command = BARE_COMMAND.test(start.command)
    ? start.command
    : shellQuoted(start.command);
  const hold = start.holdCredentials === true ? ' --hold-credentials' : '';
  const brief = start.brief === undefined ? '' : ` --brief ${shellQuoted(start.brief)}`;
  // A terminal start always has its folder, so the cd is left out only of a start that never runs in one.
  const into =
    start.repository === undefined ? '' : `cd ${shellQuoted(start.repository)} && `;
  const run = `${into}memnox run${hold}${brief} -- ${command}`;
  // Nothing to do yet starts the agent waiting for its first prompt, never on a made-up task.
  if (task === '') return run;
  const flag = TASK_FLAG[start.agent];
  return `${run}${flag === undefined ? '' : ` ${flag}`} ${shellQuoted(task)}`;
}

/** A command name a shell reads as one word as it is, which a path with a space in it is not. */
const BARE_COMMAND = /^[a-z][a-z0-9-]*$/;

/** Single quoted for a POSIX shell, with each quote inside closed, escaped and reopened. */
export function shellQuoted(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export class SessionStarts {
  private readonly records: JsonRecordDir<SessionStart>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, STARTS_DIR));
  }

  async propose(input: StartProposal): Promise<SessionStart> {
    const start: SessionStart = {
      id: `${START_ID_PREFIX}${Date.parse(input.at).toString(36)}_${shortDigest(`${input.repository ?? ''}${input.task}`)}`,
      agent: input.agent,
      command: input.command,
      ...(input.repository === undefined ? {} : { repository: input.repository }),
      task: input.task,
      ...(input.holdCredentials === true ? { holdCredentials: true } : {}),
      ...(input.brief === undefined ? {} : { brief: input.brief }),
      ...(input.app === undefined ? {} : { app: input.app }),
      ...(input.editor === undefined ? {} : { editor: input.editor }),
      ...(input.pane === undefined ? {} : { pane: input.pane }),
      ...(input.panel === true ? { panel: true } : {}),
      ...(input.terminal === undefined ? {} : { terminal: input.terminal }),
      ...(input.said === undefined ? {} : { said: input.said }),
      proposedAt: input.at,
      expiresAt: new Date(Date.parse(input.at) + START_TTL_MS).toISOString(),
    };
    await this.records.write(start.id, start);
    return start;
  }

  /** Read back and still waiting on a yes, so a brain that lost the thread can still be told. */
  async waiting(moment: string): Promise<SessionStart[]> {
    return (await this.records.all()).filter((each) => each.expiresAt > moment);
  }

  /** Taken once: a second yes to the same start finds nothing, so no session starts twice. */
  async take(id: string, moment: string): Promise<SessionStart | null> {
    const start = await this.records.read(id);
    if (start === null) return null;
    await this.records.remove(id);
    return start.expiresAt > moment ? start : null;
  }
}

import { basename } from 'node:path';
import {
  AGENT_ID_PREFIX,
  buildReplay,
  LEDGER_SESSION_LIMIT,
  Milestones,
  NodeGit,
  NodeWorktree,
  REPLAY_STEP,
  SessionHosts,
  SPEAKER,
  statementOfPrompt,
  type CardExcerpt,
  type CardFile,
  type DisplayHost,
  type SessionCard,
  type SessionHost,
  type ConversationLine,
  type SessionView,
  type SessionViewStep,
} from '@memnox/core';
import { displayName, readNames } from '../agents/names';
import { readStatus } from '../commands/status.command';
import { withEvents } from '../event-store';
import type { SessionToolDeps } from '../session-tools/read-tools';
import type { RewindSeams } from '../session-tools/rewind-tool';
import { SESSION_STATE, sessionsTool } from '../session-tools/sessions-tool';
import { excerptOf } from '../session-tools/show-tool';
import {
  readConversation,
  readLastAnswer,
  latestPersonLine,
  readLatestAsk,
  readOpeningAsk,
  sessionFocus,
  sessionTranscript,
} from './transcript';
import { sessionSpokenToAt } from './spoken-to';
import { branchAt, repositoryAround } from '../session-tools/repository-root';
import {
  desktopConversation,
  desktopRoots,
  desktopSessionById,
} from './desktop-sessions';
import { changesIn, fileDiff } from './session-changes';
import { stepOf } from './session-view-steps';
import { conversationOf } from './waiting-feed';
import { readBrainSessions } from '../operator/brain-sessions';
import { idsOf } from '../session-tools/session-aliases';
import {
  hermesCards,
  hermesLastAnswer,
  hermesView,
  isHermesSession,
} from './hermes-view';

/**
 * A session as it is right now, for the live window the Mac app opens on it: the same facts
 * the voice reads from sessions, replay and changes, gathered in one answer it can poll.
 */

/** The whole session as the live window keeps it, read again every two seconds; a ledger row is a short line. */
const MOST_STEPS = 300;
/** Every file a session is likely to touch, so the counts over them add up to the real change. */
const MOST_FILES = 60;
/** The window polls every couple of seconds, and a diff of the tree is not that cheap. */
const FILES_FRESH_MS = 8_000;
/** As much of the agent's last answer as a card shows, where the work stands rather than the whole report. */
const MOST_LAST_SAID_CHARS = 320;

interface SessionRow {
  session: string;
  agent: string;
  task?: string;
  lastAsk?: string;
  state: string;
  turn?: string;
  repositories: string[];
  runningIn?: string;
  where?: string;
  started?: string;
  lastActive?: string;
  promptedAt?: string;
  waitingOnYou: number;
  actions?: number;
  paused?: string;
  notAnAgent?: string;
  subagents?: {
    launched: { description: string }[];
    working: { type?: string; lastTool?: string }[];
  };
}

/** As many lines as a Claude Code transcript shows in the live window. */
const MOST_DESKTOP_LINES = 160;

export class SessionViews {
  private readonly files = new Map<string, { at: number; code: Code }>();
  /** Each session's first request once found, since it never changes and the card asks every poll. */
  private readonly openings = new Map<string, string>();

  constructor(
    private readonly home: string,
    private readonly now: () => Date = () => new Date(),
    /** Where the agent's own home is, which holds its transcripts; the same home outside tests. */
    private readonly transcripts: string = home,
  ) {}

  /**
   * The sessions lately as cards, in the order the person last worked in them, for the switcher and the voice.
   * Ordered before the cut, since an agent busy on its own would otherwise push the one they were in off it.
   */
  async list(): Promise<SessionCard[]> {
    const names = await readNames(this.home);
    const hosts = new SessionHosts(this.home);
    const cards = await Promise.all(
      (await this.rowsInOrder()).slice(0, MOST_CARDS).map(async ({ row, spokenToAt }) =>
        cardOf(row, names, {
          host: await hosts.read(row.session),
          focus: await sessionFocus(this.home, row.session, this.transcripts).catch(
            () => null,
          ),
          spokenToAt,
        }),
      ),
    );
    // Hermes keys no session in the ledger, so its own are read beside, ordered with the rest.
    const hermes = hermesCards(this.transcripts, this.now(), nameOf(names, 'hermes'), {
      ownSessions: await readBrainSessions(this.home),
    });
    return [...cards, ...hermes]
      .sort((a, b) => byPersonFirst(a.spokenToAt, a, b.spokenToAt, b))
      .slice(0, MOST_CARDS);
  }

  /** Every open session with when the person last wrote to it, newest first, read before any is cut. */
  private async rowsInOrder(): Promise<{ row: SessionRow; spokenToAt?: string }[]> {
    const rows = ((await sessionsTool(this.deps(), { hours: '72' })) as SessionRow[])
      .filter((each) => each.notAnAgent === undefined)
      // A session the person closed is not theirs to track any more, on screen or in what the voice knows.
      .filter((each) => each.state !== SESSION_STATE.ENDED);
    const read = await Promise.all(
      rows.map(async (row) => {
        const at = await sessionSpokenToAt(
          this.home,
          row.session,
          row.promptedAt,
          this.transcripts,
        );
        return at === undefined ? { row } : { row, spokenToAt: at };
      }),
    );
    return read.sort((a, b) => byPersonFirst(a.spokenToAt, a.row, b.spokenToAt, b.row));
  }

  async view(sessionId: string): Promise<SessionView | null> {
    if (isHermesSession(sessionId)) {
      const names = await readNames(this.home);
      const agentName = nameOf(names, 'hermes');
      return hermesView(this.transcripts, sessionId, { now: this.now(), agentName });
    }
    const deps = this.deps();
    const rows = (await sessionsTool(deps, { hours: '72' })) as SessionRow[];
    const row = rows.find((each) => each.session === sessionId);
    if (row === undefined) return null;
    const [steps, code, names, host, lastSaid, latestAsk] = await Promise.all([
      this.steps(sessionId),
      this.changed(deps, sessionId),
      readNames(this.home),
      new SessionHosts(this.home).read(sessionId).catch(() => null),
      this.lastAnswer(sessionId).catch(() => null),
      this.latestAsk(sessionId).catch(() => undefined),
    ]);
    // A session that only ran commands wrote nowhere, so the folder it was opened in names its repository.
    const opened = host?.cwd === undefined ? null : repositoryAround(host.cwd);
    const repository = row.repositories[0] ?? opened ?? undefined;
    const root = repository === undefined ? null : repositoryAround(repository);
    const branch = root === null ? null : branchAt(root);
    const task = row.task ?? (await this.openingAsk(sessionId));
    return viewOf(row, {
      sessionId,
      agentName: nameOf(names, row.agent),
      steps,
      code,
      task,
      repository,
      branch,
      lastSaid,
      latestAsk,
      conversation: await this.conversation(sessionId),
    });
  }

  /**
   * What the person last typed, from the agent's own transcript, which marks a helper's report or a harness notice
   * as not theirs; undefined where no transcript is readable, so the ask the prompt hook kept stands in.
   */
  private async latestAsk(sessionId: string): Promise<string | null | undefined> {
    const desktop = desktopSessionById(desktopRoots(this.home), sessionId);
    if (desktop !== null) {
      return latestPersonLine(desktopConversation(desktop));
    }
    const path = await sessionTranscript(this.home, sessionId, this.transcripts);
    return path === null ? undefined : readLatestAsk(path);
  }

  /** What the agent said to end its latest turn, in full, for the voice to answer "what did it find". */
  async lastAnswer(sessionId: string): Promise<string | null> {
    if (isHermesSession(sessionId)) return hermesLastAnswer(this.transcripts, sessionId);
    const path = await sessionTranscript(this.home, sessionId, this.transcripts);
    return path === null ? null : readLastAnswer(path);
  }

  /** What the session was opened for when no task was noted: the person's first request in it, kept once found. */
  private async openingAsk(sessionId: string): Promise<string | undefined> {
    const kept = this.openings.get(sessionId);
    if (kept !== undefined) return kept;
    const desktop = desktopSessionById(desktopRoots(this.home), sessionId);
    const path =
      desktop === null
        ? await sessionTranscript(this.home, sessionId, this.transcripts)
        : null;
    const found =
      desktop === null
        ? path === null
          ? null
          : readOpeningAsk(path)
        : (desktopConversation(desktop).find((line) => line.who === SPEAKER.PERSON)
            ?.text ?? null);
    if (found === null) return undefined;
    this.openings.set(sessionId, found);
    return found;
  }

  /** What was said, read from the agent's own transcript, or nothing where it keeps none Memnox can read. */
  private async conversation(
    sessionId: string,
  ): Promise<{ conversation?: ConversationLine[] }> {
    const desktop = desktopSessionById(desktopRoots(this.home), sessionId);
    if (desktop !== null) {
      const lines = desktopConversation(desktop).slice(-MOST_DESKTOP_LINES);
      return lines.length === 0 ? {} : { conversation: lines };
    }
    const path = await sessionTranscript(this.home, sessionId, this.transcripts);
    if (path === null) return {};
    const lines = readConversation(path);
    return lines.length === 0 ? {} : { conversation: lines };
  }

  private async steps(sessionId: string): Promise<SessionViewStep[]> {
    const ids = await idsOf(this.home, sessionId);
    // Its edits can record under the agent's own id, which alone would leave only the network here.
    const events = (
      await withEvents(this.home, (store) =>
        Promise.all(
          ids.map((id) => store.query({ sessionId: id, limit: LEDGER_SESSION_LIMIT })),
        ),
      )
    )
      .flat()
      .sort((a, b) => a.at.localeCompare(b.at));
    return buildReplay({ sessionId, events })
      .steps.filter((step) => step.kind === REPLAY_STEP.ACTION)
      .slice(-MOST_STEPS)
      .map(stepOf);
  }

  /** One changed file's diff, for the live window to open under the file's name. */
  async diff(sessionId: string, path: string): Promise<CardExcerpt | null> {
    return fileDiff(this.deps(), SEAMS, sessionId, path);
  }

  /** The files it changed and the lines of the busiest, kept a few seconds, since every poll would otherwise diff the tree. */
  private async changed(deps: SessionToolDeps, sessionId: string): Promise<Code> {
    const kept = this.files.get(sessionId);
    const moment = this.now().getTime();
    if (kept !== undefined && moment - kept.at < FILES_FRESH_MS) return kept.code;
    const answer = await changesIn(deps, SEAMS, sessionId);
    const shown = answer.files?.shown ?? [];
    const others = await Promise.all(
      (answer.alsoChanged ?? []).map((each) =>
        changesIn(deps, SEAMS, sessionId, each.repository),
      ),
    );
    // Every repository it wrote in, named when there is more than one, so work in two is never half shown.
    const named = others.length > 0;
    const files = [answer, ...others]
      .flatMap((each) =>
        (each.files?.shown ?? []).map((file) => ({
          ...file,
          path: named ? `${basename(each.repository ?? '')}/${file.path}` : file.path,
        })),
      )
      .slice(0, MOST_FILES)
      .map((each) => ({
        path: each.path,
        ...(each.added === null ? {} : { added: each.added }),
        ...(each.removed === null ? {} : { removed: each.removed }),
      }));
    const excerpt = await excerptOf(deps, SEAMS, sessionId, shown).catch(() => null);
    const code: Code = excerpt === null ? { files } : { files, excerpt };
    this.files.set(sessionId, { at: moment, code });
    return code;
  }

  deps(): SessionToolDeps {
    return {
      home: this.home,
      cwd: this.home,
      agent: 'claude-code',
      env: {},
      now: this.now,
      readStatus,
      milestonesAt: async (place) =>
        SEAMS.build(place)
          .list()
          .catch(() => []),
      brief: async () => null,
    };
  }
}

/** The start of the agent's last answer, cut at a word, since the card shows where things stand rather than the report. */
function clipped(text: string): string {
  // Markdown marks read as stray symbols on a card, so headings, bullets, bold and code ticks go.
  const flat = text
    .split('\n')
    .map((line) => line.replace(/^\s*(#+|[-*]|\d+\.)\s+/, ''))
    .join(' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= MOST_LAST_SAID_CHARS) return flat;
  const cut = flat.slice(0, MOST_LAST_SAID_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/**
 * Newest first by when the person last wrote to each, so "the last session" is the one they were in; one they
 * never wrote to is placed by when it was last active, which is how a session started for them still shows.
 */
function byPersonFirst(
  aSpokenToAt: string | undefined,
  a: { lastActive?: string },
  bSpokenToAt: string | undefined,
  b: { lastActive?: string },
): number {
  const aAt = aSpokenToAt ?? a.lastActive ?? '';
  const bAt = bSpokenToAt ?? b.lastActive ?? '';
  return bAt.localeCompare(aAt) || (b.lastActive ?? '').localeCompare(a.lastActive ?? '');
}

/** As many cards as the switcher turns through before it is a list nobody can follow. */
const MOST_CARDS = 7;

type Names = Awaited<ReturnType<typeof readNames>>;

function nameOf(names: Names, agent: string): string {
  const id = agent.startsWith(AGENT_ID_PREFIX) ? agent : `${AGENT_ID_PREFIX}${agent}`;
  return displayName(names, { id, kind: agent });
}

/** What a card shows beside its session's row, read from where the session runs and its transcript. */
interface CardExtras {
  host: SessionHost | null;
  focus: string | null;
  spokenToAt?: string | undefined;
}

function cardOf(
  row: SessionRow,
  names: Names,
  { host, focus, spokenToAt }: CardExtras,
): SessionCard {
  const repository = row.repositories[0];
  return {
    sessionId: row.session,
    agent: row.agent,
    agentName: nameOf(names, row.agent),
    state: row.state,
    thinking: row.turn === 'in progress',
    ...(row.task === undefined ? {} : { task: row.task }),
    ...(focus === null ? {} : { focus }),
    ...(repository === undefined ? {} : { repository: basename(repository) }),
    ...(row.runningIn === undefined ? {} : { runningIn: row.runningIn }),
    ...(row.where === undefined ? {} : { where: row.where }),
    ...(row.lastActive === undefined ? {} : { lastActive: row.lastActive }),
    ...(spokenToAt === undefined ? {} : { spokenToAt }),
    ...(row.actions === undefined ? {} : { actions: row.actions }),
    ...(row.started === undefined || row.started === ''
      ? {}
      : { startedAt: row.started }),
    ...(host === null ? {} : { host: hostOf(host) }),
  };
}

/** What view gathered beside the session's row, for viewOf to lay out. */
interface Gathered {
  sessionId: string;
  agentName: string;
  steps: SessionViewStep[];
  code: Code;
  task: string | undefined;
  repository: string | undefined;
  branch: string | null;
  lastSaid: string | null;
  /** The person's latest words from the transcript; null when it holds none, undefined when there is none to read. */
  latestAsk: string | null | undefined;
  conversation: { conversation?: ConversationLine[] };
}

function viewOf(row: SessionRow, gathered: Gathered): SessionView {
  const { sessionId, agentName, steps, code, task, repository, branch, lastSaid } =
    gathered;
  const lastAsk = latestAskOf(row, gathered.latestAsk);
  return {
    sessionId,
    agent: row.agent,
    agentName,
    state: row.state,
    thinking: row.turn === 'in progress',
    waitingOnYou: row.waitingOnYou,
    helpers: helpersOf(row),
    steps,
    files: code.files,
    ...(code.excerpt === undefined ? {} : { excerpt: code.excerpt }),
    ...(task === undefined ? {} : { task }),
    ...(lastAsk === undefined || lastAsk === task ? {} : { lastAsk }),
    ...(repository === undefined ? {} : { repository: basename(repository) }),
    ...(branch === null ? {} : { branch }),
    ...(row.runningIn === undefined ? {} : { runningIn: row.runningIn }),
    ...(row.where === undefined ? {} : { where: row.where }),
    ...(lastSaid === null ? {} : { lastSaid: clipped(lastSaid) }),
    ...(row.started === undefined || row.started === ''
      ? {}
      : { startedAt: row.started }),
    ...(row.lastActive === undefined ? {} : { lastActive: row.lastActive }),
    ...(row.paused === undefined ? {} : { paused: row.paused }),
    ...gathered.conversation,
  };
}

/** The transcript's word over the prompt hook's, since the hook cannot tell the person's prompt from a helper's report. */
function latestAskOf(
  row: SessionRow,
  fromTranscript: string | null | undefined,
): string | undefined {
  if (fromTranscript === undefined) return row.lastAsk;
  if (fromTranscript === null) return undefined;
  const statement = statementOfPrompt(fromTranscript);
  return statement === '' ? undefined : statement;
}

function hostOf(host: SessionHost): DisplayHost {
  return {
    ...(host.app === undefined ? {} : { app: host.app }),
    ...(host.appPath === undefined ? {} : { appPath: host.appPath }),
    ...(host.tty === undefined ? {} : { tty: host.tty }),
    ...(host.cwd === undefined ? {} : { cwd: host.cwd }),
    ...conversationOf(host),
  };
}

/** What a session changed: its files, and the changed lines of the one it changed most. */
interface Code {
  files: CardFile[];
  excerpt?: CardExcerpt;
}

const SEAMS: RewindSeams = {
  build: (place) => new Milestones(new NodeGit(place), new NodeWorktree(place)),
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

function helpersOf(row: SessionRow): string[] {
  const working = row.subagents?.working ?? [];
  return working.map((each) =>
    [
      each.type ?? 'A helper',
      each.lastTool === undefined ? 'working' : `using ${each.lastTool}`,
    ].join(' '),
  );
}

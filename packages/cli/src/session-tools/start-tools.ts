import { basename, isAbsolute, relative } from 'node:path';
import {
  AGENT_ID,
  DESKTOP_APPS,
  DISPLAY,
  DISPLAY_TEXT_LIMIT,
  DISPLAY_VIA,
  DisplayRequests,
  isStartableAgent,
  SessionHosts,
  SessionStarts,
  STARTABLE_AGENT,
  startCommand,
  type SessionStart,
  type StartableAgent,
  WorkBriefs,
} from '@memnox/core';
import { askedFromPhone } from '../daemon/asked-from';
import { existingFolder, folderNamed } from '../operator/folders';
import { noApp, openAppStart, resolveInstalledApp } from './app-tools';
import { notInstalled, resolveInstalled } from './installed-agent';
import { knownRepositories, repositoryNamed, spoken } from './known-repositories';
import { launched, startInPane, startInPanel, type PlacedStart } from './start-routes';
import {
  CORRECTION_MS,
  keepProposedFolder,
  noteStarted,
  proposedFolderSince,
} from './start-memory';
import { mainCheckoutOf } from './main-checkout';
import { keepSurface } from './start-surface';
import { editorName, PLACE, placeFor, surfaceOf } from './start-place';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { withBrief } from './work-tools';
import { APP_BUNDLE_SUFFIX, SAID, TOOL_ARG } from './session-tools.constants';

/**
 * Starting a new agent session out loud: "start Claude in memnox cloud on the failing test". It
 * is read back first, and on a yes a new terminal tab opens in that repository and the line that
 * starts the agent under `memnox run` is typed into it, so the new session is governed from its first step.
 */

/** Long enough for any task said in one breath, short enough that the typed line stays one line. */
const MOST_TASK_CHARS = 400;

/** Through a phone the read back is the Face ID card it signs, so the brain starts it at once. */
export async function proposeStartTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const proposed = await proposeStart(deps, args);
  if (!(await askedFromPhone(deps.home, deps.now()))) return proposed;
  const result = proposed as Record<string, unknown>;
  return result.proposed === false ? result : { ...result, said: START_FROM_PHONE };
}

async function proposeStart(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const named = agentOf(textArg(args, TOOL_ARG.AGENT));
  const agent = named ?? AGENT_ID.CLAUDE_CODE;
  const moment = deps.now().toISOString();
  if (!isStartableAgent(agent)) return notStartable(deps, moment);
  const place = await placeFor(deps, args, agent);
  const unplaced = placeRefusal(place);
  if (unplaced !== null) return { proposed: false, said: unplaced };
  const inApp = place.kind === PLACE.APP;
  const resolve = resolverFor(deps, inApp);
  const command = resolve(agent);
  if (command === null)
    return { proposed: false, ...(inApp ? noApp : notInstalled)(agent, resolve) };
  // Asked for only a session, it starts waiting for them rather than on a task nobody gave it.
  const task = textArg(args, 'task') ?? '';
  const known = await knownRepositories(deps);
  const { text, brief, found } = await withBrief(deps, args, task, MOST_TASK_CHARS);
  const chosen = await repositoryFor(deps, textArg(args, 'repository'), known, {
    brief,
    inApp,
    moment,
  });
  if (chosen === null) return noRepository(known);
  const said = textArg(args, 'said');
  const proposal = { agent, command, chosen, text, brief, inApp, place, said, moment };
  const start = await recordProposal(deps, args, proposal);
  return {
    ...readBackOf(deps, start, chosen, {
      task,
      agentNamed: named !== undefined,
      enoughSaid: said === undefined || wordsIn(said) >= FEWEST_WORDS_TO_START,
    }),
    ...(found === undefined ? {} : { found }),
  };
}

/** A correction to an agent that cannot start leaves nothing earlier waiting to be started in its place. */
async function notStartable(
  deps: SessionToolDeps,
  moment: string,
): Promise<Record<string, unknown>> {
  await withdrawWaiting(deps, moment);
  return { proposed: false, said: ONLY_KNOWN_AGENTS };
}

/** Why a start cannot be placed where they asked, or null when it can. */
function placeRefusal(place: Place): string | null {
  if (place.kind === PLACE.NO_EDITOR) return NO_EDITOR;
  if (place.kind === PLACE.UNKNOWN_EDITOR) return UNKNOWN_EDITOR;
  if (place.kind === PLACE.NO_TERMINAL) return NO_TERMINAL;
  return null;
}

type Place = Awaited<ReturnType<typeof placeFor>>;

/** What propose_start settled on, before it waits on a yes. */
interface Proposal {
  agent: StartableAgent;
  command: string;
  chosen: ChosenRepository;
  text: string;
  brief: string | undefined;
  inApp: boolean;
  place: Place;
  said: string | undefined;
  moment: string;
}

/** The start kept waiting on a yes, and its folder remembered so a correction can say what it replaced. */
async function recordProposal(
  deps: SessionToolDeps,
  args: ToolArgs,
  proposal: Proposal,
): Promise<SessionStart> {
  const { agent, command, chosen, text, brief, inApp, place, said, moment } = proposal;
  // A correction replaces what it corrects, so a yes to the earlier read back can no longer start it.
  await supersede(deps, chosen.path, text, moment);
  const start = await new SessionStarts(deps.home).propose({
    agent,
    command,
    ...(chosen.path === undefined ? {} : { repository: chosen.path }),
    task: text,
    ...(textArg(args, TOOL_ARG.HOLD_CREDENTIALS) === SAID.YES ? HELD : {}),
    ...(brief === undefined ? {} : { brief }),
    ...(inApp ? { app: command } : {}),
    ...whereItStarts(place, agent, args),
    ...(said === undefined ? {} : { said }),
    at: moment,
  });
  if (chosen.path !== undefined)
    await keepProposedFolder(deps.home, {
      repository: chosen.path,
      ...(chosen.from === undefined ? {} : { from: chosen.from }),
      at: moment,
    });
  return start;
}

/** The agent by its id or by the product name the brain passed, so "Cursor" or "Claude Code" still starts it. */
function agentOf(named: string | undefined): string | undefined {
  if (named === undefined) return undefined;
  return AGENT_NAMES[named.toLowerCase().replace(/[^a-z]/g, '')] ?? named;
}

/** Product names as people say them, each to the agent that runs it. */
const AGENT_NAMES: Readonly<Record<string, StartableAgent>> = {
  claudecode: AGENT_ID.CLAUDE_CODE,
  claude: AGENT_ID.CLAUDE_CODE,
  claudedesktop: AGENT_ID.CLAUDE_CODE,
  codex: AGENT_ID.CODEX,
  codexcli: AGENT_ID.CODEX,
  codexapp: AGENT_ID.CODEX,
  chatgpt: AGENT_ID.CODEX,
  cursor: AGENT_ID.CURSOR,
  cursoragent: AGENT_ID.CURSOR,
  hermes: AGENT_ID.HERMES,
};

/** One word is never a whole request, so a misheard "iOS" is read back rather than started. */
const FEWEST_WORDS_TO_START = 2;

function wordsIn(said: string): number {
  return said.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

/** Every start still waiting on a yes, taken back, so a stale id never starts what they turned down. */
async function withdrawWaiting(deps: SessionToolDeps, moment: string): Promise<void> {
  const starts = new SessionStarts(deps.home);
  for (const each of await starts.waiting(moment)) await starts.take(each.id, moment);
}

/** Starts waiting on a yes for the same folder and task, which a new proposal corrects. */
async function supersede(
  deps: SessionToolDeps,
  repository: string | undefined,
  task: string,
  moment: string,
): Promise<void> {
  const starts = new SessionStarts(deps.home);
  for (const each of await starts.waiting(moment)) {
    if (each.repository === repository && each.task === task)
      await starts.take(each.id, moment);
  }
}

/** Started with its credentials kept away from it. */
const HELD = { holdCredentials: true } as const;

/** Where the start runs beyond a terminal tab: an editor or its Claude Code panel, a pane, or a terminal app. */
function whereItStarts(
  place: Place,
  agent: StartableAgent,
  args: ToolArgs,
): Pick<SessionStart, 'editor' | 'panel' | 'pane' | 'terminal'> {
  if (place.kind === PLACE.EDITOR) {
    // Only Claude Code has a panel Memnox can start a conversation in.
    const panel =
      agent === AGENT_ID.CLAUDE_CODE && textArg(args, TOOL_ARG.PANEL) === SAID.YES;
    return { editor: place.path, ...(panel ? { panel } : {}) };
  }
  if (place.kind === PLACE.PANE) return { pane: place.multiplexer };
  if (place.kind === PLACE.TERMINAL_APP) return { terminal: place.path };
  return {};
}

/** The agent's command, or with app "true" its desktop app, each found where it is installed. */
function resolverFor(
  deps: SessionToolDeps,
  inApp: boolean,
): (agent: StartableAgent) => string | null {
  return inApp
    ? (deps.resolveApp ?? resolveInstalledApp)
    : (deps.resolveCommand ?? resolveInstalled);
}

/** What the brain reads back, with the app named when it opens in one rather than a terminal. */
function readBackOf(
  deps: SessionToolDeps,
  start: SessionStart,
  chosen: ChosenRepository,
  {
    task,
    agentNamed,
    enoughSaid,
  }: { task: string; agentNamed: boolean; enoughSaid: boolean },
): Record<string, unknown> {
  // Nothing guessed, the agent named and the repository taken from their words, is a plain ask, which is its own yes.
  const plain = agentNamed && chosen.from === undefined && enoughSaid;
  return {
    proposed: true,
    start: start.id,
    ...(chosen.path === undefined
      ? { noFolder: true }
      : { repository: basename(chosen.path) }),
    ...(chosen.from === undefined ? {} : { repositoryFrom: chosen.from }),
    readBack: task,
    ...(start.app === undefined
      ? {}
      : { in: `the ${DESKTOP_APPS[start.agent].name} app` }),
    ...(start.editor === undefined
      ? {}
      : {
          in:
            start.panel === true
              ? `a new conversation in the Claude Code panel in ${editorName(deps, start)}`
              : `a new terminal in ${editorName(deps, start)}`,
        }),
    ...(start.pane === undefined ? {} : { in: `a new ${start.pane} window` }),
    ...(start.terminal === undefined
      ? {}
      : { in: `a new ${basename(start.terminal, APP_BUNDLE_SUFFIX)} window` }),
    ...(start.holdCredentials === true ? { holdsCredentials: true } : {}),
    said: chosen.path === undefined ? chatSaid(plain) : plain ? START_NOW : READ_BACK,
  };
}

/** A chat in an app, which names no folder in its read back. */
function chatSaid(plain: boolean): string {
  return plain ? START_CHAT_NOW : READ_BACK_CHAT;
}

/** Where the work goes, and how it was chosen when the person named no repository. */
interface ChosenRepository {
  /** None for a chat in a desktop app they named no folder for. */
  path?: string;
  /** Said in the read back, so a guess can be corrected before anything starts. */
  from?: string;
}

/**
 * The repository they named, or with none named, the one the ticket lives in, then the folder of
 * the proposal they are correcting, and failing those the one their last session worked in. A
 * chat in a desktop app needs no folder, so it borrows none from an earlier session.
 */
async function repositoryFor(
  deps: SessionToolDeps,
  named: string | undefined,
  known: readonly string[],
  { brief, inApp, moment }: { brief: string | undefined; inApp: boolean; moment: string },
): Promise<ChosenRepository | null> {
  if (named !== undefined) return namedRepository(deps, named, known);
  const ticket = brief === undefined ? null : await new WorkBriefs(deps.home).read(brief);
  const fromTicket = ticket?.sources
    .map((source) => source.link?.match(/github\.com\/[^/]+\/([^/#?]+)/)?.[1])
    .find((name) => name !== undefined);
  const byTicket = known.find((each) => basename(each) === fromTicket);
  if (byTicket !== undefined)
    return { path: byTicket, from: 'the repository its ticket is filed in' };
  const since = new Date(Date.parse(moment) - CORRECTION_MS).toISOString();
  const corrected = await proposedFolderSince(deps.home, since);
  if (corrected !== null)
    return {
      path: corrected.repository,
      ...(corrected.from === undefined ? {} : { from: corrected.from }),
    };
  if (inApp) return {};
  const hosts = (await new SessionHosts(deps.home).all())
    .filter((host) => host.cwd !== undefined && isAbsolute(host.cwd))
    .sort((a, b) => b.seenAt.localeCompare(a.seenAt));
  const last = hosts
    .map((host) => mainCheckoutOf(host.cwd ?? ''))
    .find((each) => known.includes(each));
  return last === undefined
    ? null
    : { path: last, from: 'the repository your last session worked in' };
}

/** The repository or folder by the name they said, read back when only a fragment of its name was heard. */
async function namedRepository(
  deps: SessionToolDeps,
  named: string,
  known: readonly string[],
): Promise<ChosenRepository | null> {
  const path = repositoryNamed(named, known, false);
  if (path !== null) {
    const fragment =
      spoken(basename(path)) !== spoken(named) && spoken(named).length < WHOLE_NAME_CHARS;
    return fragment ? { path, from: `${basename(path)}, the closest name` } : { path };
  }
  // A folder by the very name they said beats a repository whose name only sounds like it.
  const folder = await folderFor(deps, named);
  if (folder !== null && folder.from === undefined) return folder;
  const near = repositoryNamed(named, known);
  return near === null
    ? folder
    : { path: near, from: `${basename(near)}, the closest name` };
}

/** Shorter than this, a part of a name such as "ios" in memnox-ios is a guess rather than the name. */
const WHOLE_NAME_CHARS = 4;

/**
 * Any folder by that path or name when no repository answers to it, since a session can start in a
 * folder that is not a repository; one found by a near name is read back, never started on a guess.
 */
async function folderFor(
  deps: SessionToolDeps,
  named: string,
): Promise<ChosenRepository | null> {
  const byPath = isAbsolute(named) ? await existingFolder(deps.home, named) : null;
  if (byPath !== null) return { path: byPath };
  const found = await folderNamed(deps.home, named, deps.now().getTime());
  if (found === null) return null;
  return found.exact
    ? { path: found.path }
    : {
        path: found.path,
        from: `the folder ${relative(deps.home, found.path)}, the closest name`,
      };
}

/** The repositories it could see, so the voice offers the closest names rather than asking again. */
function noRepository(known: readonly string[]): Record<string, unknown> {
  return {
    proposed: false,
    known: known.map((each) => basename(each)),
    said: NO_SUCH_REPOSITORY,
  };
}

/** Through a phone the Mac opens nothing until that phone signs, which the daemon's routing holds it for. */
export async function startSessionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const id = textArg(args, 'start');
  const moment = deps.now().toISOString();
  const start =
    id === undefined ? null : await new SessionStarts(deps.home).take(id, moment);
  if (start === null) return { started: false, said: GONE };
  await keepSurface(deps.home, start.agent, surfaceOf(deps, start));
  if (start.app !== undefined) {
    await noteStarted(deps.home, placeOf(start, [start.id], start.app, moment));
    return openAppStart(deps, start, moment);
  }
  // Only a desktop app chat is proposed with no folder, so a terminal start without one is never typed.
  if (start.repository === undefined) return { started: false, said: GONE };
  const placed: PlacedStart = { ...start, repository: start.repository };
  const line = startCommand(placed);
  // Cut short, the quotes would not close, so a line too long for the screen is never typed at all.
  if (line.length > DISPLAY_TEXT_LIMIT) return { started: false, said: TOO_LONG };
  if (placed.pane !== undefined) return startInPane(deps, placed, line, moment);
  if (placed.panel === true) return startInPanel(deps, placed, moment);
  const appPath = placed.editor ?? placed.terminal;
  const request = await launchRequest(deps, placed, line, moment);
  await noteStarted(deps.home, placeOf(placed, [placed.id, request.id], appPath, moment));
  const delivery = deps.delivered === undefined ? null : await deps.delivered(request.id);
  return launched(deps, placed, delivery, moment);
}

/** Asks the Mac to type the line that starts the agent, in a new tab, an editor or a terminal app. */
async function launchRequest(
  deps: SessionToolDeps,
  placed: PlacedStart,
  line: string,
  moment: string,
): Promise<{ id: string }> {
  return new DisplayRequests(deps.home).request({
    display: DISPLAY.LAUNCH,
    sessionId: placed.id,
    agent: placed.agent,
    title: placed.agent,
    text: line,
    cwd: placed.repository,
    // The Mac opens this editor on the repository and its Memnox extension starts the agent there.
    ...(placed.editor === undefined ? {} : { appPath: placed.editor }),
    // Or opens a window of this terminal app on the repository and types the line into it.
    ...(placed.terminal === undefined
      ? {}
      : { appPath: placed.terminal, via: DISPLAY_VIA.TERMINAL_APP }),
    at: moment,
  });
}

/** Where a start went, under the ids it may later be named by, so show finds it before its agent first acts. */
function placeOf(
  start: SessionStart,
  ids: string[],
  appPath: string | undefined,
  at: string,
): Parameters<typeof noteStarted>[1] {
  return {
    ids,
    agent: start.agent,
    ...(start.repository === undefined ? {} : { repository: start.repository }),
    ...(appPath === undefined ? {} : { appPath }),
    at,
  };
}

const START_FROM_PHONE =
  'They are speaking through their phone, where the yes to a new session is their Face ID on the card the phone shows, never a spoken one. Call start_session with this id now, in this same reply, without reading it back and without a word before it.';
const TOO_LONG =
  'That task is too long to type as one line. Ask them for it in a sentence or two, and propose it again.';

const ONLY_KNOWN_AGENTS = `Only ${Object.keys(STARTABLE_AGENT).join(' or ')} can be started by voice, so nothing was proposed and nothing earlier is waiting any more. Ask which of these they meant, as one question; never start an earlier proposal in its place.`;
const UNKNOWN_EDITOR =
  'That is not an editor a session can start in, which are VS Code, Cursor and Windsurf, so nothing was proposed. When they meant the Cursor agent itself, propose it again with agent cursor and app "true"; otherwise ask which editor or agent they meant, as one question. Never start it in another editor or as another agent.';
const NO_SUCH_REPOSITORY =
  'No repository or folder on this Mac goes by that name. Offer the closest from known, by name, or to create a folder by that name with create_folder and start there, as one question.';
const READ_BACK =
  'Nothing has started. Read it back once, as one whole sentence that ends in a courteous question, saying the app when in names one, such as "Shall I open the Codex app in memnox runtime to review your changes?", "Shall I start Codex in memnox macos to review the changes?" or "I can start Claude Code in memnox cloud on the failing auth test. Would you like me to go ahead?", varying the words. Say nothing before it and nothing after the question. Call start_session with this id only after they say yes. When they asked for exactly this plainly, the agent, the repository and what to do, or only to open an app such as "open Hermes", or they already said yes to it or corrected it to this, skip the read back: their asking is their yes, so call start_session with this id now. Never ask the same thing twice.';
const READ_BACK_CHAT =
  'Nothing has started. It opens a new chat in the app with no folder, since they named none and a question in a chat needs none. Read it back once as a question that names the app and never a repository or folder, like "Shall I ask Claude desktop for the score of the Real Madrid and Roma match?". Call start_session with this id only after they say yes. When they asked for exactly this plainly, skip the read back and call start_session now.';
const START_CHAT_NOW =
  'They asked for exactly this, so their asking is their yes: call start_session with this id now, in this same reply, without a word before it. It opens a new chat in the app with no folder, so never name a repository or a folder, and never say one was taken from an earlier session.';
const START_NOW =
  'They asked for exactly this, naming the agent and the repository, so their asking is their yes: call start_session with this id now, in this same reply, without a word before it. Never read it back, and never say that nothing has started.';
const GONE =
  'That start is gone or more than five minutes old. Read it back again with propose_start.';
const NO_TERMINAL =
  'The terminal they named is not installed on this Mac, or no tmux or WezTerm is running to open a window in, so nothing was proposed. Say so plainly and offer a new terminal tab instead, as a question.';
const NO_EDITOR =
  'The editor they named is not installed on this Mac, so nothing was proposed. Say so plainly and offer a new terminal tab instead, as a question; never start it anywhere else unasked.';

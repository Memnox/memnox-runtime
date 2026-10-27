import { basename, dirname, isAbsolute } from 'node:path';
import {
  LEDGER_SESSION_LIMIT,
  SESSION_VAR,
  SessionHosts,
  SessionTasks,
  SessionTurns,
  type FileChange,
  type MemnoxEvent,
  type Milestone,
  type SessionTurn,
} from '@memnox/core';
import { repositoryRootOf } from '@memnox/interceptors';
import { repositoryAround } from './repository-root';
import { withEvents } from '../event-store';
import { MOST_ROWS } from './bounded';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { RewindSeams } from './rewind-tool';
import { idsOf } from './session-aliases';
import { scopeOf, type SessionScope } from './session-scope';
import {
  FILE_KIND,
  firstWriteIn,
  matchingPath,
  repositoriesWritten,
  touchesOf,
  turnTouches,
  writtenBySession,
  type SessionWrite,
  type Touch,
} from './session-writes';

/**
 * What a session changed in the code, read against the milestone Memnox took before its
 * first write. The ledger keeps paths and digests and never content, so this is the one
 * place the words of a change are read, and only when the person asks.
 */

/** Enough folders to find the repositories a session wrote in, never a crawl of the disk. */
const MOST_PLACES = 20;

/** The same session reads, with the operator's own run taken out so it never reads itself. */
export function readingFor(deps: SessionToolDeps, agent: string): SessionToolDeps {
  const env = { ...deps.env };
  delete env[SESSION_VAR];
  return { ...deps, agent, env };
}

interface Found {
  scope: SessionScope;
  touches: Touch[];
  turn?: SessionTurn;
}

interface Compared {
  repository: string;
  files: SessionWrite[];
  milestone?: Milestone;
  since: string;
}

export async function changesTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  args: ToolArgs,
): Promise<unknown> {
  const found = await sessionAndTouches(deps, textArg(args, 'session'));
  const { scope, touches } = found;
  if (scope.sessionId === null) return { ...scope, found: false };
  const task = await new SessionTasks(deps.home).read(scope.sessionId);
  const head = { ...scope, ...(task === null ? {} : { task: task.statement }) };
  const places = placesFor(repositoriesWritten(touches), textArg(args, 'repository'));
  const compared = await comparedIn(deps, seams, places, found);
  const first = compared[0];
  if (first === undefined) {
    return { ...head, found: false, said: nothingFound(places) };
  }
  const path = textArg(args, 'path');
  return {
    ...head,
    repository: first.repository,
    comparedWith:
      first.milestone === undefined
        ? 'the last commit before this session first wrote here, keeping only the files it wrote'
        : 'the milestone taken before its first write, keeping only the files it wrote',
    since: first.since,
    ...(path === undefined
      ? filesOf(compared, found.turn)
      : await diffOf(seams, first, matchingPath(path, first.repository, first.files))),
  };
}

/** Every repository the session changed something in, the one it wrote in last first. */
async function comparedIn(
  deps: SessionToolDeps,
  seams: RewindSeams,
  places: readonly string[],
  { scope, touches }: Found,
): Promise<Compared[]> {
  const compared: Compared[] = [];
  for (const place of places) {
    const sessionId = scope.sessionId ?? '';
    const each = await compare(deps, seams, { place, sessionId, touches });
    if (each !== null && each.files.length > 0) compared.push(each);
  }
  return compared;
}

function filesOf(
  compared: readonly Compared[],
  turn: SessionTurn | undefined,
): Record<string, unknown> {
  const [first, ...rest] = compared;
  if (first === undefined) return {};
  const screens = first.files.filter((each) => each.kind === FILE_KIND.INTERFACE);
  return {
    files: listed(first.files),
    interfaceFiles: screens.map((each) => each.path),
    ...latestTurn(first.files, turn),
    ...(rest.length === 0 ? {} : { alsoChanged: rest.map(elsewhere) }),
  };
}

/** One repository: its base, then the changed files this session is the one that wrote. */
async function compare(
  deps: SessionToolDeps,
  seams: RewindSeams,
  {
    place,
    sessionId,
    touches,
  }: { place: string; sessionId: string; touches: readonly Touch[] },
): Promise<Compared | null> {
  const milestones = seams.build(place);
  const milestone = firstMilestoneOf(await deps.milestonesAt(place), sessionId);
  const since = milestone?.takenAt ?? firstWriteIn(place, touches);
  let changed: FileChange[];
  try {
    changed =
      milestone === undefined
        ? await milestones.changedSinceCommit(since)
        : await milestones.changedSince(milestone.id);
  } catch {
    // Not a repository git can read now, so it has nothing to say.
    return null;
  }
  return {
    repository: place,
    files: writtenBySession(place, changed, touches),
    since: since ?? '',
    ...(milestone === undefined ? {} : { milestone }),
  };
}

async function diffOf(
  seams: RewindSeams,
  { repository, milestone, since }: Compared,
  path: string,
): Promise<Record<string, unknown>> {
  const milestones = seams.build(repository);
  const diff =
    milestone === undefined
      ? await milestones.diffSinceCommit(path, since === '' ? undefined : since)
      : await milestones.diffSince(milestone.id, path);
  return { path, diff: firstLines(diff) };
}

/** What the turn it last finished changed, which is what "it just finished" is about. */
function latestTurn(
  files: readonly SessionWrite[],
  turn: SessionTurn | undefined,
): Record<string, unknown> {
  const since = turn?.promptAt;
  if (since === undefined) return {};
  const paths = files.filter((each) => each.writtenAt >= since).map((each) => each.path);
  return paths.length === 0 ? {} : { latestTurn: { since, files: paths } };
}

function elsewhere(compared: Compared): Record<string, unknown> {
  return {
    repository: compared.repository,
    files: compared.files.length,
    interfaceFiles: compared.files.filter((each) => each.kind === FILE_KIND.INTERFACE)
      .length,
    newest: compared.files.slice(0, 3).map((each) => each.path),
  };
}

/** The repository asked for by folder name or path, else every one the session wrote in. */
function placesFor(written: readonly string[], asked: string | undefined): string[] {
  if (asked === undefined) return [...written];
  const wanted = asked.toLowerCase();
  const named = written.filter(
    (each) => each === asked || basename(each).toLowerCase() === wanted,
  );
  if (named.length > 0) return named;
  const root = isAbsolute(asked) ? repositoryRootOf(asked) : null;
  return root === null ? [] : [root];
}

function nothingFound(places: readonly string[]): string {
  if (places.length === 0) {
    return 'This session wrote no file in a repository Memnox could find, so there is nothing to compare.';
  }
  const names = places.map((each) => basename(each)).join(', ');
  return `It wrote in ${names}, and no file there has changed from what this session did, so it may have been committed and pushed, reverted, or only touched ignored files.`;
}

async function sessionAndTouches(
  deps: SessionToolDeps,
  session?: string,
): Promise<Found> {
  const { scope, rows } = await withEvents(deps.home, async (store) => {
    const scope = await scopeOf(store, deps, session);
    const ids = scope.sessionId === null ? [] : await idsOf(deps.home, scope.sessionId);
    // The edits often record under the agent's own id and the rest under the hosted one.
    const rows = (
      await Promise.all(
        ids.map((sessionId) => store.query({ sessionId, limit: LEDGER_SESSION_LIMIT })),
      )
    ).flat();
    return { scope, rows };
  });
  const id = scope.sessionId;
  if (id === null) return { scope, touches: [] };
  const [turn, host] = await Promise.all([
    new SessionTurns(deps.home).read(id),
    new SessionHosts(deps.home).read(id),
  ]);
  // The repository it was opened in, where its edit tool's relative paths and its unrecorded writes land.
  const root = host?.cwd === undefined ? null : repositoryRootOf(host.cwd);
  const worked =
    root === null || turn === null
      ? []
      : turnTouches(root, windowsOf(turn), deps.now().toISOString());
  const touches = [...touchesOf(rows, root), ...worked].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  return turn === null ? { scope, touches } : { scope, touches, turn };
}

/** Its turns, or the last one alone for a session recorded before every turn was kept. */
function windowsOf(turn: SessionTurn): { promptAt: string; endedAt?: string }[] {
  if (turn.windows !== undefined) return turn.windows;
  if (turn.promptAt === undefined) return [];
  const ended = turn.endedAt !== undefined && turn.endedAt >= turn.promptAt;
  return [{ promptAt: turn.promptAt, ...(ended ? { endedAt: turn.endedAt } : {}) }];
}

/** The repositories the session's own paths sit in, newest first, found from the paths and never guessed. */
export function repositoriesOf(events: readonly MemnoxEvent[]): string[] {
  const folders = new Set<string>();
  for (const event of [...events].reverse()) {
    if (event.target !== undefined && isAbsolute(event.target))
      folders.add(dirname(event.target));
    if (folders.size >= MOST_PLACES) break;
  }
  const roots = new Set<string>();
  for (const folder of folders) {
    const root = repositoryAround(folder);
    if (root !== null) roots.add(root);
  }
  return [...roots];
}

/** The milestone taken before the session's first write, which is where its changes start. */
function firstMilestoneOf(
  milestones: readonly Milestone[],
  sessionId: string,
): Milestone | undefined {
  return milestones
    .filter((each) => each.sessionId === sessionId)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))[0];
}

function listed<T>(rows: readonly T[]): { total: number; shown: T[] } {
  return { total: rows.length, shown: rows.slice(0, MOST_ROWS) };
}

/** The start of a diff, since the answer keeps a list's newest rows and a diff reads from the top. */
function firstLines(diff: string): { total: number; lines: string[] } {
  const lines = diff.split('\n');
  return { total: lines.length, lines: lines.slice(0, MOST_ROWS) };
}

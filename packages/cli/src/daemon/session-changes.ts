import { basename } from 'node:path';
import type { CardExcerpt } from '@memnox/core';
import { changesTool } from '../session-tools/changes-tool';
import type { SessionToolDeps } from '../session-tools/read-tools';
import type { RewindSeams } from '../session-tools/rewind-tool';
import type { ChangedFile } from '../session-tools/show-tool';

/** What a session changed, read through the changes tool for the live window: its files, and one file's diff. */

/** What changes says a session changed, in one repository or the one it wrote in last. */
interface Changes {
  repository?: string;
  files?: { shown: ChangedFile[] };
  alsoChanged?: { repository: string }[];
}

export async function changesIn(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
  repository?: string,
): Promise<Changes> {
  const args =
    repository === undefined
      ? { session: sessionId }
      : { session: sessionId, repository };
  // Shaped by changesTool itself, and a failure is a session with nothing to show.
  return (await changesTool(deps, seams, args).catch(() => ({}))) as Changes;
}

/**
 * One changed file's diff, found in whichever repository the session wrote it in, since a session that worked in
 * two names each file after its repository the way the view lists it.
 */
export async function fileDiff(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
  path: string,
): Promise<CardExcerpt | null> {
  const answer = await changesIn(deps, seams, sessionId);
  const others = (answer.alsoChanged ?? []).map((each) => each.repository);
  const named = others.length > 0;
  const places: Array<string | undefined> = [undefined, ...others];
  for (const repository of places) {
    const prefix = `${basename(repository ?? answer.repository ?? '')}/`;
    if (named && !path.startsWith(prefix)) continue;
    const inner = named ? path.slice(prefix.length) : path;
    const args =
      repository === undefined
        ? { session: sessionId, path: inner }
        : { session: sessionId, repository, path: inner };
    // Shaped by changesTool itself, and a failure is a file with nothing to show.
    const found = (await changesTool(deps, seams, args).catch(() => ({}))) as {
      diff?: { lines: string[] };
    };
    const lines = hunksOf(found.diff?.lines ?? []);
    if (lines.length > 0) return { path, lines };
  }
  return null;
}

/** The hunks of a diff without its file headers, since the window already names the file. */
function hunksOf(diff: readonly string[]): string[] {
  const start = diff.findIndex((line) => line.startsWith('@@'));
  return start === -1 ? [] : diff.slice(start).filter((line) => !line.startsWith('\\'));
}

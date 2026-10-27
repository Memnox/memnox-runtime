import {
  DISPLAY,
  DisplayRequests,
  UNNAMED_SESSION,
  WALK_PAGES,
  type WalkPage,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { changesTool } from './changes-tool';
import { noteFocus } from './focus';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { RewindSeams } from './rewind-tool';
import { scopeOf } from './session-scope';
import { changedLines } from './show-tool';

/**
 * "Walk me through the change": a card that turns one page per file while the voice says what
 * each file's change does. The lines on each page come from the diff itself, never from the brain.
 */

interface FileCount {
  path: string;
  added: number | null;
  removed: number | null;
}

const WALKING =
  'The card is up in the top left corner and turns a page per file as you speak. Say each note in the order you gave them, the same words, one file at a time, and nothing between them.';

const NO_NOTES =
  'Pass pages: one {path, note} per file, the two or three that matter, from changes.';
const NO_SESSION = 'No agent session was found to walk through.';
const NOT_CHANGED = 'None of those files changed in that session.';

export async function walkThroughTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  args: ToolArgs,
): Promise<unknown> {
  const notes = notesOf(args);
  if (notes.length === 0) return { shown: false, said: NO_NOTES };
  const scope = await withEvents(deps.home, (store) =>
    scopeOf(store, deps, textArg(args, 'session')),
  );
  if (scope.sessionId === null || scope.sessionId === UNNAMED_SESSION) {
    return { ...scope, shown: false, said: NO_SESSION };
  }
  const pages = await pagesFor(deps, seams, scope.sessionId, notes);
  if (pages.length === 0) {
    return { ...scope, shown: false, said: NOT_CHANGED };
  }
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.WALK,
    sessionId: scope.sessionId,
    agent: scope.agent,
    title: textArg(args, 'title') ?? 'Walk through',
    pages,
    at: deps.now().toISOString(),
  });
  await noteFocus(deps, scope, 'walked through');
  return { ...scope, shown: true, pages: pages.map((each) => each.path), said: WALKING };
}

/** The brain's notes, only those naming a file and saying something about it. */
function notesOf(args: ToolArgs): { path: string; note: string }[] {
  const given = args['pages'];
  if (!Array.isArray(given)) return [];
  return given
    .filter(
      (each): each is { path: string; note: string } =>
        each !== null &&
        typeof each === 'object' &&
        typeof (each as { path?: unknown }).path === 'string' &&
        typeof (each as { note?: unknown }).note === 'string',
    )
    .slice(0, WALK_PAGES);
}

/** Each named file the session really changed, with its counts and its changed lines. */
async function pagesFor(
  deps: SessionToolDeps,
  seams: RewindSeams,
  sessionId: string,
  notes: readonly { path: string; note: string }[],
): Promise<WalkPage[]> {
  const listed = (await changesTool(deps, seams, { session: sessionId })) as {
    files?: { shown: FileCount[] };
  };
  const files = listed.files?.shown ?? [];
  const pages: WalkPage[] = [];
  for (const note of notes) {
    // The brain says a file by its short name, so the end of the path is what is matched.
    const file = files.find(
      (each) =>
        each.path === note.path ||
        each.path.endsWith(`/${note.path}`) ||
        note.path.endsWith(each.path),
    );
    if (file === undefined) continue;
    const diff = (await changesTool(deps, seams, {
      session: sessionId,
      path: file.path,
    })) as {
      diff?: { lines: string[] };
    };
    pages.push({
      path: file.path,
      note: note.note,
      ...(file.added === null ? {} : { added: file.added }),
      ...(file.removed === null ? {} : { removed: file.removed }),
      lines: changedLines(diff.diff?.lines ?? []),
    });
  }
  return pages;
}

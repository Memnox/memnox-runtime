import { DISPLAY, DisplayRequests } from '@memnox/core';
import {
  existingFolder,
  type Folder,
  type FolderUse,
  folderUses,
  homeFolders,
  nameMatch,
  noteFolderUse,
  spokenName,
  weight,
} from '../operator/folders';
import { createFolder } from '../operator/new-folder';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * Any folder in the person's home, found by how they said its name and opened where they ask,
 * with the ones they use most first. It opens a window and changes nothing on disk.
 */

/** Few enough to say aloud as choices. */
const MOST_MATCHES = 5;
const MOST_USED = 10;
/** Below this a name is a stretch, not a match. */
const LEAST_MATCH = 0.5;
/** A match this close to the best is a tie worth asking about, unless use breaks it. */
const TIE_WITHIN = 0.05;

/** Where a folder opens, carried as the title of a FOLDER display, which the Mac's FolderOpener mirrors. */
const FOLDER_OPENER = {
  FINDER: 'finder',
  EDITOR: 'editor',
  TERMINAL: 'terminal',
} as const;

type FolderOpener = (typeof FOLDER_OPENER)[keyof typeof FOLDER_OPENER];

const OPENERS: readonly string[] = Object.values(FOLDER_OPENER);

export const FOLDER_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'folders',
    description:
      'Find a folder on this Mac by its name as they said it, even misheard, like "mem nocks mac OS" for memnox-macos, or with no name, the folders they use most. Each comes with its path and how much they use it, most used first. Call it before open_folder when you do not already have the path.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'the folder as they said it; leave out for the most used',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'open_folder',
    description:
      'Open a folder for the person: in Finder, in their editor, or in a new terminal tab. Use the path folders gave. Finder unless they say editor, VS Code, code or terminal. It only opens a window, so do it at once with no read back.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'the folder path from folders' },
        in: {
          type: 'string',
          description: 'finder, editor or terminal; finder when left out',
        },
      },
    },
    // It writes a request to open a window, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_folder',
    description:
      'Make one new, empty folder they named, inside their home: in the folder they said, such as "in Documents" or "in my projects folder", or in Documents when they named no place. When a folder by that name is already there it is used as it is. Use it when they ask to create a folder, or to start a session in a new folder; then pass the path it returns as repository to propose_start. Read it back once first, like "Shall I create a folder called health in Documents and start Claude Code there?".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "the new folder's name, as they said it" },
        in: {
          type: 'string',
          description:
            'the folder to make it in, by name or path; Documents when left out',
        },
      },
    },
    // It makes one empty folder inside the person's home and nothing else.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

export const FOLDER_CALLS: Readonly<Record<string, OperatorCall>> = {
  folders: (deps, _seams, args) => foldersTool(deps, args),
  open_folder: (deps, _seams, args) => openFolderTool(deps, args),
  create_folder: (deps, _seams, args) => createFolderTool(deps, args),
};

async function createFolderTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const made = await createFolder(
    deps.home,
    textArg(args, 'name') ?? '',
    textArg(args, 'in'),
  );
  if ('why' in made)
    return {
      created: false,
      said: `Nothing was made: ${made.why}. Say so in a sentence.`,
    };
  await noteFolderUse(deps.home, made.path, deps.now().toISOString());
  return {
    ...made,
    said: made.created
      ? 'Made. Start the session with this path as repository, and say in a few words that the folder is made.'
      : 'It was already there, so it is used as it is. Start the session with this path as repository.',
  };
}

export async function foldersTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const now = deps.now().getTime();
  const uses = await folderUses(deps.home, now);
  const said = textArg(args, 'name');
  if (said === undefined || said.trim() === '') {
    return {
      mostUsed: uses.slice(0, MOST_USED).map((each) => ({
        name: spokenName(each.path),
        path: each.path,
        uses: each.uses,
      })),
    };
  }
  const found = await matching(deps.home, said, uses, now);
  return {
    matches: found.map(({ folder, match }) => ({
      name: folder.name,
      path: folder.path,
      match: Math.round(match * 100) / 100,
      uses: uses.find((each) => each.path === folder.path)?.uses ?? 0,
    })),
    said:
      found.length === 0
        ? 'No folder by that name. Offer the ones they use most, from folders with no name.'
        : 'Open the first unless two are equally close and neither is used more; then ask which, naming each by its parent folder.',
  };
}

/** The closest names first, and among names as close, the folder they use most. */
async function matching(
  home: string,
  said: string,
  uses: readonly FolderUse[],
  now: number,
): Promise<{ folder: Folder; match: number }[]> {
  const used = new Map(uses.map((each) => [each.path, weight(each, now)]));
  return (await homeFolders(home, now))
    .map((folder) => ({ folder, match: nameMatch(said, folder, home) }))
    .filter((each) => each.match >= LEAST_MATCH)
    .sort(
      (a, b) =>
        (Math.abs(b.match - a.match) > TIE_WITHIN ? b.match - a.match : 0) ||
        (used.get(b.folder.path) ?? 0) - (used.get(a.folder.path) ?? 0),
    )
    .slice(0, MOST_MATCHES);
}

export async function openFolderTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const path = await existingFolder(deps.home, textArg(args, 'path') ?? '');
  if (path === null)
    return { opened: false, said: 'That folder is not there. Call folders to find it.' };
  const asked = textArg(args, 'in')?.toLowerCase() ?? FOLDER_OPENER.FINDER;
  const opener = (OPENERS.includes(asked) ? asked : FOLDER_OPENER.FINDER) as FolderOpener;
  const at = deps.now().toISOString();
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.FOLDER,
    sessionId: 'folder',
    agent: 'memnox',
    title: opener,
    cwd: path,
    at,
  });
  await noteFolderUse(deps.home, path, at);
  return { opened: true, path, in: opener };
}

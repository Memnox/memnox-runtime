import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import {
  DEFAULT_MCP_MEMORY_TOOL,
  isCallSource,
  isInstructionFile,
  isKeptSecretName,
  isMarkdown,
  MEMORY_SCOPE,
  MEMORY_SOURCE_KIND,
  MEMORY_SOURCE_KINDS,
  readHub,
  SUPERMEMORY_URL,
  trustOf,
  type MemorySourceInput,
  type MemorySourceKind,
  type MemorySourceRecord,
  type SqliteMemoryStore,
} from '@memnox/core';

/**
 * A source added from a form, checked before it is kept: a folder that is there, an API over
 * https with only the name of its key, a server the hub holds. Trust is the kind's, never the form's.
 */

/** The OS store entry a Supermemory key is kept under when the form names none. */
const SUPERMEMORY_SECRET = 'supermemory';

type SourceAdded = { refused: string } | { source: MemorySourceRecord };

export async function addSource(
  home: string,
  store: SqliteMemoryStore,
  input: MemorySourceInput,
  now: Date,
): Promise<SourceAdded> {
  const kind = kindRefusal(input.kind);
  if (kind !== null) return kind;
  const placed = await placeOf(home, input);
  if ('refused' in placed) return placed;
  const instructions = input.kind === MEMORY_SOURCE_KIND.INSTRUCTIONS;
  if (input.scope === MEMORY_SCOPE.PROJECT && !instructions)
    return {
      refused: 'Project memory comes from a repository: add its instruction files.',
    };
  const same = store
    .sources()
    .find(
      (each) =>
        each.kind === input.kind &&
        each.location === placed.location &&
        each.server === placed.server,
    );
  if (same !== undefined) return { refused: `${same.name} is already a source.` };
  const source = recordOf(input, placed, now);
  store.putSource(source);
  return { source };
}

function kindRefusal(kind: string): { refused: string } | null {
  if (!MEMORY_SOURCE_KINDS.includes(kind))
    return { refused: `A source is one of ${MEMORY_SOURCE_KINDS.join(', ')}.` };
  // Kept by Memnox from the calls agents make, so a form naming one would point it at any folder.
  if (isCallSource(kind))
    return { refused: 'What agents read through their tools is kept by Memnox itself.' };
  return null;
}

type Placed =
  | { refused: string }
  | (Pick<MemorySourceRecord, 'location'> &
      Partial<Pick<MemorySourceRecord, 'secret' | 'server' | 'tool' | 'project'>>);

/** The record a placed source is kept as, under a fresh id. */
function recordOf(
  input: MemorySourceInput,
  placed: Exclude<Placed, { refused: string }>,
  now: Date,
): MemorySourceRecord {
  const instructions = input.kind === MEMORY_SOURCE_KIND.INSTRUCTIONS;
  return {
    id: `msrc_${randomUUID()}`,
    kind: input.kind,
    name: nameOf(input, placed.location),
    trust: trustOf(input.kind),
    // A repository's instruction files are that project's; everything else is the person's own.
    scope: instructions ? MEMORY_SCOPE.PROJECT : MEMORY_SCOPE.PERSONAL,
    ...(instructions ? { project: placed.project ?? placed.location } : {}),
    location: placed.location,
    ...(placed.secret === undefined ? {} : { secret: placed.secret }),
    ...(placed.server === undefined ? {} : { server: placed.server }),
    ...(placed.tool === undefined ? {} : { tool: placed.tool }),
    addedAt: now.toISOString(),
  };
}

async function placeOf(home: string, input: MemorySourceInput): Promise<Placed> {
  switch (input.kind) {
    case MEMORY_SOURCE_KIND.SUPERMEMORY:
      return apiPlace(input);
    case MEMORY_SOURCE_KIND.MCP:
      return serverPlace(home, input);
    default:
      return folderPlace(input.kind, input.location);
  }
}

async function folderPlace(
  kind: MemorySourceKind,
  location: string | undefined,
): Promise<Placed> {
  if (location === undefined || !isAbsolute(location))
    return { refused: 'Name the folder or the file by its full path.' };
  const path = resolve(location);
  const info = await stat(path).catch(() => null);
  if (info === null) return { refused: `${path} is not here.` };
  // The real path, so a project source matches the repository root a session reads from git.
  if (info.isDirectory()) return { location: await realpath(path) };
  if (!info.isFile()) return { refused: `${path} is neither a folder nor a file.` };
  const refused = fileRefusal(kind, path);
  if (refused !== null) return { refused };
  const file = await realpath(path);
  // One instruction file belongs to the repository it sits at the top of.
  return {
    location: file,
    ...(kind === MEMORY_SOURCE_KIND.INSTRUCTIONS ? { project: dirname(file) } : {}),
  };
}

/** A vault is always a folder, and a picked file must be one its kind reads. */
function fileRefusal(kind: MemorySourceKind, path: string): string | null {
  switch (kind) {
    case MEMORY_SOURCE_KIND.OBSIDIAN:
      return 'An Obsidian vault is a folder: choose the vault rather than one note.';
    case MEMORY_SOURCE_KIND.INSTRUCTIONS:
      return isInstructionFile(path)
        ? null
        : `${basename(path)} is not an instruction file. Choose CLAUDE.md, AGENTS.md, GEMINI.md, a Cursor rule, or the repository.`;
    default:
      return isMarkdown(path)
        ? null
        : `${basename(path)} is not Markdown. Choose a .md or .markdown file, or a folder.`;
  }
}

function apiPlace(input: MemorySourceInput): Placed {
  const location = (input.location ?? SUPERMEMORY_URL).replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return { refused: `${location} is not a link.` };
  }
  // The key travels with every request, so only ever over https.
  if (url.protocol !== 'https:')
    return { refused: 'Supermemory is reached over https only.' };
  const secret = input.secret ?? SUPERMEMORY_SECRET;
  if (!isKeptSecretName(secret))
    return { refused: `${secret} is not a secret name Memnox can keep.` };
  return { location, secret };
}

async function serverPlace(home: string, input: MemorySourceInput): Promise<Placed> {
  if (input.server === undefined) return { refused: 'Name the MCP Hub server to read.' };
  const hub = await readHub(home);
  if (!hub.servers.some((each) => each.name === input.server))
    return { refused: `${input.server} is not in the MCP Hub.` };
  return {
    location: `mcp://${input.server}`,
    server: input.server,
    tool: input.tool ?? DEFAULT_MCP_MEMORY_TOOL,
  };
}

function nameOf(input: MemorySourceInput, location: string): string {
  const named = (input.name ?? '').trim();
  if (named !== '') return named;
  if (input.kind === MEMORY_SOURCE_KIND.SUPERMEMORY) return 'Supermemory';
  if (input.kind === MEMORY_SOURCE_KIND.MCP) return input.server ?? location;
  return basename(location);
}

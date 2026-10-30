import { createHash } from 'node:crypto';
import { INDEX_KIND, type IndexKind } from '../daemon/community-index';
import { orgSkillDigest } from '../skills/org-skills';

/**
 * The community index and a version's content as Memnox Cloud's marketplace serves them, and as a
 * plain git repository holding the same files does. Both arrive as untrusted JSON, so each is read
 * field by field, and a version's content is trusted only once its digest is worked out again here.
 */

export const INDEX_FORMAT = 'memnox-marketplace-index';
export const CONTENT_FORMAT = 'memnox-marketplace-content';
const FORMAT_VERSION = 1;
/** What the marketplace puts in one index, so a hostile one cannot make a screen draw for ever. */
const MOST_ENTRIES = 5000;
const DIGEST_PREFIX = 'sha256:';
const KINDS: readonly string[] = Object.values(INDEX_KIND);

export interface IndexEntry {
  id: string;
  name: string;
  kind: IndexKind;
  description: string;
  category?: string;
  publisher: { kind: string; name: string };
  license?: string;
  agents: string[];
  latest?: { version: string; digest: string; contentUrl: string };
  yanked: string[];
}

export interface CommunityIndex {
  generatedAt: string;
  complete: boolean;
  entries: IndexEntry[];
}

/** What a version says it needs, which an install carries into the skill's manifest. */
export interface IndexDeclared {
  tools: string[];
  mcpServers: string[];
  permissions: { filesystem: string[]; network: string[]; commands: string[] };
  agents: string[];
}

interface ContentBase {
  id: string;
  name: string;
  version: string;
  digest: string;
  publisher: { kind: string; name: string };
  license: string;
  declared: IndexDeclared;
  /** Marked unsafe since the index was read, which an install refuses too. */
  yanked?: { at: string; reason: string };
}

export type IndexContent =
  | (ContentBase & {
      kind: typeof INDEX_KIND.SKILL;
      instructions: string;
      files: { path: string; text: string }[];
    })
  | (ContentBase & { kind: typeof INDEX_KIND.RULE_PACK; toml: string });

type Fields = Record<string, unknown>;

function fieldsOf(value: unknown): Fields | null {
  // Cast is safe: only an object reaches it, and each field is checked where it is read.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

function text(fields: Fields, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' ? value : undefined;
}

function texts(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? [...value]
    : null;
}

function publisherOf(value: unknown): { kind: string; name: string } | null {
  const fields = fieldsOf(value);
  if (fields === null) return null;
  const kind = text(fields, 'kind');
  const name = text(fields, 'name');
  return kind === undefined || name === undefined ? null : { kind, name };
}

function kindOf(value: unknown): IndexKind | null {
  // Cast is safe: checked against every kind just before.
  return typeof value === 'string' && KINDS.includes(value) ? (value as IndexKind) : null;
}

/** The index read whole, keeping only the entries that read as one; null for anything not an index. */
export function communityIndexFrom(value: unknown): CommunityIndex | null {
  const fields = fieldsOf(value);
  if (fields === null) return null;
  if (fields['format'] !== INDEX_FORMAT || fields['formatVersion'] !== FORMAT_VERSION)
    return null;
  const raw = fields['entries'];
  if (!Array.isArray(raw)) return null;
  const entries = raw
    .slice(0, MOST_ENTRIES)
    .map(indexEntryOf)
    .filter((entry): entry is IndexEntry => entry !== null);
  return {
    generatedAt: text(fields, 'generatedAt') ?? '',
    complete: fields['complete'] === true && raw.length <= MOST_ENTRIES,
    entries,
  };
}

function indexEntryOf(value: unknown): IndexEntry | null {
  const fields = fieldsOf(value);
  if (fields === null) return null;
  const id = text(fields, 'id');
  const name = text(fields, 'name');
  const kind = kindOf(fields['kind']);
  const publisher = publisherOf(fields['publisher']);
  const agents = texts(fields['agents'] ?? []);
  const yanked = texts(fields['yanked'] ?? []);
  if (id === undefined || name === undefined || kind === null || publisher === null)
    return null;
  if (agents === null || yanked === null) return null;
  const category = text(fields, 'category');
  const license = text(fields, 'license');
  const latest = latestOf(fields['latest']);
  return {
    id,
    name,
    kind,
    description: text(fields, 'description') ?? '',
    ...(category === undefined ? {} : { category }),
    publisher,
    ...(license === undefined ? {} : { license }),
    agents,
    ...(latest === null ? {} : { latest }),
    yanked,
  };
}

function latestOf(value: unknown): IndexEntry['latest'] | null {
  const fields = fieldsOf(value);
  if (fields === null) return null;
  const version = text(fields, 'version');
  const digest = text(fields, 'digest');
  const contentUrl = text(fields, 'contentUrl');
  if (version === undefined || digest === undefined || contentUrl === undefined)
    return null;
  return { version, digest, contentUrl };
}

/** Where a version's content sits, relative to the index naming it, as the marketplace lays it out. */
export function indexContentPath(id: string, version: string): string {
  return `listings/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/content`;
}

/** One version's content read whole; null for anything that is not one. */
export function indexContentFrom(value: unknown): IndexContent | null {
  const fields = fieldsOf(value);
  if (fields === null) return null;
  if (fields['format'] !== CONTENT_FORMAT || fields['formatVersion'] !== FORMAT_VERSION)
    return null;
  const base = contentBaseOf(fields);
  if (base === null) return null;
  const kind = kindOf(fields['kind']);
  if (kind === INDEX_KIND.RULE_PACK) {
    const toml = text(fields, 'toml');
    return toml === undefined ? null : { ...base, kind, toml };
  }
  if (kind !== INDEX_KIND.SKILL) return null;
  const instructions = text(fields, 'instructions');
  const files = filesOf(fields['files']);
  if (instructions === undefined || files === null) return null;
  return { ...base, kind, instructions, files };
}

function contentBaseOf(fields: Fields): ContentBase | null {
  const id = text(fields, 'id');
  const name = text(fields, 'name');
  const version = text(fields, 'version');
  const digest = text(fields, 'digest');
  const publisher = publisherOf(fields['publisher']);
  const declared = declaredOf(fields['declared']);
  if (id === undefined || name === undefined || version === undefined) return null;
  if (digest === undefined || publisher === null || declared === null) return null;
  const yanked = fieldsOf(fields['yanked']);
  return {
    id,
    name,
    version,
    digest,
    publisher,
    license: text(fields, 'license') ?? '',
    declared,
    ...(yanked === null
      ? {}
      : {
          yanked: {
            at: typeof yanked['at'] === 'string' ? yanked['at'] : '',
            reason: typeof yanked['reason'] === 'string' ? yanked['reason'] : '',
          },
        }),
  };
}

function declaredOf(value: unknown): IndexDeclared | null {
  const fields = fieldsOf(value);
  const permissions = fields === null ? null : fieldsOf(fields['permissions']);
  if (fields === null || permissions === null) return null;
  const tools = texts(fields['tools'] ?? []);
  const mcpServers = texts(fields['mcpServers'] ?? []);
  const agents = texts(fields['agents'] ?? []);
  const filesystem = texts(permissions['filesystem'] ?? []);
  const network = texts(permissions['network'] ?? []);
  const commands = texts(permissions['commands'] ?? []);
  if (tools === null || mcpServers === null || agents === null) return null;
  if (filesystem === null || network === null || commands === null) return null;
  return { tools, mcpServers, permissions: { filesystem, network, commands }, agents };
}

function filesOf(value: unknown): { path: string; text: string }[] | null {
  if (!Array.isArray(value)) return null;
  const files = value.map((each) => {
    const fields = fieldsOf(each);
    const path = fields === null ? undefined : text(fields, 'path');
    const body = fields === null ? undefined : text(fields, 'text');
    return path === undefined || body === undefined ? null : { path, text: body };
  });
  return files.every((file) => file !== null) ? files : null;
}

/**
 * The digest of what arrived, worked out here: for a skill, `SKILL.md` and every file framed as
 * the organization's skills are; for a pack, `sha256:` over the TOML's bytes exactly as published.
 */
export function indexContentDigest(content: IndexContent): string {
  if (content.kind === INDEX_KIND.SKILL)
    return orgSkillDigest(content.instructions, content.files);
  return `${DIGEST_PREFIX}${createHash('sha256').update(content.toml, 'utf8').digest('hex')}`;
}

/** The entries whose name or description holds every word, of one kind where one is named. */
export function matchingEntries(
  entries: readonly IndexEntry[],
  query: string | undefined,
  kind: IndexKind | undefined,
): IndexEntry[] {
  const words = (query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  return entries.filter((entry) => {
    if (kind !== undefined && entry.kind !== kind) return false;
    const haystack = `${entry.name} ${entry.description}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

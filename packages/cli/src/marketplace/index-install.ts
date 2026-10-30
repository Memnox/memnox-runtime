import {
  entryNeeds,
  entryWarnings,
  INDEX_KIND,
  indexContentDigest,
  indexContentFrom,
  indexContentPath,
  readSkillsHub,
  SKILL_SCOPE,
  skillNamed,
  type CanonicalSkill,
  type CommunityIndexView,
  type IndexContent,
  type IndexEntry,
  type IndexEntryView,
  type IndexInstalled,
  type IndexKind,
} from '@memnox/core';
import { holdSkill } from '../skills/skills-changes';
import { importPack } from '../studio/rule-changes';
import { describeCount } from '../plural';
import { fetchJson, readIndex, type IndexSend, type ReadIndex } from './index-source';

/**
 * Installing from the community index: one version fetched, refused where marked unsafe or where
 * it does not match its digest, and only then written as what grants nothing yet: a skill held in
 * the Skills Hub until accepted, or a pack's rules each waiting on the person's signature.
 */

interface InstallInput {
  name: string;
  version?: string;
  now: Date;
  send?: IndexSend;
}

export async function installFromIndex(
  home: string,
  input: InstallInput,
): Promise<IndexInstalled | { refused: string }> {
  const read = await readIndex(home, {
    refresh: false,
    now: input.now,
    send: input.send,
  });
  if (read.index === undefined)
    return { refused: read.said ?? 'The community index has not been read yet.' };
  const entry = entryNamed(read.index.entries, input.name);
  if ('refused' in entry) return entry;
  const version = input.version ?? entry.latest?.version;
  if (version === undefined)
    return {
      refused: `Every version of ${entry.name} is marked unsafe, so none is installed.`,
    };
  if (entry.yanked.includes(version))
    return {
      refused: `${entry.name} ${version} is marked unsafe, so it is not installed.`,
    };
  const content = await contentOf(read, entry, version, input.send);
  if ('refused' in content) return content;
  return content.kind === INDEX_KIND.SKILL
    ? installSkill(home, { entry, content, now: input.now })
    : installPack(home, content, input.now);
}

/** By id first, since two publishers may share a name; a name two listings share is refused. */
function entryNamed(
  entries: readonly IndexEntry[],
  name: string,
): IndexEntry | { refused: string } {
  const byId = entries.find((each) => each.id === name);
  if (byId !== undefined) return byId;
  const named = entries.filter((each) => each.name === name);
  const [only] = named;
  if (only === undefined)
    return { refused: `The community index lists nothing called ${name}.` };
  if (named.length > 1)
    return {
      refused: `${named.length} listings are called ${name}. Name one of ${named.map((each) => each.id).join(', ')}.`,
    };
  return only;
}

/** The version's content, trusted only once both digests agree with what arrived. */
async function contentOf(
  read: ReadIndex,
  entry: IndexEntry,
  version: string,
  send: IndexSend | undefined,
): Promise<IndexContent | { refused: string }> {
  const latest = entry.latest !== undefined && entry.latest.version === version;
  const relative =
    latest && entry.latest !== undefined
      ? entry.latest.contentUrl
      : indexContentPath(entry.id, version);
  const fetched = await fetchJson(new URL(relative, read.source).toString(), send);
  if ('said' in fetched) return { refused: fetched.said };
  const content = indexContentFrom(fetched.value);
  if (
    content === null ||
    content.kind !== entry.kind ||
    content.name !== entry.name ||
    content.version !== version
  )
    return {
      refused: `What arrived is not ${entry.name} ${version}, so nothing was written.`,
    };
  if (content.yanked !== undefined)
    return {
      refused: `${entry.name} ${version} was marked unsafe: ${content.yanked.reason || 'no reason given'}.`,
    };
  const digest = indexContentDigest(content);
  const named =
    latest && entry.latest !== undefined ? entry.latest.digest : content.digest;
  if (digest !== content.digest || digest !== named)
    return {
      refused: `${entry.name} ${version} did not match its digest, so nothing of it was written.`,
    };
  return content;
}

async function installSkill(
  home: string,
  { entry, content, now }: { entry: IndexEntry; content: IndexContent; now: Date },
): Promise<IndexInstalled | { refused: string }> {
  if (content.kind !== INDEX_KIND.SKILL) return { refused: 'That is not a skill.' };
  const skill: CanonicalSkill = {
    manifest: {
      name: content.name,
      version: content.version,
      description: entry.description,
      ...(entry.category === undefined ? {} : { category: entry.category }),
      publisher: content.publisher.name,
      digest: content.digest,
      dependencies: [],
      mcpServers: [...content.declared.mcpServers],
      tools: [...content.declared.tools],
      permissions: { ...content.declared.permissions },
      agents: [...content.declared.agents],
    },
    instructions: content.instructions,
    files: content.files.map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.text, 'utf8'),
    })),
  };
  const held = await holdSkill(home, skill, now);
  if ('refused' in held) return held;
  return {
    ...installedOf(content),
    proposed: [],
    held: true,
    said: `${content.name} ${content.version} is in the Skills Hub, held until you accept it.`,
  };
}

async function installPack(
  home: string,
  content: IndexContent,
  now: Date,
): Promise<IndexInstalled | { refused: string }> {
  if (content.kind !== INDEX_KIND.RULE_PACK)
    return { refused: 'That is not a rule pack.' };
  const imported = await importPack(home, content.toml, now.toISOString());
  if ('refused' in imported) return imported;
  return {
    ...installedOf(content),
    proposed: imported.proposed,
    held: false,
    said: `${describeCount(imported.proposed.length, 'rule')} of ${content.name} ${content.version} wait on your signature.`,
  };
}

function installedOf(
  content: IndexContent,
): Pick<IndexInstalled, 'id' | 'name' | 'kind' | 'version' | 'digest'> {
  return {
    id: content.id,
    name: content.name,
    kind: content.kind,
    version: content.version,
    digest: content.digest,
  };
}

/** The index as a screen browses it, each skill with the version the Skills Hub holds here. */
export async function indexView(
  home: string,
  read: ReadIndex,
  filter: { matching: (entries: readonly IndexEntry[]) => IndexEntry[] },
): Promise<CommunityIndexView> {
  const hub = await readSkillsHub(home);
  const entries = read.index === undefined ? [] : filter.matching(read.index.entries);
  return {
    source: read.source,
    marketplace: read.marketplace,
    ...(read.fetchedAt === undefined ? {} : { fetchedAt: read.fetchedAt }),
    complete: read.index === undefined ? false : read.index.complete,
    entries: entries.map((entry) =>
      entryView(entry, {
        installed: installedHere(hub, entry),
        verified: read.marketplace,
      }),
    ),
    ...(read.said === undefined ? {} : { said: read.said }),
  };
}

function installedHere(
  hub: Awaited<ReturnType<typeof readSkillsHub>>,
  entry: IndexEntry,
): string | undefined {
  if (entry.kind !== INDEX_KIND.SKILL) return undefined;
  const skill = skillNamed(hub, entry.name);
  return skill === undefined || skill.scope !== SKILL_SCOPE.PERSONAL
    ? undefined
    : skill.current;
}

function entryView(
  entry: IndexEntry,
  { installed, verified }: { installed: string | undefined; verified: boolean },
): IndexEntryView {
  const kind: IndexKind = entry.kind;
  const needs = entryNeeds(entry);
  return {
    id: entry.id,
    name: entry.name,
    kind,
    description: entry.description,
    ...(entry.category === undefined ? {} : { category: entry.category }),
    publisher: entry.publisher,
    ...(entry.license === undefined ? {} : { license: entry.license }),
    agents: entry.agents,
    ...(entry.latest === undefined
      ? {}
      : { latest: { version: entry.latest.version, digest: entry.latest.digest } }),
    yanked: entry.yanked,
    unsafe: entry.latest === undefined && entry.yanked.length > 0,
    ...(installed === undefined ? {} : { installed }),
    ...(needs === undefined ? {} : { needs }),
    warnings: entryWarnings(entry, verified),
  };
}

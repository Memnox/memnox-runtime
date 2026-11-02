import { existsSync } from 'node:fs';
import {
  allProjectStates,
  isCallSource,
  manifestToml,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  memoryDatabasePathFor,
  readCanonicalSkill,
  readHub,
  readSkillsHub,
  sharedRepositoryOf,
  skillDirFor,
  SKILL_SCOPE,
  SqliteMemoryStore,
  statementKey,
  SYNC_KIND,
  type HubSkill,
  type MemoryItem,
  type SyncItem,
} from '@memnox/core';
import { originUrlOf } from '@memnox/interceptors';
import { editableRules } from '../studio/rules-in-force';

/**
 * What this machine carries of the person's own, as sync items: hub servers with secret names only, personal
 * skills at the version accepted, projects by repository, the rules they set here, and the personal facts they
 * verified, none read out of an agent's calls, which stay here. Nothing organizational and nothing unconfirmed.
 */

/** A skill as it travels: the version, its manifest as written, its instructions and every other file. */
export interface SkillBody {
  version: string;
  manifest: string;
  instructions: string;
  files: { path: string; data: string }[];
}

/** A project as it travels: by repository, since a path names one laptop. */
interface ProjectBody {
  repository: string;
  openedAt: string;
}

/** A verified fact as it travels, without the evidence, which points into this machine's own sources. */
export interface MemoryBody {
  kind: string;
  statement: string;
  subject: string;
  rule?: unknown;
}

export async function localSyncItems(home: string): Promise<SyncItem[]> {
  const [servers, skills, projects, rules] = await Promise.all([
    serverItems(home),
    skillItems(home),
    projectItems(home),
    ruleItems(home),
  ]);
  return [...servers, ...skills, ...projects, ...rules, ...memoryItems(home)];
}

async function serverItems(home: string): Promise<SyncItem[]> {
  // The definition only: which agents have it is this machine's to decide, with a signature.
  return (await readHub(home)).servers.map((server) => ({
    kind: SYNC_KIND.SERVERS,
    name: server.name,
    body: server,
  }));
}

async function skillItems(home: string): Promise<SyncItem[]> {
  const personal = (await readSkillsHub(home)).skills.filter(
    (skill) => skill.scope === SKILL_SCOPE.PERSONAL,
  );
  const items = await Promise.all(personal.map((skill) => skillItem(home, skill)));
  return items.filter((item): item is SyncItem => item !== null);
}

async function skillItem(home: string, skill: HubSkill): Promise<SyncItem | null> {
  const dir = skillDirFor(home, {
    name: skill.name,
    scope: SKILL_SCOPE.PERSONAL,
    version: skill.current,
  });
  const read = await readCanonicalSkill(dir);
  if ('problems' in read) return null;
  const body: SkillBody = {
    version: skill.current,
    manifest: manifestToml(read.skill.manifest),
    instructions: read.skill.instructions,
    files: read.skill.files.map((file) => ({
      path: file.path,
      data: Buffer.from(file.bytes).toString('base64'),
    })),
  };
  return { kind: SYNC_KIND.SKILLS, name: skill.name, body };
}

async function projectItems(home: string): Promise<SyncItem[]> {
  const states = await allProjectStates(home);
  return states.flatMap((state) => {
    const origin = originUrlOf(state.root);
    const repository = origin === undefined ? undefined : sharedRepositoryOf(origin);
    // A clone with no remote names nothing another machine could open.
    if (repository === undefined) return [];
    const body: ProjectBody = { repository, openedAt: state.openedAt };
    return [{ kind: SYNC_KIND.PROJECTS, name: repository, body }];
  });
}

async function ruleItems(home: string): Promise<SyncItem[]> {
  return (await editableRules(home)).map((rule) => ({
    kind: SYNC_KIND.RULES,
    name: rule.name,
    body: rule,
  }));
}

/** The facts the person verified that are their own; a project's memory stays with the project. */
function memoryItems(home: string): SyncItem[] {
  // A machine with no sources has no database, and reading creates none.
  if (!existsSync(memoryDatabasePathFor(home))) return [];
  const store = SqliteMemoryStore.forHome(home);
  try {
    // What agents read through their tools stays on this machine, even sealed for the person's own others.
    const calls = new Set(
      store
        .sources()
        .filter((each) => isCallSource(each.kind))
        .map((each) => each.id),
    );
    return store
      .items({ statuses: [MEMORY_STATUS.VERIFIED], scope: MEMORY_SCOPE.PERSONAL })
      .filter((item) => item.sourceId === undefined || !calls.has(item.sourceId))
      .map((item) => ({
        kind: SYNC_KIND.MEMORY,
        name: memoryNameOf(item),
        body: memoryBodyOf(item),
      }));
  } finally {
    store.close();
  }
}

/** Named by what it says, so the same fact verified on two machines is one item. */
export function memoryNameOf(item: Pick<MemoryItem, 'kind' | 'statement'>): string {
  return statementKey(item.kind, item.statement);
}

function memoryBodyOf(item: MemoryItem): MemoryBody {
  return {
    kind: item.kind,
    statement: item.statement,
    subject: item.subject,
    ...(item.rule === undefined ? {} : { rule: item.rule }),
  };
}

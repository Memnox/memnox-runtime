import { existsSync } from 'node:fs';
import {
  evidenceRef,
  MEMORY_KIND,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  memoryDatabasePathFor,
  readWorkspaceMemoryCached,
  SqliteMemoryStore,
  type MemoryItem,
  type WorkspaceCandidate,
  type WorkspaceFact,
  type WorkspaceMemory,
} from '@memnox/core';
import { repositoryRootOf } from '@memnox/interceptors';
import { projectMemoryKey } from '../projects/project-organization';

/**
 * What a session is handed as memory: what this machine learned from its person's own sources
 * first, then what it pulled from the workspace. Verified items are facts; candidates, conflicts
 * and an agent's suggestions are handed apart as unconfirmed, and never as facts.
 */

/** Enough of the local store for any answer, which is cut again to what one answer says. */
const MOST_LOCAL_READ = 200;

/** Who a local fact was confirmed by, said so an agent never reads it as the workspace's. */
const CONFIRMED_HERE = 'the person on this machine';

/** How a kind reads to an agent, beside the workspace's decision, policy and owner. */
const KIND_AS_FACT: Readonly<Record<string, string>> = {
  [MEMORY_KIND.FACT]: 'decision',
  [MEMORY_KIND.CONVENTION]: 'convention',
  [MEMORY_KIND.RULE]: 'policy',
};

export interface SessionMemory {
  memory: WorkspaceMemory;
  /** Where it came from, in the words an answer says it in. */
  from: string;
}

export async function readSessionMemory(
  home: string,
  cwd: string,
  now: Date,
): Promise<SessionMemory | null> {
  const pulled = await readWorkspaceMemoryCached(home);
  const local = readLocal(home, await projectKeysOf(home, cwd));
  if (local === null || (local.facts.length === 0 && local.candidates.length === 0)) {
    return pulled === null
      ? null
      : {
          memory: pulled,
          from: `what this machine pulled from the workspace at ${pulled.syncedAt}`,
        };
  }
  const unconfirmed = [
    ...local.candidates,
    ...(pulled === null ? [] : (pulled.unconfirmed ?? [])),
  ];
  return {
    memory: {
      hash: pulled === null ? 'local' : pulled.hash,
      facts: [...local.facts, ...(pulled === null ? [] : pulled.facts)],
      ...(unconfirmed.length === 0 ? {} : { unconfirmed }),
      withheld: pulled === null ? 0 : pulled.withheld,
      syncedAt: pulled === null ? now.toISOString() : pulled.syncedAt,
    },
    from:
      pulled === null
        ? 'what this machine learned from the sources its person added'
        : `what this machine learned from its person's sources, then what it pulled from the workspace at ${pulled.syncedAt}`,
  };
}

/** The keys this repository's project memory is kept under: the clone, or the shared project it is. */
async function projectKeysOf(home: string, cwd: string): Promise<string[]> {
  const root = repositoryRootOf(cwd);
  if (root === null) return [];
  const place = await projectMemoryKey(home, root);
  return 'key' in place ? [place.key] : [];
}

/** The person's own and this repository's items; another project's are not this session's. */
function readLocal(
  home: string,
  projectKeys: readonly string[],
): { facts: WorkspaceFact[]; candidates: WorkspaceCandidate[] } | null {
  // A machine with no sources has no database, and reading creates none.
  if (!existsSync(memoryDatabasePathFor(home))) return null;
  const store = SqliteMemoryStore.forHome(home);
  try {
    const items = store
      .items({ limit: MOST_LOCAL_READ })
      .filter(
        (item) =>
          item.scope === MEMORY_SCOPE.PERSONAL ||
          (item.project !== undefined && projectKeys.includes(item.project)),
      );
    return {
      facts: items.filter((item) => item.status === MEMORY_STATUS.VERIFIED).map(factOf),
      candidates: items
        .filter(
          (item) =>
            item.status === MEMORY_STATUS.CANDIDATE ||
            item.status === MEMORY_STATUS.CONFLICTING,
        )
        .map(candidateOf),
    };
  } finally {
    store.close();
  }
}

function factOf(item: MemoryItem): WorkspaceFact {
  const ref = firstRef(item);
  return {
    id: item.id,
    kind: KIND_AS_FACT[item.kind] ?? item.kind,
    statement: item.statement,
    subject: item.subject,
    ...(item.project === undefined ? {} : { scope: item.project }),
    ...(ref === undefined ? {} : { sourceRef: ref }),
    verifiedBy: CONFIRMED_HERE,
    ...(item.decidedAt === undefined ? {} : { settledAt: item.decidedAt }),
  };
}

function candidateOf(item: MemoryItem): WorkspaceCandidate {
  const ref = firstRef(item);
  const conflicting = item.status === MEMORY_STATUS.CONFLICTING;
  return {
    id: item.id,
    kind: KIND_AS_FACT[item.kind] ?? item.kind,
    statement: item.statement,
    subject: conflicting
      ? `${item.subject}, disputed by another confirmed fact`
      : item.subject,
    standing: 'candidate',
    approved: false,
    sources: [
      item.suggestedBy === undefined
        ? 'your notes'
        : `a suggestion by ${item.suggestedBy}`,
    ],
    ...(ref === undefined ? {} : { sourceRef: ref }),
    ...(item.tainted ? { untrusted: true } : {}),
    detectedAt: item.createdAt,
  };
}

function firstRef(item: MemoryItem): string | undefined {
  const first = item.evidence.find((each) => !each.stale) ?? item.evidence[0];
  return first === undefined ? undefined : evidenceRef(first);
}

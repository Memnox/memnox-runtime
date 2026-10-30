import { existsSync } from 'node:fs';
import {
  agentsOf,
  canonicalJson,
  DAY_MS,
  DECISION_EFFECT,
  hubServerProblems,
  MEMORY_ORIGIN,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  parseManifest,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  sentenceOfRule,
  skillDirFor,
  skillProblems,
  SKILL_SCOPE,
  SqliteMemoryStore,
  SYNC_KIND,
  validatePolicyDocument,
  withServer,
  withoutServer,
  writeCanonicalSkill,
  writeHub,
  type HubServer,
  type MemoryKind,
  type NewMemoryItem,
  type Policy,
  type ProposedChange,
  type SyncItem,
} from '@memnox/core';
import { syncHub } from '../mcp/hub-writer';
import { machinePolicyPath, writeMachineRules } from '../protect/machine-rules';
import { removeRule } from '../studio/rule-changes';
import { memoryNameOf, type MemoryBody, type SkillBody } from './local-items';

/**
 * What arrives from the person's other machines, put where this machine keeps it, and never
 * wider than it would be by hand: a server lands given to nobody, a skill waits in the Skills Hub
 * to be accepted, and an allow, or a launch line an agent already runs, waits on a signature.
 */

/** Who the ledger names as having proposed what sync could not put in place by itself. */
const PROPOSED_BY = 'agt_memnox-personal-sync';
/** A day, so a change that arrived overnight still waits when the person sits down. */
const PROPOSAL_TTL_MS = DAY_MS;
/** Who a fact verified on another machine is said to be confirmed by here. */
const CONFIRMED_ELSEWHERE = 'personal sync';

/** Whether the item now stands here as it arrived, and, where it does not, why in a sentence. */
interface Applied {
  here: boolean;
  said?: string;
}

interface Place {
  home: string;
  at: string;
}

export async function applySyncItem(place: Place, item: SyncItem): Promise<Applied> {
  switch (item.kind) {
    case SYNC_KIND.SERVERS:
      return applyServer(place, item);
    case SYNC_KIND.SKILLS:
      return applySkill(place, item);
    case SYNC_KIND.RULES:
      return applyRule(place, item);
    case SYNC_KIND.MEMORY:
      return applyMemory(place, item);
    default:
      // A project opened elsewhere is listed rather than opened, since its path is another laptop's.
      return { here: false };
  }
}

/** An item another machine deleted, taken away here the same way a person would take it. */
export async function removeSyncItem(
  place: Place,
  item: Pick<SyncItem, 'kind' | 'name'>,
): Promise<Applied> {
  if (item.kind === SYNC_KIND.SERVERS) {
    const hub = await readHub(place.home);
    if (!hub.servers.some((server) => server.name === item.name)) return { here: true };
    // Taking a server away only narrows, so it goes at once.
    const without = withoutServer(hub, item.name);
    await writeHub(place.home, without);
    // A config that will not write must not fail the sync; the next hub sync from any screen writes it.
    await syncHub(place.home, without).catch(() => undefined);
    return { here: true };
  }
  if (item.kind === SYNC_KIND.RULES) {
    const removed = await removeRule(place.home, item.name, place.at);
    if ('proposed' in removed)
      return {
        here: false,
        said: `${item.name} was taken away on your other machine, and waits on your signature here.`,
      };
    return { here: true };
  }
  if (item.kind === SYNC_KIND.MEMORY) return forgetFact(place.home, item.name);
  return { here: false };
}

async function applyServer(place: Place, item: SyncItem): Promise<Applied> {
  // Cast is safe: checked whole by the hub's own validator on the next line.
  const server = item.body as HubServer;
  if (typeof server !== 'object' || server === null || server.name !== item.name)
    return {
      here: false,
      said: `${item.name} did not read as a server, so it was left out.`,
    };
  if (hubServerProblems(server).length > 0)
    return {
      here: false,
      said: `${item.name} did not read as a server, so it was left out.`,
    };
  const hub = await readHub(place.home);
  const held = hub.servers.find((each) => each.name === item.name);
  if (held !== undefined && canonicalJson(held) === canonicalJson(server))
    return { here: true };
  if (held === undefined || agentsOf(hub, item.name).length === 0) {
    // Given to no agent, so it reaches nothing until the person assigns it here.
    await writeHub(place.home, withServer(hub, server));
    return { here: true };
  }
  await propose(place, {
    change: { kind: PROPOSAL_KIND.MCP_HUB, hub: { put: server } },
    rationale: `Run ${item.name} the way your other machine does`,
  });
  return {
    here: false,
    said: `${item.name} changed on your other machine, and waits on your signature here.`,
  };
}

async function applySkill(place: Place, item: SyncItem): Promise<Applied> {
  // Cast is safe: each field is read as text and the skill is checked whole before it is written.
  const body = item.body as SkillBody;
  const manifest =
    typeof body.manifest === 'string' ? parseManifest(body.manifest) : null;
  if (manifest === null || 'problems' in manifest || !Array.isArray(body.files))
    return {
      here: false,
      said: `${item.name} did not read as a skill, so it was left out.`,
    };
  const skill = {
    manifest,
    instructions: String(body.instructions),
    files: body.files.map((file) => ({
      path: String(file.path),
      bytes: Buffer.from(String(file.data), 'base64'),
    })),
  };
  if (skillProblems(skill).length > 0)
    return {
      here: false,
      said: `${item.name} did not read as a skill, so it was left out.`,
    };
  const dir = skillDirFor(place.home, {
    name: item.name,
    scope: SKILL_SCOPE.PERSONAL,
    version: body.version,
  });
  // A version already kept here is the hub's own copy, which nothing from elsewhere rewrites.
  if (!existsSync(dir)) await writeCanonicalSkill(dir, skill);
  return {
    here: false,
    said: `${item.name} ${body.version} came from your other machine and waits in the Skills Hub to be accepted here.`,
  };
}

async function applyRule(place: Place, item: SyncItem): Promise<Applied> {
  let rule: Policy;
  try {
    const [read] = validatePolicyDocument({ version: 1, policies: [item.body] }).policies;
    if (read === undefined || read.name !== item.name) throw new Error('no rule');
    rule = read;
  } catch {
    // A rule the gate would not load is one this machine never puts in force.
    return {
      here: false,
      said: `${item.name} would not load as a rule, so it was left out.`,
    };
  }
  if (rule.decision.effect !== DECISION_EFFECT.ALLOW) {
    // A deny or an ask only narrows what agents may do, so it holds at once.
    await writeMachineRules(place.home, [rule]);
    return { here: true };
  }
  await propose(place, {
    change: {
      kind: PROPOSAL_KIND.RULES,
      file: machinePolicyPath(place.home),
      rules: [rule],
    },
    rationale: `Apply here as on your other machine: ${sentenceOfRule(rule)}`,
  });
  return {
    here: false,
    said: `${item.name} widens what agents may do, so it waits on your signature here.`,
  };
}

function applyMemory(place: Place, item: SyncItem): Applied {
  // Cast is safe: each field is checked to be text before the fact is kept.
  const body = item.body as MemoryBody;
  if (typeof body.statement !== 'string' || typeof body.kind !== 'string')
    return { here: false, said: 'A fact did not read, so it was left out.' };
  const store = SqliteMemoryStore.forHome(place.home);
  try {
    const fact: NewMemoryItem = {
      // Cast is safe: the store keeps only the kinds it knows, and the fact was verified as one of them.
      kind: body.kind as MemoryKind,
      statement: body.statement,
      subject: typeof body.subject === 'string' ? body.subject : '',
      scope: MEMORY_SCOPE.PERSONAL,
      origin: MEMORY_ORIGIN.PERSON,
      tainted: false,
      evidence: [],
    };
    const added = store.add(fact, place.at);
    if ('rejectedBefore' in added)
      return {
        here: false,
        said: 'A fact you rejected here arrived verified from your other machine, and stays rejected.',
      };
    const id = 'added' in added ? added.added.id : added.merged;
    store.decide(id, MEMORY_STATUS.VERIFIED, { by: CONFIRMED_ELSEWHERE, at: place.at });
    return { here: true };
  } finally {
    store.close();
  }
}

function forgetFact(home: string, name: string): Applied {
  const store = SqliteMemoryStore.forHome(home);
  try {
    const held = store
      .items({ statuses: [MEMORY_STATUS.VERIFIED], scope: MEMORY_SCOPE.PERSONAL })
      .filter((item) => memoryNameOf(item) === name);
    for (const item of held) store.forget(item.id);
    return { here: true };
  } finally {
    store.close();
  }
}

async function propose(
  place: Place,
  input: { change: ProposedChange; rationale: string },
): Promise<void> {
  await new Proposals(place.home).propose({
    ...input,
    proposedBy: PROPOSED_BY,
    at: place.at,
    ttlMs: PROPOSAL_TTL_MS,
  });
}

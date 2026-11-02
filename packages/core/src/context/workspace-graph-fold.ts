/**
 * One picture of the workspace: the live graph's nodes and lines, each settled fact folded onto the
 * node the cloud drew for it, and each candidate beside them. With no live graph, the saved facts.
 */

import type { CloudGraph, CloudNode } from './workspace-graph-cloud';
import type { WorkspaceCandidate, WorkspaceFact, WorkspaceMemory } from './workspace-memory';
import {
  WORKSPACE_GRAPH_SOURCE,
  WORKSPACE_LINK_KIND,
  WORKSPACE_NODE_KIND,
  WORKSPACE_NODE_STATUS,
  workspaceCandidateId,
  workspaceFactId,
  workspaceSourceId,
  type WorkspaceGraphFallback,
  type WorkspaceGraphLink,
  type WorkspaceGraphNode,
  type WorkspaceGraphView,
  type WorkspaceLinkKind,
  type WorkspaceNodeKind,
} from './workspace-graph';

/** Everything a picture is folded from: the live graph where it was read, and the saved facts. */
export interface WorkspaceGraphInputs {
  live: CloudGraph | null;
  memory: WorkspaceMemory | null;
  /** When the live graph was read, ISO. */
  readAt?: string;
  fallback?: WorkspaceGraphFallback;
}

const PERSON_NAME_PREFIX = 'name:';
const HANDLE_PREFIX = 'handle:';
const HANDLE_SEPARATOR = ':';
const SOURCE_KIND = 'source';
/** A count of one says nothing a mark without a badge does not. */
const LEAST_COUNTED = 2;

/** The cloud's ref kinds a memory picture draws, and what each becomes; an agent or a path is not memory. */
const KIND_OF: Readonly<Record<string, WorkspaceNodeKind>> = {
  source: WORKSPACE_NODE_KIND.SOURCE,
  item: WORKSPACE_NODE_KIND.DOCUMENT,
  document: WORKSPACE_NODE_KIND.DOCUMENT,
  ticket: WORKSPACE_NODE_KIND.DOCUMENT,
  link: WORKSPACE_NODE_KIND.DOCUMENT,
  passage: WORKSPACE_NODE_KIND.PASSAGE,
  conversation: WORKSPACE_NODE_KIND.CONVERSATION,
  person: WORKSPACE_NODE_KIND.PERSON,
  handle: WORKSPACE_NODE_KIND.PERSON,
  group: WORKSPACE_NODE_KIND.GROUP,
  policy: WORKSPACE_NODE_KIND.POLICY,
  fact: WORKSPACE_NODE_KIND.DECISION,
};

const LINK_KINDS: ReadonlySet<string> = new Set(Object.values(WORKSPACE_LINK_KIND));

export function foldWorkspaceGraph(inputs: WorkspaceGraphInputs): WorkspaceGraphView {
  const building = new Building();
  const { live, memory } = inputs;
  if (live !== null) addLive(live, building);
  if (memory !== null) addSaved(memory, building);
  return {
    nodes: building.finished(),
    links: building.links,
    withheld: Math.max(live === null ? 0 : live.withheld, memory === null ? 0 : memory.withheld),
    truncated: live === null ? false : live.truncated,
    source: live === null ? WORKSPACE_GRAPH_SOURCE.SAVED : WORKSPACE_GRAPH_SOURCE.LIVE,
    ...(live === null && inputs.fallback !== undefined ? { fallback: inputs.fallback } : {}),
    ...(live === null || inputs.readAt === undefined ? {} : { readAt: inputs.readAt }),
    ...(memory === null || memory.syncedAt === '' ? {} : { syncedAt: memory.syncedAt }),
  };
}

/** Nodes once each by id, lines only between two of them and once each. */
class Building {
  readonly nodes = new Map<string, WorkspaceGraphNode>();
  readonly links: WorkspaceGraphLink[] = [];
  private readonly joined = new Set<string>();

  add(node: WorkspaceGraphNode): void {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  /** Fills what the node already drawn lacks, so a fact keeps the cloud's place and gains its words. */
  enrich(id: string, fields: Partial<WorkspaceGraphNode>): void {
    const held = this.nodes.get(id);
    if (held === undefined) return;
    const missing = Object.entries(fields).filter(
      ([key, value]) => value !== undefined && held[key as keyof WorkspaceGraphNode] === undefined,
    );
    this.nodes.set(id, { ...held, ...Object.fromEntries(missing) });
  }

  link(from: string, to: string, kind: WorkspaceLinkKind, basis?: string): void {
    if (from === to || !this.nodes.has(from) || !this.nodes.has(to)) return;
    const key = JSON.stringify([from, to, kind]);
    if (this.joined.has(key)) return;
    this.joined.add(key);
    this.links.push({ from, to, kind, ...(basis === undefined ? {} : { basis }) });
  }

  /** The person under this name: the one the cloud drew where a label matches, else one of their own. */
  person(name: string): string {
    const lowered = name.toLowerCase();
    for (const node of this.nodes.values()) {
      if (node.kind === WORKSPACE_NODE_KIND.PERSON && node.label.toLowerCase() === lowered) return node.id;
    }
    const id = `${PERSON_NAME_PREFIX}${lowered}`;
    this.add({ id, kind: WORKSPACE_NODE_KIND.PERSON, label: name, weight: 0 });
    return id;
  }

  /** The tool under its own word, the one the cloud drew where it did. */
  source(tool: string): string {
    const id = workspaceSourceId(tool);
    this.add({ id, kind: WORKSPACE_NODE_KIND.SOURCE, label: tool, tool, weight: 0 });
    return id;
  }

  /** Every node, weighed again over the lines kept, so a screen's sizes match what it draws. */
  finished(): WorkspaceGraphNode[] {
    const degree = new Map<string, number>();
    for (const link of this.links) {
      degree.set(link.from, (degree.get(link.from) ?? 0) + 1);
      degree.set(link.to, (degree.get(link.to) ?? 0) + 1);
    }
    return [...this.nodes.values()].map((node) => ({
      ...node,
      weight: Math.max(node.weight, degree.get(node.id) ?? 0),
    }));
  }
}

function addLive(live: CloudGraph, building: Building): void {
  const carried = carriedBy(live);
  for (const node of live.nodes) {
    const drawn = liveNode(node, carried);
    if (drawn !== null) building.add(drawn);
  }
  // A passage wears the tool of the thing it is a piece of.
  for (const edge of live.edges) {
    if (edge.kind !== WORKSPACE_LINK_KIND.CONTAINS) continue;
    const parent = building.nodes.get(edge.fromRef);
    if (parent !== undefined && parent.tool !== undefined) building.enrich(edge.toRef, { tool: parent.tool });
  }
  for (const edge of live.edges) {
    if (!LINK_KINDS.has(edge.kind)) continue;
    // Cast is safe: checked against the kinds this picture keeps.
    building.link(edge.fromRef, edge.toRef, edge.kind as WorkspaceLinkKind, edge.basis);
    const author = edge.kind === WORKSPACE_LINK_KIND.SAID ? building.nodes.get(edge.fromRef) : undefined;
    if (author !== undefined) building.enrich(edge.toRef, { saidBy: author.label });
  }
}

/** Which tool delivered each thing, by the `carries` lines from the tools the graph draws. */
function carriedBy(live: CloudGraph): Map<string, string> {
  const systems = new Map(
    live.nodes.filter((node) => node.kind === SOURCE_KIND).map((node) => [node.ref, node.label.toLowerCase()] as const),
  );
  const carried = new Map<string, string>();
  for (const edge of live.edges) {
    const tool = systems.get(edge.fromRef);
    if (edge.kind === WORKSPACE_LINK_KIND.CARRIES && tool !== undefined) carried.set(edge.toRef, tool);
  }
  return carried;
}

function liveNode(node: CloudNode, carried: ReadonlyMap<string, string>): WorkspaceGraphNode | null {
  const kind = KIND_OF[node.kind];
  if (kind === undefined) return null;
  const tool = toolOf(node, carried);
  const count = node.repeats ?? node.messages;
  return {
    id: node.ref,
    kind: kind === WORKSPACE_NODE_KIND.PERSON && node.app ? WORKSPACE_NODE_KIND.BOT : kind,
    label: node.label,
    weight: node.degree,
    ...(tool === undefined ? {} : { tool }),
    ...(node.href === undefined ? {} : { href: node.href }),
    ...(node.excerpt === undefined ? {} : { excerpt: node.excerpt }),
    ...(count === undefined || count < LEAST_COUNTED ? {} : { count }),
    ...(kind === WORKSPACE_NODE_KIND.DECISION ? { status: WORKSPACE_NODE_STATUS.VERIFIED } : {}),
    ...(node.said.length === 0 ? {} : { said: node.said }),
  };
}

function toolOf(node: CloudNode, carried: ReadonlyMap<string, string>): string | undefined {
  if (node.kind === SOURCE_KIND) return node.label.toLowerCase();
  if (node.system !== undefined) return node.system.toLowerCase();
  const delivered = carried.get(node.ref);
  if (delivered !== undefined) return delivered;
  // A handle is namespaced under its toolkit: `handle:slack:U0…`.
  if (!node.ref.startsWith(HANDLE_PREFIX)) return undefined;
  const toolkit = node.ref.slice(HANDLE_PREFIX.length).split(HANDLE_SEPARATOR, 1)[0];
  return toolkit === undefined || toolkit === '' ? undefined : toolkit;
}

function addSaved(memory: WorkspaceMemory, building: Building): void {
  for (const fact of [...memory.facts].sort((a, b) => a.id.localeCompare(b.id))) {
    addFact(fact, building);
  }
  for (const candidate of [...(memory.unconfirmed ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    addCandidate(candidate, building);
  }
}

/** A settled fact on the node the cloud drew for it, joined to whom it names and who confirmed it. */
function addFact(fact: WorkspaceFact, building: Building): void {
  const id = workspaceFactId(fact.id);
  const fields: Partial<WorkspaceGraphNode> = {
    statement: fact.statement,
    status: WORKSPACE_NODE_STATUS.VERIFIED,
    ...(fact.sourceRef === undefined ? {} : { href: fact.sourceRef }),
    ...(fact.provenance === undefined ? {} : { provenance: fact.provenance }),
    ...(fact.settledAt === undefined ? {} : { at: fact.settledAt }),
  };
  building.add({ id, kind: WORKSPACE_NODE_KIND.DECISION, label: fact.subject || fact.statement, weight: 0, ...fields });
  building.enrich(id, fields);
  const principal = named(fact.principal);
  if (principal !== undefined) building.link(id, building.person(principal), WORKSPACE_LINK_KIND.NAMES);
  const confirmer = named(fact.verifiedBy);
  if (confirmer !== undefined) building.link(building.person(confirmer), id, WORKSPACE_LINK_KIND.APPROVED);
}

/** A candidate, waiting, read from its tools and said by its authors. */
function addCandidate(candidate: WorkspaceCandidate, building: Building): void {
  const id = workspaceCandidateId(candidate.id);
  const tools = candidate.sources.map((each) => each.trim().toLowerCase()).filter((each) => each !== '');
  const said = (candidate.saidBy ?? []).flatMap((each) => named(each) ?? []);
  building.add({
    id,
    kind: WORKSPACE_NODE_KIND.CANDIDATE,
    label: candidate.subject || candidate.statement,
    statement: candidate.statement,
    status: WORKSPACE_NODE_STATUS.CANDIDATE,
    weight: 0,
    ...(tools[0] === undefined ? {} : { tool: tools[0] }),
    ...(candidate.sourceRef === undefined ? {} : { href: candidate.sourceRef }),
    ...(candidate.detectedAt === undefined ? {} : { at: candidate.detectedAt }),
    ...(said[0] === undefined ? {} : { saidBy: said[0] }),
    ...(candidate.untrusted === true ? { untrusted: true as const } : {}),
  });
  for (const tool of tools) building.link(id, building.source(tool), WORKSPACE_LINK_KIND.READ_FROM);
  for (const name of said) building.link(building.person(name), id, WORKSPACE_LINK_KIND.SAID);
  const principal = named(candidate.principal);
  if (principal !== undefined) building.link(id, building.person(principal), WORKSPACE_LINK_KIND.NAMES);
}

function named(name: string | undefined): string | undefined {
  const trimmed = name === undefined ? '' : name.trim();
  return trimmed === '' ? undefined : trimmed;
}

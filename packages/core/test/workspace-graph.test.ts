import { describe, expect, it } from 'vitest';
import {
  foldWorkspaceGraph,
  parseCloudGraph,
  WORKSPACE_GRAPH_FALLBACK,
  WORKSPACE_GRAPH_SOURCE,
  WORKSPACE_LINK_KIND,
  WORKSPACE_NODE_KIND,
  WORKSPACE_NODE_STATUS,
  type WorkspaceMemory,
} from '../src/index';

/**
 * The workspace's graph as a screen draws it: the console's live answer read field by field, each
 * settled fact folded onto the node the cloud drew for it, candidates beside them, and the saved
 * facts alone, saying why, when the cloud could not be asked.
 */

const READ_AT = '2026-11-01T09:00:00.000Z';

/** Shaped like the cloud's `GraphView`, with what a Slack channel and a bot leave behind. */
const CLOUD = {
  nodes: [
    { ref: 'source:slack', kind: 'source', label: 'slack', degree: 2 },
    {
      ref: 'item:ev1',
      kind: 'item',
      label: 'We ship the beta on Monday',
      href: 'https://acme.slack.com/archives/C1/p1',
      excerpt: 'We ship the beta on Monday, after the review.',
      repeats: 21,
      degree: 3,
    },
    { ref: 'passage:ev1#1', kind: 'passage', label: 'First part', degree: 1 },
    { ref: 'person:p1', kind: 'person', label: 'Ana Lima', degree: 1 },
    {
      ref: 'handle:github:dependabot',
      kind: 'handle',
      label: 'dependabot',
      app: true,
      messages: 40,
      said: [{ ref: 'item:ev9', label: 'Bump lodash', at: Date.parse(READ_AT) }],
      degree: 0,
    },
    { ref: 'fact:f1', kind: 'fact', label: 'payments', degree: 1 },
    { ref: 'agent:hermes', kind: 'agent', label: 'hermes', degree: 1 },
  ],
  edges: [
    {
      fromRef: 'source:slack',
      toRef: 'item:ev1',
      kind: 'carries',
      origin: 'graph',
      evidenceIds: [],
    },
    {
      fromRef: 'item:ev1',
      toRef: 'passage:ev1#1',
      kind: 'contains',
      origin: 'graph',
      evidenceIds: [],
    },
    {
      fromRef: 'person:p1',
      toRef: 'item:ev1',
      kind: 'said',
      origin: 'graph',
      basis: 'observed',
      evidenceIds: [],
    },
    {
      fromRef: 'fact:f1',
      toRef: 'item:ev1',
      kind: 'read_from',
      origin: 'graph',
      evidenceIds: [],
    },
    {
      fromRef: 'agent:hermes',
      toRef: 'item:ev1',
      kind: 'reaches',
      origin: 'reach',
      evidenceIds: [],
    },
  ],
  withheld: 3,
  truncated: true,
};

const MEMORY: WorkspaceMemory = {
  hash: 'h1',
  facts: [
    {
      id: 'f1',
      kind: 'decision',
      statement: 'Payments retry three times.',
      subject: 'payments',
      principal: 'Ana Lima',
      verifiedBy: 'Ben',
      provenance: 'declared',
      settledAt: '2026-10-30T12:00:00.000Z',
    },
  ],
  unconfirmed: [
    {
      id: 'c1',
      kind: 'decision',
      statement: 'Ship the beta on Monday.',
      subject: 'beta',
      standing: 'candidate',
      approved: false,
      sources: ['Slack'],
      saidBy: ['Cara'],
      untrusted: true,
      detectedAt: '2026-10-31T08:00:00.000Z',
    },
  ],
  withheld: 1,
  syncedAt: '2026-11-01T08:00:00.000Z',
};

const node = (view: ReturnType<typeof foldWorkspaceGraph>, id: string) =>
  view.nodes.find((each) => each.id === id);

describe('the workspace graph a screen draws', () => {
  it('reads the cloud answer field by field and refuses one that is no graph', () => {
    expect(parseCloudGraph(null)).toBeNull();
    expect(parseCloudGraph({ nodes: [] })).toBeNull();
    const graph = parseCloudGraph(CLOUD);
    expect(graph?.withheld).toBe(3);
    expect(graph?.truncated).toBe(true);
    expect(
      graph?.nodes.find((each) => each.ref === 'handle:github:dependabot')?.said[0]?.at,
    ).toBe(READ_AT);
  });

  it('draws what arrived with its tool, its count and who said it, and leaves agents off', () => {
    const view = foldWorkspaceGraph({
      live: parseCloudGraph(CLOUD),
      memory: null,
      readAt: READ_AT,
    });

    expect(view.source).toBe(WORKSPACE_GRAPH_SOURCE.LIVE);
    expect(view.readAt).toBe(READ_AT);
    expect(node(view, 'source:slack')).toMatchObject({
      kind: WORKSPACE_NODE_KIND.SOURCE,
      tool: 'slack',
    });
    expect(node(view, 'item:ev1')).toMatchObject({
      kind: WORKSPACE_NODE_KIND.DOCUMENT,
      tool: 'slack',
      count: 21,
      saidBy: 'Ana Lima',
      excerpt: 'We ship the beta on Monday, after the review.',
      href: 'https://acme.slack.com/archives/C1/p1',
    });
    expect(node(view, 'passage:ev1#1')?.tool).toBe('slack');
    expect(node(view, 'handle:github:dependabot')).toMatchObject({
      kind: WORKSPACE_NODE_KIND.BOT,
      tool: 'github',
      count: 40,
    });
    expect(node(view, 'agent:hermes')).toBeUndefined();
    // A computed reach is no memory, so its line goes with the agent.
    expect(view.links.some((link) => link.from === 'agent:hermes')).toBe(false);
    expect(view.links).toContainEqual({
      from: 'person:p1',
      to: 'item:ev1',
      kind: WORKSPACE_LINK_KIND.SAID,
      basis: 'observed',
    });
  });

  it('folds a settled fact onto the node the cloud drew and joins it to whom it names', () => {
    const view = foldWorkspaceGraph({
      live: parseCloudGraph(CLOUD),
      memory: MEMORY,
      readAt: READ_AT,
    });

    const fact = node(view, 'fact:f1');
    expect(fact).toMatchObject({
      kind: WORKSPACE_NODE_KIND.DECISION,
      label: 'payments',
      statement: 'Payments retry three times.',
      status: WORKSPACE_NODE_STATUS.VERIFIED,
      provenance: 'declared',
      at: '2026-10-30T12:00:00.000Z',
    });
    expect(view.nodes.filter((each) => each.id === 'fact:f1')).toHaveLength(1);
    // The principal is the person the cloud already drew, by the name the record writes.
    expect(view.links).toContainEqual({
      from: 'fact:f1',
      to: 'person:p1',
      kind: WORKSPACE_LINK_KIND.NAMES,
    });
    expect(view.links).toContainEqual({
      from: 'name:ben',
      to: 'fact:f1',
      kind: WORKSPACE_LINK_KIND.APPROVED,
    });
    expect(view.withheld).toBe(3);
  });

  it('draws a candidate as waiting, read from its tool and said by its author', () => {
    const view = foldWorkspaceGraph({
      live: parseCloudGraph(CLOUD),
      memory: MEMORY,
      readAt: READ_AT,
    });

    expect(node(view, 'candidate:c1')).toMatchObject({
      kind: WORKSPACE_NODE_KIND.CANDIDATE,
      status: WORKSPACE_NODE_STATUS.CANDIDATE,
      tool: 'slack',
      saidBy: 'Cara',
      untrusted: true,
    });
    expect(view.links).toContainEqual({
      from: 'candidate:c1',
      to: 'source:slack',
      kind: WORKSPACE_LINK_KIND.READ_FROM,
    });
    expect(view.links).toContainEqual({
      from: 'name:cara',
      to: 'candidate:c1',
      kind: WORKSPACE_LINK_KIND.SAID,
    });
  });

  it('answers the saved facts alone with why, when the cloud could not be asked', () => {
    const view = foldWorkspaceGraph({
      live: null,
      memory: MEMORY,
      fallback: WORKSPACE_GRAPH_FALLBACK.UNREACHABLE,
    });

    expect(view.source).toBe(WORKSPACE_GRAPH_SOURCE.SAVED);
    expect(view.fallback).toBe(WORKSPACE_GRAPH_FALLBACK.UNREACHABLE);
    expect(view.readAt).toBeUndefined();
    expect(view.syncedAt).toBe(MEMORY.syncedAt);
    expect(view.withheld).toBe(1);
    expect(node(view, 'fact:f1')?.status).toBe(WORKSPACE_NODE_STATUS.VERIFIED);
    // Its tool is drawn so the candidate still hangs off something.
    expect(node(view, 'source:slack')?.kind).toBe(WORKSPACE_NODE_KIND.SOURCE);
  });

  it('weighs a node by the lines kept, so a screen names the heavy ones', () => {
    const view = foldWorkspaceGraph({
      live: parseCloudGraph(CLOUD),
      memory: MEMORY,
      readAt: READ_AT,
    });
    const weights = view.nodes.map((each) => each.weight);
    expect(Math.max(...weights)).toBe(node(view, 'item:ev1')?.weight);
  });
});

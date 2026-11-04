import { describe, expect, it } from 'vitest';

import { CODE_GRAPH_SOURCE, type CodeGraph } from '../src/graph/code-graph';
import { graphFromGraphify, graphifyBuiltAt } from '../src/graph/graphify-graph';
import {
  GRAPH_FRESHNESS,
  excludedFromGraphs,
  freshnessOf,
  snapshotOf,
} from '../src/graph/graph-snapshot';

/**
 * A graph is kept with the commit it was built at, so how old it is always shows, and
 * it never carries a credential or an agent's own settings, whatever its builder read.
 */

const GRAPH: CodeGraph = {
  source: CODE_GRAPH_SOURCE.BUILTIN,
  files: ['src/a.ts', 'src/b.ts', '.env', '.claude/settings.local.json'],
  imports: [
    { from: 'src/a.ts', to: 'src/b.ts' },
    { from: 'src/a.ts', to: '.env' },
  ],
};

describe('a kept graph', () => {
  it('drops every path a graph never carries', () => {
    const kept = snapshotOf(GRAPH, { at: '2026-11-04T09:00:00.000Z', commit: 'c1' });
    expect(kept.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(kept.imports).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
    expect(excludedFromGraphs('config/aws-credentials.json')).toBe(true);
    expect(excludedFromGraphs('src/credentialsView.tsx')).toBe(false);
  });

  it('is current at its own commit, behind at another, dirty once a file it covers changed', () => {
    const kept = snapshotOf(GRAPH, { at: '2026-11-04T09:00:00.000Z', commit: 'c1' });
    expect(freshnessOf(kept, { head: 'c1', changedFiles: [] })).toBe(GRAPH_FRESHNESS.CURRENT);
    expect(freshnessOf(kept, { head: 'c2', changedFiles: [] })).toBe(GRAPH_FRESHNESS.BEHIND);
    expect(freshnessOf(kept, { head: 'c1', changedFiles: ['src/b.ts'] })).toBe(
      GRAPH_FRESHNESS.DIRTY,
    );
    expect(freshnessOf(kept, { head: 'c1', changedFiles: ['README.md'] })).toBe(
      GRAPH_FRESHNESS.CURRENT,
    );
  });

  it('says unknown where its source never named a commit', () => {
    const kept = snapshotOf(GRAPH, { at: '2026-11-04T09:00:00.000Z' });
    expect(freshnessOf(kept, { head: 'c1', changedFiles: [] })).toBe(GRAPH_FRESHNESS.UNKNOWN);
  });
});

describe('a Graphify graph', () => {
  const parsed = {
    built_at_commit: '3ab81ab',
    nodes: [
      { id: 'a', source_file: 'src/a.ts' },
      { id: 'b', source_file: 'src/b.ts' },
      { id: 'c', source_file: 'src/c.ts' },
    ],
    links: [
      { source: 'a', target: 'b', relation: 'imports_from', confidence: 'EXTRACTED' },
      { source: 'a', target: 'c', relation: 'imports_from', confidence: 'INFERRED' },
      { source: 'b', target: 'c', relation: 'semantically_similar_to', confidence: 'EXTRACTED' },
    ],
  };

  it('keeps only what the code states, never an inferred or similar edge, and names its commit', () => {
    expect(graphFromGraphify(parsed)?.imports).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
    expect(graphifyBuiltAt(parsed)).toBe('3ab81ab');
    expect(graphifyBuiltAt({})).toBeUndefined();
  });
});

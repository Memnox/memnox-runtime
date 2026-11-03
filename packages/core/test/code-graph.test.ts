import { describe, expect, it } from 'vitest';
import {
  CODE_GRAPH_SOURCE,
  dependentsOf,
  graphFromGraphify,
  scanImports,
} from '../src/graph';

const FILES = [
  { path: 'src/a.ts', text: "import { b } from './b';\nexport * from './lib/c.js';" },
  { path: 'src/b.ts', text: "const c = require('./lib/c');\nimport x from 'external';" },
  { path: 'src/lib/c.ts', text: "export const c = 1;\nconst d = await import('../d');" },
  { path: 'src/d/index.ts', text: 'export {};' },
  { path: 'src/e.ts', text: "import '../../outside';" },
];

describe('the builtin import scan', () => {
  it('resolves relative imports to files and ignores packages and paths out of the repository', () => {
    const graph = scanImports(FILES);

    expect(graph.source).toBe(CODE_GRAPH_SOURCE.BUILTIN);
    expect(graph.imports).toEqual([
      { from: 'src/a.ts', to: 'src/b.ts' },
      { from: 'src/a.ts', to: 'src/lib/c.ts' },
      { from: 'src/b.ts', to: 'src/lib/c.ts' },
      { from: 'src/lib/c.ts', to: 'src/d/index.ts' },
    ]);
  });
});

describe('the files that depend on one', () => {
  it('follows imports back, nearest first, within the hops given', () => {
    const graph = scanImports(FILES);

    expect(dependentsOf(graph, 'src/d/index.ts')).toEqual([
      'src/lib/c.ts',
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(dependentsOf(graph, 'src/d/index.ts', 1)).toEqual(['src/lib/c.ts']);
    expect(dependentsOf(graph, 'src/a.ts')).toEqual([]);
  });
});

describe('a Graphify graph', () => {
  it('keeps only extracted imports between two files', () => {
    const graph = graphFromGraphify({
      nodes: [
        { id: 'a', source_file: 'src/a.ts' },
        { id: 'b', source_file: 'src/b.ts' },
        { id: 'b_fn', source_file: 'src/b.ts' },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'imports_from', confidence: 'EXTRACTED' },
        { source: 'a', target: 'b_fn', relation: 'calls', confidence: 'EXTRACTED' },
        { source: 'b', target: 'a', relation: 'imports_from', confidence: 'INFERRED' },
        {
          source: 'b',
          target: 'b_fn',
          relation: 'imports_from',
          confidence: 'EXTRACTED',
        },
      ],
    });

    expect(graph?.source).toBe(CODE_GRAPH_SOURCE.GRAPHIFY);
    expect(graph?.imports).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
  });

  it('is no graph at all where the file is not that shape', () => {
    expect(graphFromGraphify({ nodes: 'x' })).toBeUndefined();
    expect(graphFromGraphify(null)).toBeUndefined();
  });
});

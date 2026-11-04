/**
 * Which files import which, filled by the builtin scan or a Graphify graph a person built,
 * asked one question: which files depend on the one an agent is about to change.
 */

export const CODE_GRAPH_SOURCE = {
  /** Read here from the files' own import lines. */
  BUILTIN: 'builtin',
  /** Read from `graphify-out/graph.json`, only its extracted import edges. */
  GRAPHIFY: 'graphify',
} as const;

export type CodeGraphSource = (typeof CODE_GRAPH_SOURCE)[keyof typeof CODE_GRAPH_SOURCE];

/** One file importing another, both as repository relative paths with forward slashes. */
export interface ImportEdge {
  from: string;
  to: string;
}

export interface CodeGraph {
  source: CodeGraphSource;
  files: readonly string[];
  imports: readonly ImportEdge[];
}

/** How far `dependentsOf` follows imports back, so a hub file never returns the whole repository. */
const MOST_DEPENDENT_HOPS = 3;

/**
 * The files that import `file`, directly or through up to `hops` other files,
 * nearest first. Never includes `file` itself.
 */
export function dependentsOf(
  graph: CodeGraph,
  file: string,
  hops: number = MOST_DEPENDENT_HOPS,
): string[] {
  const importers = new Map<string, string[]>();
  for (const edge of graph.imports) {
    const list = importers.get(edge.to) ?? [];
    list.push(edge.from);
    importers.set(edge.to, list);
  }
  const seen = new Set<string>([file]);
  const found: string[] = [];
  let frontier = [file];
  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of importers.get(current) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        found.push(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return found;
}

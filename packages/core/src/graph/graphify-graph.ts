import { CODE_GRAPH_SOURCE, type CodeGraph, type ImportEdge } from './code-graph';

/**
 * Graphify's relations that mean one file imports another. Its `calls`,
 * `references` and the inferred `semantically_similar_to` are left out, since
 * a dependent here has to be one the code states rather than one a model saw.
 */
const IMPORT_RELATIONS: readonly string[] = ['imports_from'];

/** The only confidence taken, so a guessed edge never reads as a stated one. */
const EXTRACTED = 'EXTRACTED';

interface GraphifyNode {
  id?: unknown;
  source_file?: unknown;
}

interface GraphifyLink {
  source?: unknown;
  target?: unknown;
  relation?: unknown;
  confidence?: unknown;
}

/** The commit a Graphify graph says it was built at, where it says one. */
export function graphifyBuiltAt(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const commit = (parsed as { built_at_commit?: unknown }).built_at_commit;
  return typeof commit === 'string' && commit !== '' ? commit : undefined;
}

/**
 * A Graphify `graph.json` as a `CodeGraph`, keeping only extracted import
 * edges between two files. Undefined where the value is not that shape, so a
 * changed format is no graph rather than a wrong one.
 */
export function graphFromGraphify(parsed: unknown): CodeGraph | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { nodes, links } = parsed as { nodes?: unknown; links?: unknown };
  if (!Array.isArray(nodes) || !Array.isArray(links)) return undefined;

  const fileOf = new Map<string, string>();
  for (const node of nodes as GraphifyNode[]) {
    if (typeof node.id === 'string' && typeof node.source_file === 'string') {
      fileOf.set(node.id, node.source_file);
    }
  }
  const imports: ImportEdge[] = [];
  const seen = new Set<string>();
  for (const link of links as GraphifyLink[]) {
    if (typeof link.relation !== 'string' || !IMPORT_RELATIONS.includes(link.relation))
      continue;
    if (link.confidence !== EXTRACTED) continue;
    if (typeof link.source !== 'string' || typeof link.target !== 'string') continue;
    const from = fileOf.get(link.source);
    const to = fileOf.get(link.target);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\n${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push({ from, to });
  }
  return {
    source: CODE_GRAPH_SOURCE.GRAPHIFY,
    files: [...new Set(fileOf.values())],
    imports,
  };
}

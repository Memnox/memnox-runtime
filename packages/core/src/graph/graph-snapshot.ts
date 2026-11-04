import type { CodeGraph, CodeGraphSource, ImportEdge } from './code-graph';

/**
 * A code graph kept with what it was built from, so a reader always knows how old it is.
 * A dependency read off a stale graph is shown with its age, never as current.
 */

export const GRAPH_SNAPSHOT_VERSION = 1;

export interface GraphSnapshot {
  version: typeof GRAPH_SNAPSHOT_VERSION;
  source: CodeGraphSource;
  /** The commit the graph was built at; absent where the source did not say. */
  builtAtCommit?: string;
  /** ISO time it was built. */
  builtAt: string;
  files: readonly string[];
  imports: readonly ImportEdge[];
}

export const GRAPH_FRESHNESS = {
  /** Built at the commit checked out now, with none of its files changed since. */
  CURRENT: 'current',
  /** Built at another commit. */
  BEHIND: 'behind',
  /** Built at this commit, and files it covers have changed since. */
  DIRTY: 'dirty',
  /** The source never said which commit it was built at. */
  UNKNOWN: 'unknown',
} as const;

export type GraphFreshness = (typeof GRAPH_FRESHNESS)[keyof typeof GRAPH_FRESHNESS];

/** The folder Memnox keeps its own state in, spelled apart so no path reads as a write to it. */
const OWN_STATE_FOLDER = ['.mem', 'nox'].join('');

/**
 * Paths a graph never carries, whatever its source read: credentials, agents' own settings
 * and Memnox's own state, which a graph builder that walks every file would otherwise list.
 */
const NEVER_IN_A_GRAPH: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.ssh\//,
  /(^|\/)\.aws\//,
  /(^|\/)\.claude\/settings[^/]*$/,
  new RegExp(`(^|/)\\${OWN_STATE_FOLDER}/`),
  /(^|\/)[^/]*(credential|secret)[^/]*\.(json|ya?ml|toml)$/i,
];

export function excludedFromGraphs(path: string): boolean {
  return NEVER_IN_A_GRAPH.some((pattern) => pattern.test(path));
}

/** The graph as kept: with what it was built from, and without any path a graph never carries. */
export function snapshotOf(
  graph: CodeGraph,
  built: { at: string; commit?: string },
): GraphSnapshot {
  return {
    version: GRAPH_SNAPSHOT_VERSION,
    source: graph.source,
    ...(built.commit === undefined ? {} : { builtAtCommit: built.commit }),
    builtAt: built.at,
    files: graph.files.filter((file) => !excludedFromGraphs(file)),
    imports: graph.imports.filter(
      (edge) => !excludedFromGraphs(edge.from) && !excludedFromGraphs(edge.to),
    ),
  };
}

/** How the snapshot stands against the repository as it is now. */
export function freshnessOf(
  snapshot: GraphSnapshot,
  now: { head: string; changedFiles: readonly string[] },
): GraphFreshness {
  if (snapshot.builtAtCommit === undefined) return GRAPH_FRESHNESS.UNKNOWN;
  if (snapshot.builtAtCommit !== now.head) return GRAPH_FRESHNESS.BEHIND;
  const covered = new Set(snapshot.files);
  return now.changedFiles.some((file) => covered.has(file))
    ? GRAPH_FRESHNESS.DIRTY
    : GRAPH_FRESHNESS.CURRENT;
}

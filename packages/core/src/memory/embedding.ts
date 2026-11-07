/**
 * Semantic search over memory, kept optional and local: a port any embedding model answers
 * through, cosine ranking, and one fused order with the keyword index. Nothing here reads a
 * network; the adapter does, and only on this machine.
 */

/** Turns text into vectors; one per text, in the order given. Throws when the model cannot answer. */
export interface EmbeddingPort {
  /** Names the vectors, so a different model's are never compared with these. */
  model: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Where a local embedding model answers by default: Ollama on this machine. */
export const DEFAULT_EMBEDDING_URL = 'http://127.0.0.1:11434';

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/** Whether an address is on this machine, the only place a memory's words are ever sent to be embedded. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTS.includes(parsed.hostname)
    );
  } catch {
    // An unparseable address is not this machine, so it is refused rather than guessed at.
    return false;
  }
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    left += x * x;
    right += y * y;
  }
  return left === 0 || right === 0 ? 0 : dot / Math.sqrt(left * right);
}

/** The constant reciprocal rank fusion is usually run with, so neither list's first place swamps the other. */
const FUSION_K = 60;

/** Ids from both rankings in one order, each list counting by place rather than by its own scale. */
export function fuseRankings(
  keyword: readonly string[],
  semantic: readonly string[],
): string[] {
  const score = new Map<string, number>();
  for (const ranking of [keyword, semantic])
    ranking.forEach((id, place) =>
      score.set(id, (score.get(id) ?? 0) + 1 / (FUSION_K + place + 1)),
    );
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

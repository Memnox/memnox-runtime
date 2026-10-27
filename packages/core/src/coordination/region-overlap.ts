import { conflicts } from './lease';
import { sameRepository } from './repository-identity';
import type { LineRange, WrittenRegion } from './written-region';

/**
 * Whether two sessions are writing the same code: the same rule as
 * `memnox-cloud/src/coordination/lease.ts` `overlaps`, so one machine and the workspace
 * agree on what two agents in one file may do side by side.
 */

/** A path, and where known the lines and declarations in it. */
export interface Placed {
  path: string;
  /** Which checkout the path is relative to; paths in two repositories never meet. */
  repository?: string;
  /** What every checkout of one repository shares, which joins two worktrees of it. */
  project?: string;
  lines?: readonly LineRange[];
  symbols?: readonly string[];
}

/**
 * Two checkouts of one project are one repository, as the workspace register already
 * reads them. A record written before `project` was kept falls back to its checkout.
 */
function sameProject(held: Placed, wanted: Placed): boolean {
  if (held.project !== undefined && wanted.project !== undefined) {
    return held.project === wanted.project;
  }
  return sameRepository(held.repository, wanted.repository);
}

/**
 * The path decides first. Inside one file, names win over lines where both sides gave
 * names, because a name survives an insertion above it and a line number does not.
 * Either side saying nothing narrower is the whole file.
 */
export function regionsMeet(held: Placed, wanted: Placed): boolean {
  if (!sameProject(held, wanted)) return false;
  if (!conflicts(held.path, wanted.path)) return false;
  if (held.path !== wanted.path) return true;

  const heldNames = usableSymbols(held.symbols);
  const wantedNames = usableSymbols(wanted.symbols);
  if (heldNames.length > 0 && wantedNames.length > 0) {
    return heldNames.some((left) => wantedNames.some((right) => sameCode(left, right)));
  }

  const a = held.lines ?? [];
  const b = wanted.lines ?? [];
  if (a.length === 0 || b.length === 0) return true;
  return a.some((left) =>
    b.some((right) => left.from <= right.to && right.from <= left.to),
  );
}

/**
 * One declaration, or one inside the other: `PaymentService` meets
 * `PaymentService.retryCharge`, since a change to a class body can break its methods,
 * and a bare `retryCharge` from an older runtime meets its qualified spelling.
 */
export function sameCode(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) return true;
  return tail(a) === tail(b);
}

/**
 * Two regions of one session's work in a file, as one: names only while both still
 * name everything, since a region that cannot be named whole is compared by lines.
 */
export function mergedRegion(
  held: Placed,
  added: WrittenRegion | undefined,
): WrittenRegion {
  if (added === undefined) return { lines: [], symbols: [] };
  const heldLines = held.lines ?? [];
  // Either side whole means the session holds the whole file.
  if (heldLines.length === 0 || added.lines.length === 0)
    return { lines: [], symbols: [] };
  const heldNames = usableSymbols(held.symbols);
  const addedNames = usableSymbols(added.symbols);
  return {
    lines: [...heldLines, ...added.lines],
    symbols:
      heldNames.length > 0 && addedNames.length > 0
        ? [...new Set([...heldNames, ...addedNames])]
        : [],
  };
}

function tail(symbol: string): string {
  const parts = symbol.split('.').filter((each) => each !== '');
  return parts[parts.length - 1] ?? symbol;
}

function usableSymbols(symbols: readonly string[] | undefined): string[] {
  return (symbols ?? []).map((each) => each.trim()).filter((each) => each !== '');
}

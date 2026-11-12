import { conflicts, type Lease } from './lease';

/**
 * A commit that would take another agent's unfinished files with it, which a lease alone never
 * sees. Coordination, never a rule: it asks, and a person who says yes commits both.
 */

export interface OthersWork {
  agent: string;
  sessionId: string;
  /** The staged files that sit inside what the other agent holds. */
  files: string[];
}

/** Files are repository relative, as leases hold them; the newest holder of each is named. */
export function othersInCommit(
  files: readonly string[],
  inForce: readonly Lease[],
  committer: { sessionId: string; repository: string },
): OthersWork[] {
  const bySession = new Map<string, OthersWork>();
  const theirs = inForce.filter(
    (lease) =>
      lease.holder.sessionId !== committer.sessionId &&
      (lease.repository === undefined || lease.repository === committer.repository),
  );
  for (const file of files) {
    const lease = theirs.find((each) => conflicts(each.path, file));
    if (lease === undefined) continue;
    const work = bySession.get(lease.holder.sessionId) ?? {
      agent: lease.holder.agent,
      sessionId: lease.holder.sessionId,
      files: [],
    };
    work.files.push(file);
    bySession.set(lease.holder.sessionId, work);
  }
  return [...bySession.values()];
}

/** Most files a reason names before it counts the rest, so the question stays one screen. */
const FILES_NAMED = 3;

/** The question put to the person, naming whose work and which files. */
export function describeOthersWork(others: readonly OthersWork[]): string {
  const each = others.map((work) => {
    const named = work.files.slice(0, FILES_NAMED).join(', ');
    const more = work.files.length - FILES_NAMED;
    const rest = more > 0 ? ` and ${more} more` : '';
    return `${work.agent} (${work.sessionId}) is still changing ${named}${rest}`;
  });
  return `${each.join('; ')}, which this commit would take with it.`;
}

import { SqliteEventStore } from '../event/sqlite-store';
import { Missions, type Mission } from '../session/mission';
import {
  describeWorkEvidence,
  WORK_EVIDENCE_LIMIT,
  workEvidenceOf,
} from '../session/work-evidence';
import { renderEvidence, type EvidenceLine } from './evidence';
import type { HoldAsked, HoldPrompt, HoldRequest, HoldUnanswered } from './hold';

/**
 * Every held call carries what its session did before it asked, beside why it was held,
 * wherever the question is answered: the terminal, `memnox approve`, the phone. A ledger
 * that will not open leaves the question as it was, since evidence must never stop one.
 */

export type WorkReader = (sessionId: string, now: string) => Promise<readonly string[]>;

export class WorkEvidencePrompt implements HoldPrompt {
  constructor(
    private readonly inner: HoldPrompt,
    private readonly read: WorkReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async ask(
    request: HoldRequest,
    timeoutMs: number,
  ): Promise<HoldAsked | HoldUnanswered | null> {
    return this.inner.ask(await this.withWork(request), timeoutMs);
  }

  private async withWork(request: HoldRequest): Promise<HoldRequest> {
    let work: readonly string[] = [];
    try {
      work = await this.read(request.sessionId, this.now());
    } catch {
      return request;
    }
    if (work.length === 0) return request;
    return { ...request, evidence: [...(request.evidence ?? []), ...renderWork(work)] };
  }
}

/** "tests: npm test passed" read as a source and a detail, so it sits in the same column. */
function renderWork(work: readonly string[]): string[] {
  const lines: EvidenceLine[] = work.map((line) => {
    const at = line.indexOf(': ');
    return at === -1
      ? { source: 'work', detail: line }
      : { source: line.slice(0, at), detail: line.slice(at + 2) };
  });
  return renderEvidence(lines);
}

/** The session's own rows from this machine's ledger, as lines a person reads. */
export function ledgerWork(home: string): WorkReader {
  return async (sessionId, now) => {
    const mission = await new Missions(home).ofSession(sessionId);
    const store = SqliteEventStore.forHome(home);
    try {
      const events = await store.query({ sessionId, limit: WORK_EVIDENCE_LIMIT });
      const work =
        events.length === 0 ? [] : describeWorkEvidence(workEvidenceOf(events), now);
      return [...(mission === null ? [] : [missionLine(mission, sessionId)]), ...work];
    } finally {
      store.close();
    }
  };
}

/** The goal this call is part of, so a yes is given to the work and not only to one command. */
function missionLine(mission: Mission, sessionId: string): string {
  const reference = mission.reference === undefined ? '' : ` (${mission.reference})`;
  const at = mission.sessions.indexOf(sessionId) + 1;
  return `mission: "${mission.statement}"${reference}, session ${at} of ${mission.sessions.length}`;
}

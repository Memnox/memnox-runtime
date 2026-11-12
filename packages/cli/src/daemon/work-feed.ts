import { AgentWorks, DAEMON_EVENT, type AgentWork, type DaemonEvent } from '@memnox/core';

/**
 * Agent work that changed while somebody listened, one WORK event per piece, read off the
 * records. The first look only learns what is there, so a new listener hears news, not a backlog.
 */
export class WorkFeed {
  private readonly seen = new Map<string, string>();
  private primed = false;

  constructor(private readonly home: string) {}

  async look(): Promise<DaemonEvent[]> {
    const works = await new AgentWorks(this.home).all();
    const changed = works.filter((each) => this.seen.get(each.id) !== each.updatedAt);
    for (const each of works) this.seen.set(each.id, each.updatedAt);
    if (!this.primed) {
      this.primed = true;
      return [];
    }
    return changed.map(workEventOf);
  }
}

function workEventOf(work: AgentWork): DaemonEvent {
  const latest = work.progress.at(-1);
  return {
    kind: DAEMON_EVENT.WORK,
    subject: work.id,
    agent: work.profileId,
    summary:
      latest === undefined
        ? `${work.target.externalId} is ${work.status}`
        : `${work.target.externalId}: ${latest.note}`,
    at: work.updatedAt,
    workChanged: work,
  };
}

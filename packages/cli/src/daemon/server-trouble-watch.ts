import {
  agentShown,
  DAEMON_EVENT,
  describeTrouble,
  NOTICE_KIND,
  ServerTroubles,
  shortDigest,
  type DaemonEvent,
} from '@memnox/core';

/** Whoever the proxy could not name still needs somebody on the notice, so it is the machine's own. */
const NO_AGENT = 'memnox';

/**
 * Tells a person once when a server behind the proxy would not connect, with why and the one thing to
 * do, because the agent only ever says disconnected. Each trouble is told once for the daemon's life,
 * so a server that stays broken is not said again every time an agent starts.
 */
export class ServerTroubleWatch {
  private readonly told = new Set<string>();

  constructor(
    private readonly home: string,
    private readonly started: string,
  ) {}

  async look(moment: string): Promise<DaemonEvent[]> {
    const troubles = await new ServerTroubles(this.home).all();
    const events: DaemonEvent[] = [];
    for (const trouble of troubles) {
      // Written before anybody was listening, which the hub card and doctor still show.
      if (trouble.at < this.started) continue;
      const key = `${trouble.agent ?? ''}\u0000${trouble.server}\u0000${trouble.kind}`;
      if (this.told.has(key)) continue;
      this.told.add(key);
      events.push({
        kind: DAEMON_EVENT.NOTICE,
        subject: `ntc_${NOTICE_KIND.SERVER_TROUBLE}_${shortDigest(key)}_${Date.parse(trouble.at).toString(36)}`,
        agent: trouble.agent ?? NO_AGENT,
        notice: NOTICE_KIND.SERVER_TROUBLE,
        summary: describeTrouble(
          trouble,
          trouble.agent === undefined ? undefined : agentShown(trouble.agent),
        ),
        at: moment,
      });
    }
    return events;
  }
}

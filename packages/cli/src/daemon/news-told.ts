import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DAEMON_EVENT, NOTICE_KIND, type DaemonEvent } from '@memnox/core';
import { heardRemotely } from './origin-routing';

/** Where the news the Mac app was already told is kept, so reopening it never says it again. */
const TOLD_FILE = 'voice-news-told.json';

/** Read by nobody but this person, like every other file under the Memnox home. */
const OWNER_ONLY = 0o600;

/** Notices that wait on an answer, which are asked again on every open until somebody answers. */
const ANSWERED_NOTICES: readonly string[] = [NOTICE_KIND.QUESTION, NOTICE_KIND.ASKING];

/** News is said once; a held call or an agent's question waits on the person and is asked again. */
function isNews(event: DaemonEvent): boolean {
  if (event.kind === DAEMON_EVENT.PAUSED) return true;
  return (
    event.kind === DAEMON_EVENT.NOTICE &&
    event.notice !== undefined &&
    !ANSWERED_NOTICES.includes(event.notice)
  );
}

/** A held call or an agent's question, which waits on the person's answer; a proposal is left out, since the Mac declines one nobody there asked for. */
function waitsOnAnswer(event: DaemonEvent): boolean {
  if (event.kind === DAEMON_EVENT.HELD) return true;
  return (
    event.kind === DAEMON_EVENT.NOTICE &&
    event.notice !== undefined &&
    ANSWERED_NOTICES.includes(event.notice)
  );
}

/** Forgets having told the Mac what still waits on an answer, so the next look at the feed sends it to be said. */
export async function askAgain(
  feed: { current(moment: string): Promise<DaemonEvent[]> },
  now: string,
  told: readonly (Set<string> | undefined)[],
): Promise<void> {
  // Unreadable only means nothing is asked again, and the cards on the Mac still show it.
  const waiting = await feed.current(now).catch(() => []);
  for (const event of waiting.filter(waitsOnAnswer))
    told.forEach((each) => each?.delete(event.subject));
}

/**
 * The news subjects the Mac app has already heard, kept on disk because the app is reopened far
 * more often than the daemon restarts, and a paused session said on every open is noise.
 */
export class NewsTold {
  private readonly path: string;

  constructor(home: string) {
    this.path = join(home, TOLD_FILE);
  }

  /** What a new subscriber hears first: a phone what it can answer, the Mac all but news it already heard. */
  async firstHeard(
    events: readonly DaemonEvent[],
    phone: boolean,
  ): Promise<DaemonEvent[]> {
    return phone ? events.filter(heardRemotely) : this.unsaid(events);
  }

  /** What is still worth saying to a Mac that just subscribed, and records the rest as told. */
  private async unsaid(events: readonly DaemonEvent[]): Promise<DaemonEvent[]> {
    const told = await this.read();
    const fresh = events.filter((event) => !isNews(event) || !told.has(event.subject));
    await this.keep(events);
    return fresh;
  }

  /** Records the news now waiting as told, and forgets what is gone so a later pause is said again. */
  async keep(events: readonly DaemonEvent[]): Promise<void> {
    const news = events.filter(isNews).map((event) => event.subject);
    const told = await this.read();
    if (news.length === told.size && news.every((subject) => told.has(subject))) return;
    await mkdir(dirname(this.path), { recursive: true });
    const scratch = `${this.path}.${process.pid}.tmp`;
    await writeFile(scratch, `${JSON.stringify(news)}\n`, { mode: OWNER_ONLY });
    await rename(scratch, this.path);
  }

  private async read(): Promise<Set<string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((each): each is string => typeof each === 'string')
          : [],
      );
    } catch {
      // Missing or torn, which only means something already said may be said once more.
      return new Set();
    }
  }
}

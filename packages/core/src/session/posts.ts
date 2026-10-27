import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { HOUR_MS } from '../domain/time';
import { JsonRecordDir } from '../store/json-records';

/**
 * Something a person away from the machine should hear about that is not a question: an
 * agent struggling, so its reach narrowed. Written by the seam that saw it, read by the feed
 * that wakes a phone, and taken back by the same seam once the agent got past it.
 */

export const POSTS_DIR = 'posts';

/** Long enough to be read on coming back, short enough that a stale one never greets anybody. */
export const POST_HOURS = 12;

export const POST_KIND = {
  /** Failures standing, so changes outside this machine now ask first. */
  STRUGGLING: 'struggling',
  /** Stopped in its own terminal to ask its person something, such as a permission, until they answer there. */
  ASKING: 'asking',
} as const;

export type PostKind = (typeof POST_KIND)[keyof typeof POST_KIND];

export interface SessionPost {
  id: string;
  kind: PostKind;
  sessionId: string;
  agent: string;
  /** The facts in one sentence, said as they are when nothing words them better. */
  summary: string;
  at: string;
  expiresAt: string;
}

export class SessionPosts {
  private readonly records: JsonRecordDir<SessionPost>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, POSTS_DIR));
  }

  /** One per kind and session: a second for the same trouble refreshes the first. */
  static idFor(kind: PostKind, sessionId: string): string {
    return `pst_${kind}_${shortDigest(sessionId)}`;
  }

  async put(
    post: Omit<SessionPost, 'id' | 'expiresAt'>,
    hours: number = POST_HOURS,
  ): Promise<SessionPost> {
    const written: SessionPost = {
      ...post,
      id: SessionPosts.idFor(post.kind, post.sessionId),
      expiresAt: new Date(Date.parse(post.at) + hours * HOUR_MS).toISOString(),
    };
    await this.records.write(written.id, written);
    return written;
  }

  read(kind: PostKind, sessionId: string): Promise<SessionPost | null> {
    return this.records.read(SessionPosts.idFor(kind, sessionId));
  }

  async remove(kind: PostKind, sessionId: string): Promise<void> {
    await this.records.remove(SessionPosts.idFor(kind, sessionId));
  }

  /** Still worth telling, oldest first; a question dated ahead waits, since the agent may run it at once. */
  async open(moment: string): Promise<SessionPost[]> {
    const found = await this.records.all();
    return found
      .filter(
        (post) =>
          post.expiresAt > moment &&
          (post.kind !== POST_KIND.ASKING || post.at <= moment),
      )
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}

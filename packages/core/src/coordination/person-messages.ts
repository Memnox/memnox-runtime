import { basename, join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { minutesToMs } from '../domain/time';
import { JsonRecordDir } from '../store/json-records';

/**
 * A teammate speaking to this person through the workspace, as their stream carries it: a
 * question or a word, by name or because their agent was held off this person's agent's
 * lines. Kept on disk so the voice that said it can answer it, whichever process heard it.
 */

/** What the workspace stream names the event, on the wire. */
export const PERSON_MESSAGE_EVENT = 'person.message';

export const PERSON_MESSAGE_KIND = {
  /** Waits on an answer, so the voice listens once it is said. */
  ASK: 'ask',
  TELL: 'tell',
} as const;

export type PersonMessageKind =
  (typeof PERSON_MESSAGE_KIND)[keyof typeof PERSON_MESSAGE_KIND];

export interface PersonMessage {
  id: string;
  kind: PersonMessageKind;
  said: string;
  fromPersonId: string;
  fromName: string;
  /** The file it is about, where it came out of a hold. */
  about?: { leaseId: string; path: string };
  /** The message of this person's it answers. */
  replyTo?: string;
  sentAt: string;
  /** Set once this person answered, so the voice never answers it twice. */
  answeredAt?: string;
}

/** A message is a conversation of minutes; older than this it is history, not a question. */
const MESSAGE_OPEN_MS = minutesToMs(30);
const MESSAGES_DIR = 'messages';
const KINDS: readonly string[] = Object.values(PERSON_MESSAGE_KIND);

/** A message read off the stream, or null for anything not whole. */
export function personMessageFrom(data: unknown): PersonMessage | null {
  if (data === null || typeof data !== 'object') return null;
  // Checked for an object just above; every field is narrowed before use.
  const given = data as Record<string, unknown>;
  const { id, kind, said, fromPersonId, fromName, sentAt, replyTo } = given;
  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    !KINDS.includes(kind) ||
    typeof said !== 'string' ||
    typeof fromPersonId !== 'string' ||
    typeof fromName !== 'string' ||
    typeof sentAt !== 'string'
  ) {
    return null;
  }
  const about = aboutOf(given['about']);
  return {
    id,
    // Checked against KINDS above, which are the union's own values.
    kind: kind as PersonMessageKind,
    said,
    fromPersonId,
    fromName,
    sentAt,
    ...(about === null ? {} : { about }),
    ...(typeof replyTo === 'string' ? { replyTo } : {}),
  };
}

/** The message as the voice says it, ending on the question where one waits. */
export function describeMessage(message: PersonMessage): string {
  const where =
    message.about === undefined ? '' : ` about ${basename(message.about.path)}`;
  if (message.replyTo !== undefined) {
    return `${message.fromName} answered${where}: "${message.said}".`;
  }
  if (message.kind === PERSON_MESSAGE_KIND.ASK) {
    return `${message.fromName} asks you${where}: "${message.said}". What should I tell them?`;
  }
  return `${message.fromName} says${where}: "${message.said}".`;
}

/** What teammates said to this person, newest last. */
export class PersonMessages {
  private readonly records: JsonRecordDir<PersonMessage>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, MESSAGES_DIR));
  }

  async keep(message: PersonMessage): Promise<void> {
    await this.records.write(message.id, message);
  }

  /** The newest one still worth answering, which is the one the person means by "tell them". */
  async latestOpen(moment: string): Promise<PersonMessage | null> {
    const cutoff = Date.parse(moment) - MESSAGE_OPEN_MS;
    const open = (await this.records.all())
      .filter(
        (each) => each.answeredAt === undefined && Date.parse(each.sentAt) >= cutoff,
      )
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    return open.at(-1) ?? null;
  }

  async answered(message: PersonMessage, at: string): Promise<void> {
    await this.records.write(message.id, { ...message, answeredAt: at });
  }
}

function aboutOf(value: unknown): { leaseId: string; path: string } | null {
  if (value === null || typeof value !== 'object') return null;
  // Checked for an object just above.
  const { leaseId, path } = value as Record<string, unknown>;
  return typeof leaseId === 'string' && typeof path === 'string'
    ? { leaseId, path }
    : null;
}

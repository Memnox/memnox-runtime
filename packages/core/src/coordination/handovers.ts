import { basename, join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { minutesToMs } from '../domain/time';
import { JsonRecordDir } from '../store/json-records';

/**
 * Two people settling who writes a file, by voice: the ask one person's agent raised when
 * it was held off, and the other owner's answer, as the workspace stream carries them. Kept
 * on disk so the voice that hears an ask can answer it, whichever process heard it.
 */

/** How the holder's person answered, the same three words the workspace takes. */
export const HANDOVER_ANSWER = {
  /** The lease goes to the asker's agent, and its next write goes through. */
  GIVE: 'give',
  WAIT: 'wait',
  KEEP: 'keep',
} as const;

export type HandoverAnswer = (typeof HANDOVER_ANSWER)[keyof typeof HANDOVER_ANSWER];

/** What the workspace stream names each event, on the wire. */
export const HANDOVER_EVENT = {
  ASKED: 'handover.asked',
  ANSWERED: 'handover.answered',
} as const;

/** An agent as a lease names it: the product, its session, and the machine it runs on. */
export interface HandoverAgent {
  agent: string;
  session: string;
  machine?: string;
}

/** An ask that reached this person: somebody wants the lines this person's agent holds. */
export interface HandoverAsk {
  id: string;
  leaseId: string;
  path: string;
  symbols?: string[];
  lines?: { from: number; to: number }[];
  heldBy: HandoverAgent;
  fromPersonId: string;
  fromName: string;
  /** The asker's agent, which the lease goes to on a give, quoted back in the answer. */
  requester: HandoverAgent;
  said?: string;
  askedAt: string;
  /** Set once this person answered, so the voice never answers it twice. */
  answeredAt?: string;
}

/** The answer to an ask this person sent. */
export interface HandoverReply {
  leaseId: string;
  path: string;
  answer: HandoverAnswer;
  minutes?: number;
  said?: string;
  byName: string;
  handedLeaseId?: string;
  answeredAt: string;
}

/** An ask is a conversation of minutes; older than this it is history, not a question. */
const ASK_OPEN_MS = minutesToMs(30);

const HANDOVERS_DIR = 'handovers';
const ANSWERS: readonly string[] = Object.values(HANDOVER_ANSWER);

/** An ask read off the stream, or null for anything not whole. */
export function askFrom(data: unknown): HandoverAsk | null {
  const given = objectOf(data);
  if (given === null) return null;
  const heldBy = agentOf(given['heldBy']);
  const requester = agentOf(given['requester']);
  const texts = textsOf(given, [
    'id',
    'leaseId',
    'path',
    'fromPersonId',
    'fromName',
    'askedAt',
  ]);
  if (heldBy === null || requester === null || texts === null) return null;
  const said = given['said'];
  const symbols = stringsOf(given['symbols']);
  const lines = linesOf(given['lines']);
  return {
    id: texts['id'] ?? '',
    leaseId: texts['leaseId'] ?? '',
    path: texts['path'] ?? '',
    heldBy,
    fromPersonId: texts['fromPersonId'] ?? '',
    fromName: texts['fromName'] ?? '',
    requester,
    askedAt: texts['askedAt'] ?? '',
    ...(typeof said === 'string' && said !== '' ? { said } : {}),
    ...(symbols.length === 0 ? {} : { symbols }),
    ...(lines.length === 0 ? {} : { lines }),
  };
}

/** An answer read off the stream, or null for anything not whole. */
export function replyFrom(data: unknown): HandoverReply | null {
  const given = objectOf(data);
  if (given === null) return null;
  const texts = textsOf(given, ['leaseId', 'path', 'answer', 'byName', 'answeredAt']);
  if (texts === null || !ANSWERS.includes(texts['answer'] ?? '')) return null;
  const minutes = given['minutes'];
  const said = given['said'];
  const handed = given['handedLeaseId'];
  return {
    leaseId: texts['leaseId'] ?? '',
    path: texts['path'] ?? '',
    // Checked against ANSWERS just above, which are the union's own values.
    answer: texts['answer'] as HandoverAnswer,
    byName: texts['byName'] ?? '',
    answeredAt: texts['answeredAt'] ?? '',
    ...(typeof minutes === 'number' ? { minutes } : {}),
    ...(typeof said === 'string' && said !== '' ? { said } : {}),
    ...(typeof handed === 'string' ? { handedLeaseId: handed } : {}),
  };
}

/** What in the file is wanted: the functions where known, else the lines, else the file. */
export function wantedPart(ask: Pick<HandoverAsk, 'path' | 'symbols' | 'lines'>): string {
  const file = basename(ask.path);
  if (ask.symbols !== undefined && ask.symbols.length > 0) {
    return `${ask.symbols.join(', ')} in ${file}`;
  }
  const first = ask.lines?.[0];
  if (first !== undefined) return `lines ${first.from} to ${first.to} of ${file}`;
  return file;
}

/** The ask as the holder's voice says it, ending on the question only they can answer. */
export function describeAsk(ask: HandoverAsk): string {
  const words = ask.said === undefined ? '' : ` ${ask.fromName} says: "${ask.said}".`;
  return (
    `${ask.fromName}'s agent is held off ${wantedPart(ask)}, which your ${ask.heldBy.agent} is writing.` +
    `${words} Hand it over, ask them to wait, or keep it?`
  );
}

/** The answer as the asker's voice says it. */
export function describeReply(reply: HandoverReply): string {
  const part = basename(reply.path);
  const words = reply.said === undefined ? '' : ` ${reply.byName} says: "${reply.said}".`;
  if (reply.answer === HANDOVER_ANSWER.GIVE) {
    return `${reply.byName} handed ${part} over. Your agent can write it now.${words}`;
  }
  if (reply.answer === HANDOVER_ANSWER.WAIT) {
    const how =
      reply.minutes === undefined ? 'a little while' : `${reply.minutes} minutes`;
    return `${reply.byName} asks you to wait ${how} for ${part}.${words}`;
  }
  return `${reply.byName} is keeping ${part} for now.${words}`;
}

/** The asks this person received, newest last, answered or not. */
export class Handovers {
  private readonly records: JsonRecordDir<HandoverAsk>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, HANDOVERS_DIR));
  }

  async keep(ask: HandoverAsk): Promise<void> {
    await this.records.write(ask.id, ask);
  }

  /** Still waiting on this person, newest last. */
  async open(moment: string): Promise<HandoverAsk[]> {
    const all = await this.records.all();
    const cutoff = Date.parse(moment) - ASK_OPEN_MS;
    return all
      .filter((ask) => ask.answeredAt === undefined && Date.parse(ask.askedAt) >= cutoff)
      .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  }

  async answered(ask: HandoverAsk, at: string): Promise<void> {
    await this.records.write(ask.id, { ...ask, answeredAt: at });
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function textsOf(
  given: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> | null {
  const found: Record<string, string> = {};
  for (const key of keys) {
    const value = given[key];
    if (typeof value !== 'string' || value === '') return null;
    found[key] = value;
  }
  return found;
}

function agentOf(value: unknown): HandoverAgent | null {
  const given = objectOf(value);
  if (given === null) return null;
  const { agent, session, machine } = given;
  if (typeof agent !== 'string' || typeof session !== 'string') return null;
  return { agent, session, ...(typeof machine === 'string' ? { machine } : {}) };
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === 'string')
    : [];
}

function linesOf(value: unknown): { from: number; to: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) => {
    const span = objectOf(each);
    if (span === null) return [];
    const { from, to } = span;
    return typeof from === 'number' && typeof to === 'number' ? [{ from, to }] : [];
  });
}

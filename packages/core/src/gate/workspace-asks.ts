import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { minutesToMs } from '../domain/time';
import { JsonRecordDir } from '../store/json-records';

/**
 * What the workspace asks of this person beyond a held call: an incident to acknowledge, an
 * exception another admin asked for, and a call short of its approvals. Heard off the stream
 * and said at once, and kept so the voice can act on the one the person means.
 */

/** What the workspace stream names each event, on the wire. */
export const WORKSPACE_ASK_EVENT = {
  INCIDENT_OPENED: 'incident.opened',
  EXCEPTION_PROPOSED: 'exception.proposed',
  HELD_COUNTED: 'held.counted',
} as const;

export const WORKSPACE_ASK = {
  INCIDENT: 'incident',
  EXCEPTION: 'exception',
  /** A held call with a yes that needs more, which is answered on its own card with Touch ID. */
  COUNTED: 'counted',
} as const;

export type WorkspaceAskKind = (typeof WORKSPACE_ASK)[keyof typeof WORKSPACE_ASK];

export interface WorkspaceAsk {
  /** `incident:<id>`, so an incident and an exception never share a record. */
  key: string;
  kind: WorkspaceAskKind;
  /** The workspace's own id, which the route acting on it names. */
  id: string;
  /** What the voice says, whole. */
  said: string;
  at: string;
  /** Set once acted on here, so the voice never acts twice. */
  settledAt?: string;
}

/** Long enough for a person away for lunch; older than this it is the console's to show. */
const ASK_OPEN_MS = minutesToMs(120);
const ASKS_DIR = 'workspace-asks';

/** An event off the stream as an ask, or null for anything this does not know or is not whole. */
export function workspaceAskFrom(
  event: string,
  data: unknown,
  at: string,
): WorkspaceAsk | null {
  const given = objectOf(data);
  if (given === null) return null;
  const id = text(given, 'id');
  if (id === null) return null;
  const said = spoken(event, given);
  const kind = KIND_OF[event];
  if (said === null || kind === undefined) return null;
  return { key: `${kind}:${id}`, kind, id, said, at };
}

const KIND_OF: Readonly<Record<string, WorkspaceAskKind>> = {
  [WORKSPACE_ASK_EVENT.INCIDENT_OPENED]: WORKSPACE_ASK.INCIDENT,
  [WORKSPACE_ASK_EVENT.EXCEPTION_PROPOSED]: WORKSPACE_ASK.EXCEPTION,
  [WORKSPACE_ASK_EVENT.HELD_COUNTED]: WORKSPACE_ASK.COUNTED,
};

function spoken(event: string, given: Record<string, unknown>): string | null {
  if (event === WORKSPACE_ASK_EVENT.INCIDENT_OPENED) {
    const title = text(given, 'title');
    if (title === null) return null;
    const summary = text(given, 'summary') ?? '';
    return `An incident opened: ${title}. ${summary} Say acknowledge it and I will take it for you.`.replace(
      /\s+/g,
      ' ',
    );
  }
  if (event === WORKSPACE_ASK_EVENT.EXCEPTION_PROPOSED) {
    const who = text(given, 'proposedBy') ?? 'Somebody';
    const rule = text(given, 'rule');
    const reason = text(given, 'reason') ?? '';
    const what = rule === null ? 'a workspace rule' : `the rule ${rule}`;
    return `${who} asks for an exception to ${what}: ${reason}. Approving it loosens the rule, so that is done in the console; say no and I will reject it here.`;
  }
  if (event === WORKSPACE_ASK_EVENT.HELD_COUNTED) {
    const agent = text(given, 'agent') ?? 'An agent';
    const operation = text(given, 'operation') ?? 'something';
    const target = text(given, 'target');
    const needed = given['approvalsNeeded'];
    const more = typeof needed === 'number' ? `${needed} more` : 'more';
    const on = target === null ? '' : ` on ${target}`;
    return `${agent} wants to ${operation}${on}. It has a yes and needs ${more}, yours among them, on its card.`;
  }
  return null;
}

/** The asks this person heard, so the voice can act on the newest of a kind. */
export class WorkspaceAsks {
  private readonly records: JsonRecordDir<WorkspaceAsk>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, ASKS_DIR));
  }

  async keep(ask: WorkspaceAsk): Promise<void> {
    await this.records.write(ask.key.replace(/[^\w-]/g, '_'), ask);
  }

  /** The newest open ask of a kind, or null. */
  async newest(kind: WorkspaceAskKind, moment: string): Promise<WorkspaceAsk | null> {
    const cutoff = Date.parse(moment) - ASK_OPEN_MS;
    const open = (await this.records.all())
      .filter(
        (ask) =>
          ask.kind === kind &&
          ask.settledAt === undefined &&
          Date.parse(ask.at) >= cutoff,
      )
      .sort((a, b) => a.at.localeCompare(b.at));
    return open.at(-1) ?? null;
  }

  async settled(ask: WorkspaceAsk, at: string): Promise<void> {
    await this.keep({ ...ask, settledAt: at });
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function text(given: Record<string, unknown>, key: string): string | null {
  const value = given[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

import {
  askFrom,
  DAEMON_EVENT,
  describeAsk,
  describeReply,
  HANDOVER_EVENT,
  Handovers,
  describeMessage,
  describeTogether,
  WORK_TOGETHER_EVENT,
  NOTICE_KIND,
  PERSON_MESSAGE_EVENT,
  PersonMessages,
  personMessageFrom,
  replyFrom,
  workspaceAskFrom,
  WorkspaceAsks,
  type DaemonEvent,
} from '@memnox/core';
import { readPerson, type PersonCredential } from '../sync/person';

/**
 * The person's live stream from their workspace, held open by the daemon rather than the
 * Mac app, so what reaches them is said the moment it lands: an ask for lines their agent
 * holds, the answer to one they sent, and what they approve. Comes in, never out.
 */

/** First retry after a dropped stream, doubling to the longest, so a dead network is not hammered. */
const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 60_000;
/** How often a Mac with nobody signed in looks again, since they may sign in at any moment. */
const SIGNED_OUT_LOOK_MS = 30_000;

const SSE_ACCEPT = 'text/event-stream';
/** Who a notice from the workspace itself is from, since no agent on this machine raised it. */
const WORKSPACE_AGENT = 'workspace';
const FRAME_END = '\n\n';

/** Names the last event heard, so a stream that dropped is first given what it missed. */
const LAST_EVENT_ID = 'last-event-id';

/** One server-sent event, as the stream framed it. */
interface StreamFrame {
  event: string;
  data: string;
  id?: string;
}

interface WorkspaceStreamDeps {
  home: string;
  tell: (event: DaemonEvent) => void;
  now: () => string;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class WorkspaceStream {
  private running = false;
  private controller: AbortController | null = null;
  /** The last event heard, kept across drops, so a blink of the network swallows nothing. */
  private lastId: string | null = null;

  constructor(private readonly deps: WorkspaceStreamDeps) {}

  /** Holds the stream open until stopped, coming back after every drop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  /** One event off the stream, said to the person where it is for them. */
  async heard(frame: StreamFrame): Promise<void> {
    if (frame.id !== undefined) this.lastId = frame.id;
    const data = parsed(frame.data);
    if (frame.event === PERSON_MESSAGE_EVENT) {
      await this.messaged(data);
      return;
    }
    if (frame.event === WORK_TOGETHER_EVENT) {
      await this.together(data, frame.id);
      return;
    }
    if (frame.event === HANDOVER_EVENT.ASKED) {
      const ask = askFrom(data);
      if (ask === null) return;
      await new Handovers(this.deps.home).keep(ask);
      this.deps.tell(
        notice(`ntc_handover_${ask.id}`, ask.heldBy.agent, describeAsk(ask), ask.askedAt),
      );
      return;
    }
    if (frame.event === HANDOVER_EVENT.ANSWERED) {
      const reply = replyFrom(data);
      if (reply === null) return;
      const subject = `ntc_handover_${reply.leaseId}_${reply.answeredAt}`;
      this.deps.tell(
        notice(subject, reply.byName, describeReply(reply), reply.answeredAt),
      );
      return;
    }
    await this.askedOf(frame.event, data);
  }

  /** This person's agent and a teammate's found on one feature, shown and said only to somebody listening. */
  private async together(data: unknown, id: string | undefined): Promise<void> {
    const person = await readPerson(this.deps.home).catch(() => null);
    const summary = person === null ? null : describeTogether(data, person.personId);
    if (summary === null) return;
    const at = this.deps.now();
    this.deps.tell({
      kind: DAEMON_EVENT.NOTICE,
      notice: NOTICE_KIND.TOGETHER,
      subject: `ntc_together_${id ?? at}`,
      agent: WORKSPACE_AGENT,
      summary,
      at,
    });
  }

  /** A teammate speaking to this person, said at once and listened after, like a collision. */
  private async messaged(data: unknown): Promise<void> {
    const message = personMessageFrom(data);
    if (message === null) return;
    await new PersonMessages(this.deps.home).keep(message);
    this.deps.tell({
      kind: DAEMON_EVENT.NOTICE,
      notice: NOTICE_KIND.MESSAGE,
      subject: `ntc_message_${message.id}`,
      agent: WORKSPACE_AGENT,
      agentName: message.fromName,
      summary: describeMessage(message),
      at: message.sentAt,
    });
  }

  /** An incident, an exception or a call short of its approvals, said whatever the speak up setting. */
  private async askedOf(event: string, data: unknown): Promise<void> {
    const ask = workspaceAskFrom(event, data, this.deps.now());
    if (ask === null) return;
    await new WorkspaceAsks(this.deps.home).keep(ask);
    this.deps.tell({
      kind: DAEMON_EVENT.NOTICE,
      notice: NOTICE_KIND.WATCHED,
      subject: `ntc_${ask.key}`,
      agent: WORKSPACE_AGENT,
      summary: ask.said,
      at: ask.at,
    });
  }

  private async loop(): Promise<void> {
    let retry = FIRST_RETRY_MS;
    while (this.running) {
      const person = await readPerson(this.deps.home).catch(() => null);
      if (person === null) {
        await this.wait(SIGNED_OUT_LOOK_MS);
        continue;
      }
      const opened = await this.follow(person);
      // A stream that opened and later dropped was healthy, so the next try is quick again.
      retry = opened ? FIRST_RETRY_MS : Math.min(retry * 2, LONGEST_RETRY_MS);
      if (this.running) await this.wait(retry);
    }
  }

  /** True when the stream opened, whatever ended it afterwards. */
  private async follow(person: PersonCredential): Promise<boolean> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await (this.deps.fetcher ?? fetch)(
        new URL(
          `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/stream`,
          person.baseUrl,
        ),
        {
          headers: {
            accept: SSE_ACCEPT,
            authorization: `Bearer ${person.token}`,
            ...(this.lastId === null ? {} : { [LAST_EVENT_ID]: this.lastId }),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok || response.body === null) return false;
      await this.read(response.body);
      return true;
    } catch {
      // Dropped, refused or stopped: the loop decides whether to come back.
      return false;
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      const { frames, rest } = framesIn(buffer);
      buffer = rest;
      for (const frame of frames) await this.heard(frame).catch(() => undefined);
    }
  }

  private wait(ms: number): Promise<void> {
    const sleep =
      this.deps.sleep ??
      ((delay: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, delay).unref()));
    return sleep(ms);
  }
}

/** Whole frames off the front of what arrived, and the part still coming. Comments are dropped. */
export function framesIn(buffer: string): { frames: StreamFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split(FRAME_END);
  const rest = parts.pop() ?? '';
  const frames = parts.flatMap((part) => {
    let event = '';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('id:')) id = line.slice('id:'.length).trim();
      else if (line.startsWith('data:'))
        data.push(line.slice('data:'.length).trimStart());
    }
    if (event === '') return [];
    return [{ event, data: data.join('\n'), ...(id === undefined ? {} : { id }) }];
  });
  return { frames, rest };
}

/** A collision the person sorts out, which the Mac app says at once and listens after. */
function notice(
  subject: string,
  agent: string,
  summary: string,
  at: string,
): DaemonEvent {
  return {
    kind: DAEMON_EVENT.NOTICE,
    notice: NOTICE_KIND.COLLISION,
    subject,
    agent,
    agentName: agent,
    summary,
    at,
  };
}

function parsed(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

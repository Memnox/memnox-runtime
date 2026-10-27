import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMNOX_HOME,
  PERSON_MESSAGE_KIND,
  PersonMessages,
  writeJsonFile,
  type DaemonEvent,
  type PersonMessage,
} from '@memnox/core';
import { framesIn, WorkspaceStream } from '../src/daemon/workspace-stream';
import type { PersonCredential } from '../src/sync/person';
import { answerPerson, sendToPerson } from '../src/sync/person-message';
import type { CloudSend } from '../src/sync/person-post';

/* Moise says "ask Ana whether she's done with billing". Ana's voice says it on her Mac the
   moment it lands, she answers out loud, and Moise hears her answer. A stream that blinks
   in between asks for what it missed. */

const PERSON: PersonCredential = {
  baseUrl: 'https://cloud.example',
  token: 'tok_person',
  personId: 'usr_ana',
  name: 'Ana',
  workspaceId: 'ws_1',
  deviceId: 'pdv_1',
  privateKey: '',
};

const ASKED: PersonMessage = {
  id: 'msg_1',
  kind: PERSON_MESSAGE_KIND.ASK,
  said: 'are you done with billing?',
  fromPersonId: 'usr_moise',
  fromName: 'Moise',
  about: { leaseId: 'lse_1', path: 'src/billing/invoice.ts' },
  sentAt: '2026-10-23T10:00:00.000Z',
};

async function signedIn(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-messages-'));
  await writeJsonFile(join(home, MEMNOX_HOME, 'person.json'), PERSON);
  return home;
}

function recordingCloud(): { send: CloudSend; sent: { path: string; body: unknown }[] } {
  const sent: { path: string; body: unknown }[] = [];
  const send = (async (request: { path: string; body?: unknown }) => {
    sent.push({ path: request.path, body: request.body });
    return { status: 201, body: {} };
  }) as unknown as CloudSend;
  return { send, sent };
}

/** A stream that hands over these frames once and ends, recording what each open asked. */
function streaming(frames: string[]): {
  fetcher: typeof fetch;
  opened: Record<string, string>[];
} {
  const opened: Record<string, string>[] = [];
  const fetcher = (async (_url: URL, init: { headers: Record<string, string> }) => {
    opened.push(init.headers);
    const frame = frames.shift() ?? '';
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame));
          controller.close();
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetcher, opened };
}

async function until(done: () => boolean): Promise<void> {
  const started = Date.now();
  while (!done() && Date.now() - started < 1_000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a teammate speaking to this person', () => {
  it('is said at once as a message, and kept so the answer goes back to them', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const { fetcher } = streaming([
      `id: evt_7\nevent: person.message\ndata: ${JSON.stringify(ASKED)}\n\n`,
    ]);
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => ASKED.sentAt,
      fetcher,
      sleep: async () => undefined,
    });
    stream.start();
    await until(() => told.length > 0);
    stream.stop();

    expect(told[0]).toMatchObject({
      kind: 'notice',
      notice: 'message',
      agentName: 'Moise',
    });
    expect(told[0]?.summary).toBe(
      'Moise asks you about invoice.ts: "are you done with billing?". What should I tell them?',
    );
    const open = await new PersonMessages(home).latestOpen('2026-10-23T10:05:00.000Z');
    expect(open?.id).toBe('msg_1');
  });

  it('names the last event heard when it comes back, so nothing said in a blink is lost', async () => {
    const home = await signedIn();
    const { fetcher, opened } = streaming([
      `id: evt_7\nevent: person.message\ndata: ${JSON.stringify(ASKED)}\n\n`,
      '',
    ]);
    const stream = new WorkspaceStream({
      home,
      tell: () => undefined,
      now: () => ASKED.sentAt,
      fetcher,
      sleep: async () => undefined,
    });
    stream.start();
    await until(() => opened.length >= 2);
    stream.stop();

    expect(opened[0]?.['last-event-id']).toBeUndefined();
    expect(opened[1]?.['last-event-id']).toBe('evt_7');
  });

  it('shows that their agent and a teammate\u2019s were found on one feature', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const together = {
      featureName: 'ENG-40',
      members: [
        { agent: 'claude-code', ownerPersonId: 'usr_ana', ownerName: 'Ana' },
        { agent: 'codex', ownerPersonId: 'usr_andre', ownerName: 'Andre' },
      ],
    };
    const { fetcher } = streaming([
      `id: evt_9\nevent: work.together\ndata: ${JSON.stringify(together)}\n\n`,
    ]);
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => ASKED.sentAt,
      fetcher,
      sleep: async () => undefined,
    });
    stream.start();
    await until(() => told.length > 0);
    stream.stop();
    expect(told[0]).toMatchObject({ notice: 'together', subject: 'ntc_together_evt_9' });
    expect(told[0]?.summary).toContain("Andre's codex");
  });

  it('reads the id a frame carries', () => {
    expect(framesIn('id: evt_1\nevent: x\ndata: {}\n\n').frames).toEqual([
      { event: 'x', data: '{}', id: 'evt_1' },
    ]);
  });
});

describe('speaking to a teammate in the person’s own name', () => {
  it('sends to a name, or to whoever holds the lines', async () => {
    const home = await signedIn();
    const cloud = recordingCloud();
    await sendToPerson(
      home,
      { person: 'Ana' },
      { kind: PERSON_MESSAGE_KIND.ASK, said: 'done with billing?' },
      cloud.send,
    );
    await sendToPerson(
      home,
      { leaseId: 'lse_1' },
      { kind: PERSON_MESSAGE_KIND.TELL, said: 'only need retryCharge' },
      cloud.send,
    );
    expect(cloud.sent).toEqual([
      {
        path: '/v1/workspaces/ws_1/me/messages',
        body: { to: 'Ana', kind: 'ask', said: 'done with billing?' },
      },
      {
        path: '/v1/workspaces/ws_1/me/messages',
        body: { leaseId: 'lse_1', kind: 'tell', said: 'only need retryCharge' },
      },
    ]);
  });

  it('answers back to whoever asked, as the answer to their message', async () => {
    const home = await signedIn();
    const cloud = recordingCloud();
    await answerPerson(home, ASKED, 'five more minutes', cloud.send);
    expect(cloud.sent[0]?.body).toEqual({
      to: 'usr_moise',
      kind: 'tell',
      said: 'five more minutes',
      replyTo: 'msg_1',
    });
  });
});

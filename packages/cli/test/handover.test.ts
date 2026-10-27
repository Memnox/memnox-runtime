import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Handovers,
  HANDOVER_ANSWER,
  WORKSPACE_ASK,
  WorkspaceAsks,
  MEMNOX_HOME,
  writeJsonFile,
  type Clash,
  type DaemonEvent,
  type HandoverAsk,
} from '@memnox/core';
import { answerAsk, askForLines } from '../src/sync/handover';
import type { CloudSend } from '../src/sync/person-post';
import { acknowledgeIncident, rejectException } from '../src/sync/workspace-asks';
import type { PersonCredential } from '../src/sync/person';
import { framesIn, WorkspaceStream } from '../src/daemon/workspace-stream';

/* Two machines in one workspace and one file. Moise's agent is held off retryCharge, which
   Ana's agent is writing. Moise asks by voice, Ana's voice says it the moment it lands, she
   answers by voice, and Moise's voice says the answer. */

const UNDER_A_SECOND_MS = 1_000;

const PERSON: PersonCredential = {
  baseUrl: 'https://cloud.example',
  token: 'tok_person',
  personId: 'usr_moise',
  name: 'Moise',
  workspaceId: 'ws_1',
  deviceId: 'pdv_1',
  privateKey: '',
};

const CLASH: Clash = {
  id: 'clh_1',
  at: '2026-10-23T10:00:00.000Z',
  sessionId: 'ses_m',
  agent: 'claude-code',
  what: 'src/billing/invoice.ts',
  said: 'Claude Code on ana-mbp is editing retryCharge of src/billing/invoice.ts.',
  leaseId: 'lse_1',
};

const ASK: HandoverAsk = {
  id: 'hnd_1',
  leaseId: 'lse_1',
  path: 'src/billing/invoice.ts',
  symbols: ['retryCharge'],
  heldBy: { agent: 'claude-code', session: 'ses_a', machine: 'mch_ana' },
  fromPersonId: 'usr_moise',
  fromName: 'Moise',
  requester: { agent: 'claude-code', session: 'ses_m', machine: 'mch_m' },
  said: 'can I have it in ten minutes',
  askedAt: '2026-10-23T10:00:01.000Z',
};

async function signedIn(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-handover-'));
  await writeJsonFile(join(home, MEMNOX_HOME, 'person.json'), PERSON);
  await writeJsonFile(join(home, MEMNOX_HOME, 'account.json'), {
    version: 1,
    baseUrl: PERSON.baseUrl,
    workspaceId: 'ws_1',
    machineId: 'mch_m',
    token: 'tok_machine',
    privateKey: '',
    enrolledAt: '2026-10-01T00:00:00.000Z',
  });
  return home;
}

function recordingCloud(status = 201): {
  send: CloudSend;
  sent: { path: string; body: unknown; token?: string }[];
} {
  const sent: { path: string; body: unknown; token?: string }[] = [];
  const send = (async (request: { path: string; body?: unknown; token?: string }) => {
    sent.push({
      path: request.path,
      body: request.body,
      ...(request.token === undefined ? {} : { token: request.token }),
    });
    return {
      status,
      body: status >= 400 ? { message: 'Those lines are free now.' } : {},
    };
  }) as unknown as CloudSend;
  return { send, sent };
}

describe('asking another owner for the lines their agent holds', () => {
  it('asks in the person’s own name for their held agent, on this machine', async () => {
    const home = await signedIn();
    const cloud = recordingCloud();
    const result = await askForLines(home, CLASH, 'can I have it', cloud.send);
    expect(result.ok).toBe(true);
    expect(cloud.sent).toEqual([
      {
        path: '/v1/workspaces/ws_1/me/handovers',
        token: 'tok_person',
        body: {
          leaseId: 'lse_1',
          requester: { agent: 'claude-code', session: 'ses_m', machine: 'mch_m' },
          said: 'can I have it',
        },
      },
    ]);
  });

  it('asks nobody about a hold on this machine, since the other agent is theirs', async () => {
    const home = await signedIn();
    const cloud = recordingCloud();
    const { leaseId: _local, ...local } = CLASH;
    const result = await askForLines(home, local, undefined, cloud.send);
    expect(result.ok).toBe(false);
    expect(cloud.sent).toEqual([]);
  });

  it('says what the workspace said when it refused', async () => {
    const home = await signedIn();
    const result = await askForLines(home, CLASH, undefined, recordingCloud(409).send);
    expect(result).toEqual({ ok: false, said: 'Those lines are free now.' });
  });
});

describe('answering an ask', () => {
  it('quotes the ask back so the lines go to the asker’s agent', async () => {
    const home = await signedIn();
    const cloud = recordingCloud(200);
    await answerAsk(
      home,
      ASK,
      { answer: HANDOVER_ANSWER.WAIT, minutes: 10, said: 'nearly done' },
      cloud.send,
    );
    expect(cloud.sent[0]).toMatchObject({
      path: '/v1/workspaces/ws_1/me/handovers/answer',
      body: {
        leaseId: 'lse_1',
        toPersonId: 'usr_moise',
        requester: ASK.requester,
        answer: 'wait',
        minutes: 10,
        said: 'nearly done',
      },
    });
  });
});

describe('the workspace stream the daemon holds open', () => {
  it('frames events across chunk boundaries and drops comments', () => {
    const first = framesIn(': connected\n\nevent: handover.asked\ndata: {"a"');
    expect(first.frames).toEqual([]);
    const second = framesIn(`${first.rest}:1}\n\nevent: x`);
    expect(second.frames).toEqual([{ event: 'handover.asked', data: '{"a":1}' }]);
    expect(second.rest).toBe('event: x');
  });

  it('says an ask to the holder as a collision within a second, and keeps it to answer', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const frame = `event: handover.asked\ndata: ${JSON.stringify(ASK)}\n\n`;
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => new Date().toISOString(),
      fetcher,
    });
    const started = Date.now();
    stream.start();
    while (told.length === 0 && Date.now() - started < UNDER_A_SECOND_MS) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    stream.stop();

    expect(Date.now() - started).toBeLessThan(UNDER_A_SECOND_MS);
    expect(told[0]).toMatchObject({ kind: 'notice', notice: 'collision' });
    expect(told[0]?.summary).toContain('Moise');
    expect(told[0]?.summary).toContain('retryCharge in invoice.ts');
    expect(told[0]?.summary).toContain('can I have it in ten minutes');
    const open = await new Handovers(home).open('2026-10-23T10:05:00.000Z');
    expect(open.map((ask) => ask.id)).toEqual(['hnd_1']);
  });

  it('says the answer to the asker', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => '',
    });
    await stream.heard({
      event: 'handover.answered',
      data: JSON.stringify({
        leaseId: 'lse_1',
        path: 'src/billing/invoice.ts',
        answer: 'give',
        byName: 'Ana',
        byPersonId: 'usr_ana',
        handedLeaseId: 'lse_2',
        answeredAt: '2026-10-23T10:00:05.000Z',
      }),
    });
    expect(told[0]?.summary).toBe(
      'Ana handed invoice.ts over. Your agent can write it now.',
    );
  });
});

describe('what the workspace asks of this person, said as it lands', () => {
  it('says an incident whatever the speak up setting, and keeps it to take', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => '2026-10-23T10:00:00.000Z',
    });
    await stream.heard({
      event: 'incident.opened',
      data: JSON.stringify({
        id: 'inc_1',
        title: 'Codex is retrying a failing deploy',
        summary: 'Twelve refusals in five minutes.',
      }),
    });
    expect(told[0]).toMatchObject({ kind: 'notice', notice: 'watched' });
    expect(told[0]?.summary).toContain('Codex is retrying a failing deploy');
    const kept = await new WorkspaceAsks(home).newest(
      WORKSPACE_ASK.INCIDENT,
      '2026-10-23T10:01:00.000Z',
    );
    expect(kept?.id).toBe('inc_1');
  });

  it('says an exception as the console’s to approve and this voice’s to refuse', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => '',
    });
    await stream.heard({
      event: 'exception.proposed',
      data: JSON.stringify({
        id: 'exc_1',
        rule: 'no-friday-deploys',
        reason: 'hotfix for the outage',
        proposedBy: 'Ana',
      }),
    });
    expect(told[0]?.summary).toContain(
      'Ana asks for an exception to the rule no-friday-deploys',
    );
    expect(told[0]?.summary).toContain('done in the console');
  });

  it('says a call short of its approvals with how many more it needs', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => '',
    });
    await stream.heard({
      event: 'held.counted',
      data: JSON.stringify({
        id: 'apr_1',
        agent: 'claude-code',
        operation: 'git.push',
        target: 'main',
        approvalsNeeded: 2,
      }),
    });
    expect(told[0]?.summary).toBe(
      'claude-code wants to git.push on main. It has a yes and needs 2 more, yours among them, on its card.',
    );
  });

  it('ignores what it does not know, so a newer workspace never says nonsense', async () => {
    const home = await signedIn();
    const told: DaemonEvent[] = [];
    const stream = new WorkspaceStream({
      home,
      tell: (event) => told.push(event),
      now: () => '',
    });
    await stream.heard({ event: 'something.new', data: '{"id":"x"}' });
    expect(told).toEqual([]);
  });

  it('takes an incident and refuses an exception through the person’s own routes', async () => {
    const home = await signedIn();
    const cloud = recordingCloud(200);
    await acknowledgeIncident(home, 'inc_1', cloud.send);
    await rejectException(home, 'exc_1', cloud.send);
    expect(cloud.sent.map((each) => each.path)).toEqual([
      '/v1/workspaces/ws_1/incidents/inc_1/acknowledge',
      '/v1/workspaces/ws_1/policies/exceptions/exc_1/reject',
    ]);
    expect(cloud.sent.every((each) => each.token === 'tok_person')).toBe(true);
  });
});

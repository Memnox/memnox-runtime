import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentQuestions,
  DEVICE_KIND,
  decodeRequest,
  PHONE_DEFAULT_CAPABILITIES,
  REMOTE_CAPABILITY,
  type DaemonRequest,
  type DeviceRecord,
} from '@memnox/core';
import type { ConfirmResult, RemotePrincipal } from '../src/daemon/confirm';
import { answerWaiting } from '../src/daemon/confirm-question';
import { WaitingFeed } from '../src/daemon/waiting-feed';

/**
 * An agent's own picker answered with a tap on the notch or the phone: the question reaches
 * them with its choices, and a pick goes back in the picker's place without a signature.
 */

const NOW = new Date();

async function asked(): Promise<{ home: string; id: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-tapped-question-'));
  const question = await new AgentQuestions(home).ask({
    sessionId: 'ses_1',
    agent: 'claude-code',
    toolUseId: 'toolu_1',
    questions: [
      {
        question: 'What should the island look like?',
        header: 'Island',
        options: [{ label: 'Mark in the island', description: 'a mark and a count' }],
        multiSelect: false,
      },
      {
        question: 'Should it notify?',
        options: [{ label: 'Yes' }, { label: 'No' }],
        multiSelect: false,
      },
    ],
    at: NOW.toISOString(),
  });
  return { home, id: question.id };
}

function pick(
  home: string,
  subject: string,
  answer: string,
  more: Partial<DaemonRequest> = {},
  principal?: RemotePrincipal,
): Promise<ConfirmResult> {
  const request: DaemonRequest = { id: 1, method: 'confirm', subject, answer, ...more };
  return answerWaiting(home, request, NOW.toISOString(), principal);
}

function phone(capabilities: readonly string[]): DeviceRecord {
  return {
    id: 'dev_phone',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint: 'unused',
    noiseStatic: Buffer.alloc(32, 5).toString('base64'),
    capabilities: [...capabilities] as DeviceRecord['capabilities'], // the test picks what the phone holds
    pairedAt: NOW.toISOString(),
  };
}

describe('an agent question answered with a tap', () => {
  it('reaches every surface with its choices, so they can be offered as taps', async () => {
    const { home, id } = await asked();
    const [event] = await new WaitingFeed(home).current(NOW.toISOString());
    expect(event?.subject).toBe(id);
    expect(event?.questions?.[0]?.options[0]).toEqual({
      label: 'Mark in the island',
      description: 'a mark and a count',
    });
    expect(event?.questions?.[1]?.question).toBe('Should it notify?');
  });

  it('takes each pick by its number and stops waiting once every question has one', async () => {
    const { home, id } = await asked();
    const at = NOW.toISOString();
    const first = await pick(home, id, 'mark in the island');
    expect(first).toEqual({ ok: true, outcome: 'answered' });
    const [partly] = await new WaitingFeed(home).current(at);
    expect(partly?.answers).toEqual({
      'What should the island look like?': 'Mark in the island',
    });
    await pick(home, id, 'No', { questionNumber: 2 });
    expect(await new WaitingFeed(home).current(at)).toEqual([]);
    expect((await new AgentQuestions(home).read(id))?.answers).toEqual({
      'What should the island look like?': 'Mark in the island',
      'Should it notify?': 'No',
    });
  });

  it('takes a pick from a phone allowed to answer, with no signature', async () => {
    const { home, id } = await asked();
    const said = await pick(
      home,
      id,
      'Mark in the island',
      {},
      {
        device: phone(PHONE_DEFAULT_CAPABILITIES),
        driving: false,
      },
    );
    expect(said.ok).toBe(true);
  });

  it('refuses a phone that may not answer, and leaves the question waiting', async () => {
    const { home, id } = await asked();
    const said = await pick(
      home,
      id,
      'Mark in the island',
      {},
      {
        device: phone([REMOTE_CAPABILITY.SEE]),
        driving: false,
      },
    );
    expect(said).toMatchObject({ ok: false, refused: true });
    expect((await new AgentQuestions(home).read(id))?.answers).toBeUndefined();
  });

  it('says so when the question is gone, rather than answering nothing', async () => {
    const { home, id } = await asked();
    await new AgentQuestions(home).close(id);
    const said = await pick(home, id, 'Yes');
    expect(said.ok).toBe(false);
  });

  it('reads which question a confirm is for off the socket, and refuses it as text', () => {
    expect(
      decodeRequest(
        '{"id":1,"method":"confirm","subject":"aqn_1","answer":"Yes","questionNumber":2}',
      )?.questionNumber,
    ).toBe(2);
    expect(
      decodeRequest(
        '{"id":1,"method":"confirm","subject":"aqn_1","answer":"Yes","questionNumber":"2"}',
      ),
    ).toBeNull();
  });
});

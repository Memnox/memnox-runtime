import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { DISPLAY, DisplayRequests } from '@memnox/core';
import { awaitDelivery } from '../src/session-tools/instruct-tools';

async function waiting(): Promise<{
  home: string;
  id: string;
  requests: DisplayRequests;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-delivery-'));
  const requests = new DisplayRequests(home);
  const request = await requests.request({
    display: DISPLAY.TYPE,
    sessionId: 'ses_1',
    agent: 'claude-code',
    title: 'Instruction',
    text: 'commit the changes',
    tty: '/dev/ttys002',
    at: new Date().toISOString(),
  });
  return { home, id: request.id, requests };
}

describe('waiting on the Mac to say how typing went', () => {
  it('waits past an older editor extension saying no terminal holds it, for the Mac that typed it in the panel', async () => {
    const { home, id, requests } = await waiting();
    await requests.deliver(id, {
      outcome: 'failed',
      at: new Date().toISOString(),
      reason: 'no integrated terminal holds its device',
    });
    const told = awaitDelivery(home, id, 3_000);
    await sleep(500);
    await requests.deliver(id, {
      outcome: 'typed',
      at: new Date(Date.now() + 1).toISOString(),
    });
    expect((await told)?.outcome).toBe('typed');
  });

  it('takes any other failure as the answer at once', async () => {
    const { home, id, requests } = await waiting();
    await requests.deliver(id, {
      outcome: 'failed',
      at: new Date().toISOString(),
      reason: 'no agent is in front in its terminal',
    });
    expect((await awaitDelivery(home, id, 3_000))?.reason).toBe(
      'no agent is in front in its terminal',
    );
  });
});

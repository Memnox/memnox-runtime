import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AGENT_FROZEN_REASON,
  DECISION_EFFECT,
  MEMNOX_HOME,
  orgPolicyPathFor,
  pauseAgentHere,
  resumeAgentHere,
  type Policy,
} from '@memnox/core';

import { LocalGateAuthorizer } from '../src/call-authorizer';
import { LiveGate } from '../src/live-gate';
import { readToolCall } from '../src/tool-call';

const NO_DELETION: Policy = {
  name: 'no-customer-deletion',
  match: { actions: ['mcp.delete_customer'] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'not ours to delete' },
};

const DELETE = readToolCall({ name: 'delete_customer', arguments: { id: 'cus_1' } });

/** A machine logged in to a workspace: the bundle registered, as `memnox sync` leaves it. */
async function machine(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-live-'));
  await mkdir(join(home, MEMNOX_HOME), { recursive: true });
  await writeFile(
    join(home, MEMNOX_HOME, 'policies.json'),
    JSON.stringify({ files: [orgPolicyPathFor(home)] }),
    'utf8',
  );
  return home;
}

/** Written the way the pull writes it, beside and then renamed over, so no read is torn. */
async function pullBundle(home: string, policies: Policy[]): Promise<void> {
  const path = orgPolicyPathFor(home);
  await writeFile(`${path}.incoming`, JSON.stringify({ version: 1, policies }), 'utf8');
  await rename(`${path}.incoming`, path);
}

function proxyFor(home: string, wrappedFor = 'claude-code'): LocalGateAuthorizer {
  return new LocalGateAuthorizer(
    new LiveGate({ environment: { wrappedFor }, serverName: 'stripe', home }),
    'stripe',
  );
}

describe('a proxy that started before the rules changed', () => {
  it('refuses the very next call once a person pauses the agent it serves, and lets the next one through after resume', async () => {
    const home = await machine();
    const proxy = proxyFor(home);
    expect((await proxy.authorize(DELETE)).effect).toBe(DECISION_EFFECT.ALLOW);

    await pauseAgentHere(home, { kind: 'claude-code', now: new Date().toISOString() });
    const paused = await proxy.authorize(DELETE);
    expect(paused.effect).toBe(DECISION_EFFECT.DENY);
    expect(paused.reason).toBe(AGENT_FROZEN_REASON);

    await resumeAgentHere(home, 'claude-code', new Date().toISOString());
    expect((await proxy.authorize(DELETE)).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('leaves a server wrapped for another agent alone', async () => {
    const home = await machine();
    await pauseAgentHere(home, { kind: 'claude-code', now: new Date().toISOString() });

    expect((await proxyFor(home, 'cursor').authorize(DELETE)).effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('rules by a bundle pulled after it started, on the very next call', async () => {
    const home = await machine();
    const proxy = proxyFor(home);
    await pullBundle(home, []);
    expect((await proxy.authorize(DELETE)).effect).toBe(DECISION_EFFECT.ALLOW);

    await pullBundle(home, [NO_DELETION]);
    const refused = await proxy.authorize(DELETE);
    expect(refused.effect).toBe(DECISION_EFFECT.DENY);
    expect(refused.reason).toContain('not ours to delete');

    await pullBundle(home, []);
    expect((await proxy.authorize(DELETE)).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('decides a call in well under a second when nothing changed', async () => {
    const home = await machine();
    await pullBundle(home, [NO_DELETION]);
    const proxy = proxyFor(home);
    await proxy.authorize(DELETE);

    const started = performance.now();
    for (let i = 0; i < 50; i += 1) await proxy.authorize(DELETE);
    expect((performance.now() - started) / 50).toBeLessThan(50);
  });
});

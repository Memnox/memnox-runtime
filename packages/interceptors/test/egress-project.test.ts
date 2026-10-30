import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECISION_EFFECT, LocalGate, SessionHosts } from '@memnox/core';
import { describe, expect, it } from 'vitest';
import { egressPlaces } from '../src/egress-place';
import { EgressSeam } from '../src/egress-seam';
import { HookAuthorizer } from '../src/hook-authorizer';

const PROJECT = 'billing';
const REPO = '/work/billing';

/** A paste host refused only inside one project, so the project's rule is what decides. */
function projectGate(): LocalGate {
  return new LocalGate(
    [
      {
        name: 'billing-no-paste',
        project: PROJECT,
        match: { actions: ['http.request'], targets: ['*pastebin.com*'] },
        decision: { effect: DECISION_EFFECT.DENY, reason: 'not from billing' },
      },
    ],
    { agentName: 'claude-code' },
  );
}

async function homeWithSession(sessionId: string, cwd: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-egress-project-'));
  await new SessionHosts(home).note({
    sessionId,
    agent: 'claude-code',
    cwd,
    pid: 1,
    seenAt: '2026-10-30T00:00:00.000Z',
  });
  return home;
}

describe('a project rule on the egress seam', () => {
  it('decides a request from a session working in that project', async () => {
    const home = await homeWithSession('s-billing', REPO);
    const seam = new EgressSeam({
      authorizer: new HookAuthorizer({ gate: projectGate() }),
      placeOf: egressPlaces(home, async (cwd) => (cwd === REPO ? PROJECT : undefined)),
    });

    const outcome = await seam.gateRequest(
      { method: 'POST', url: 'https://pastebin.com/x' },
      { sessionId: 's-billing' },
    );
    expect(outcome.allowed).toBe(false);
  });

  it('leaves the machine rules alone for a session it cannot place', async () => {
    const home = await homeWithSession('s-billing', REPO);
    const seam = new EgressSeam({
      authorizer: new HookAuthorizer({ gate: projectGate() }),
      placeOf: egressPlaces(home, async () => {
        throw new Error('git is gone');
      }),
    });

    const unknown = await seam.gateRequest(
      { method: 'POST', url: 'https://pastebin.com/x' },
      { sessionId: 's-nobody' },
    );
    const failed = await seam.gateConnect('pastebin.com:443', { sessionId: 's-billing' });
    expect(unknown.allowed).toBe(true);
    expect(failed.allowed).toBe(true);
  });

  it('places a fixed session even when the client names none', async () => {
    const home = await homeWithSession('s-own', REPO);
    const places = egressPlaces(home, async () => PROJECT);

    expect(await places({ sessionId: 's-own' })).toEqual({
      workingDirectory: REPO,
      projectId: PROJECT,
    });
    expect(await places({})).toEqual({});
  });
});

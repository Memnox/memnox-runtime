import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECISION_EFFECT, LocalGate, SessionHosts } from '@memnox/core';
import { describe, expect, it } from 'vitest';
import { EGRESS_KEYS_DIR, EgressKeys, newEgressKey } from '../src/egress-key';
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

async function noteSession(home: string, sessionId: string, cwd: string): Promise<void> {
  await new SessionHosts(home).note({
    sessionId,
    agent: 'claude-code',
    cwd,
    pid: 1,
    seenAt: '2026-10-30T00:00:00.000Z',
  });
}

/** A home with one session noted, and the key its run was issued. */
async function homeWithSession(
  sessionId: string,
  cwd: string,
): Promise<{ home: string; key: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-egress-project-'));
  await noteSession(home, sessionId, cwd);
  const key = newEgressKey();
  await new EgressKeys(home).issue(sessionId, key);
  return { home, key };
}

/** Lets every request out except where a project's own exception says otherwise. */
function projectExceptionGate(): LocalGate {
  return new LocalGate(
    [
      {
        name: 'no-paste',
        match: {
          actions: ['http.request', 'http.connect'],
          targets: ['*pastebin.com*'],
          unless: [{ project: PROJECT }],
        },
        decision: { effect: DECISION_EFFECT.DENY, reason: 'no paste hosts' },
      },
    ],
    { agentName: 'claude-code' },
  );
}

describe('a project rule on the egress seam', () => {
  it('decides a request from a session working in that project', async () => {
    const { home, key } = await homeWithSession('s-billing', REPO);
    const seam = new EgressSeam({
      authorizer: new HookAuthorizer({ gate: projectGate() }),
      placeOf: egressPlaces(home, async (cwd) => (cwd === REPO ? PROJECT : undefined)),
    });

    const outcome = await seam.gateRequest(
      { method: 'POST', url: 'https://pastebin.com/x' },
      { sessionId: 's-billing', key },
    );
    expect(outcome.allowed).toBe(false);
  });

  it('leaves the machine rules alone for a session it cannot place', async () => {
    const { home, key } = await homeWithSession('s-billing', REPO);
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
    const failed = await seam.gateConnect('pastebin.com:443', {
      sessionId: 's-billing',
      key,
    });
    expect(unknown.allowed).toBe(true);
    expect(failed.allowed).toBe(true);
  });

  it('places a session only for the key it was issued', async () => {
    const { home, key } = await homeWithSession('s-own', REPO);
    const places = egressPlaces(home, async () => PROJECT);

    expect(await places({ sessionId: 's-own', key })).toEqual({
      workingDirectory: REPO,
      projectId: PROJECT,
    });
    expect(await places({ sessionId: 's-own' })).toEqual({});
    expect(await places({ sessionId: 's-own', key: newEgressKey() })).toEqual({});
    expect(await places({})).toEqual({});
  });
});

describe('a session id another process claims on the egress seam', () => {
  it('gains none of the project exceptions without the session key', async () => {
    const { home, key } = await homeWithSession('s-billing', REPO);
    const seam = new EgressSeam({
      authorizer: new HookAuthorizer({ gate: projectExceptionGate() }),
      placeOf: egressPlaces(home, async (cwd) => (cwd === REPO ? PROJECT : undefined)),
    });
    const paste = { method: 'POST', url: 'https://pastebin.com/x' };

    const owner = await seam.gateRequest(paste, { sessionId: 's-billing', key });
    const forged = await seam.gateRequest(paste, { sessionId: 's-billing' });
    const guessed = await seam.gateConnect('pastebin.com:443', {
      sessionId: 's-billing',
      key: newEgressKey(),
    });

    expect(owner.allowed).toBe(true);
    expect(forged.allowed).toBe(false);
    expect(guessed.allowed).toBe(false);
  });

  it('cannot borrow one session key for the project of another', async () => {
    const { home, key } = await homeWithSession('s-mine', '/work/scratch');
    await noteSession(home, 's-billing', REPO);
    const seam = new EgressSeam({
      authorizer: new HookAuthorizer({ gate: projectExceptionGate() }),
      placeOf: egressPlaces(home, async (cwd) => (cwd === REPO ? PROJECT : undefined)),
    });

    const borrowed = await seam.gateRequest(
      { method: 'POST', url: 'https://pastebin.com/x' },
      { sessionId: 's-billing', key },
    );
    expect(borrowed.allowed).toBe(false);
  });

  it('keeps only a hash of the key on disk, and forgets it', async () => {
    const { home, key } = await homeWithSession('s-billing', REPO);
    const keys = new EgressKeys(home);
    const kept = await readdir(join(home, '.memnox', EGRESS_KEYS_DIR));
    const raw = await readFile(
      join(home, '.memnox', EGRESS_KEYS_DIR, kept[0] ?? ''),
      'utf8',
    );

    expect(raw).not.toContain(key);
    await keys.forget('s-billing');
    expect(await keys.vouches({ sessionId: 's-billing', key })).toBe(false);
  });
});

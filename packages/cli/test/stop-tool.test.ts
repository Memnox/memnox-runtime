import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayRequests, SessionHosts, SessionTurns } from '@memnox/core';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';
import { onATerminal, releaseTerminal } from './terminal-harness';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const SEAMS = {} as RewindSeams;

function depsAt(home: string, outcome: 'typed' | 'failed'): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
    delivered: async () => ({
      outcome,
      at: NOW.toISOString(),
      ...(outcome === 'failed' ? { reason: 'no iTerm tab has its terminal' } : {}),
    }),
  };
}

/** An agent on a terminal of its own, as one in a tab is, so its device is read for real. */
async function agentOnATerminal(): Promise<number> {
  return (await onATerminal()).pid;
}

afterEach(releaseTerminal);

describe('stopping an agent by voice', () => {
  it('presses Escape in its own terminal and records its turn as over', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stop-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_a',
      agent: 'claude-code',
      pid: await agentOnATerminal(),
      app: 'iTerm2',
      seenAt: NOW.toISOString(),
    });
    await new SessionTurns(home).prompted(
      'ses_a',
      'claude-code',
      '2026-10-09T11:59:00.000Z',
    );
    const deps = depsAt(home, 'typed');
    expect(
      await callOperatorTool(deps, SEAMS, 'show', { session: 'ses_a', display: 'stop' }),
    ).toMatchObject({ stopped: true });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'interrupt',
      sessionId: 'ses_a',
      // A terminal as each system names it: ttys004 on macOS, pts/0 on Linux.
      tty: expect.stringMatching(/^(ttys\d+|pts\/\d+)$/),
    });
    expect((await new SessionTurns(home).read('ses_a'))?.endedAt).toBe(NOW.toISOString());
  });

  it('never calls it stopped when the Mac could not press it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stop-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_a',
      agent: 'claude-code',
      pid: await agentOnATerminal(),
      app: 'iTerm2',
      seenAt: NOW.toISOString(),
    });
    const answer = (await callOperatorTool(depsAt(home, 'failed'), SEAMS, 'show', {
      session: 'ses_a',
      display: 'stop',
    })) as { stopped: boolean; why: string; said: string };
    expect(answer).toMatchObject({
      stopped: false,
      why: 'no iTerm tab has its terminal',
    });
    expect(answer.said).toContain('still going');
  });

  it('asks the Mac to stop a session in an editor panel, where it has no terminal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stop-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_a',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      panel: true,
      tty: 'ttys004',
      seenAt: NOW.toISOString(),
    });
    expect(
      await callOperatorTool(depsAt(home, 'typed'), SEAMS, 'show', {
        session: 'ses_a',
        display: 'stop',
      }),
    ).toMatchObject({ stopped: true });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    // No terminal named, since the panel's inherited one is never where its agent listens.
    expect(request).toMatchObject({ display: 'interrupt', sessionId: 'ses_a' });
    expect(request?.tty).toBeUndefined();
  });

  it('stops a desktop app session such as Cursor by its own Stop, rather than saying it has no terminal', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stop-app-'));
    const deps = {
      ...depsAt(home, 'typed'),
      resolveApp: (agent: string) =>
        agent === 'cursor' ? '/Applications/Cursor.app' : null,
    };
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        session: 'app_cursor',
        display: 'stop',
      }),
    ).toMatchObject({ stopped: true });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'interrupt',
      appPath: '/Applications/Cursor.app',
    });
  });
});

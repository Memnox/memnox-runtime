import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeResponse, SessionHosts, type DaemonResponse } from '@memnox/core';
import { VoiceSurface } from '../src/daemon/voice-surface';

/** A connection that keeps what it was sent, so the voice's side is tested with no socket. */
class Heard {
  destroyed = false;
  said: DaemonResponse[] = [];
  write(line: string): boolean {
    const response = decodeResponse(line.trim());
    if (response !== null) this.said.push(response);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

async function locate(
  home: string,
  sessionId?: string,
): Promise<DaemonResponse | undefined> {
  const surface = new VoiceSurface({ home, now: () => 'now', log: () => undefined });
  const peer = new Heard();
  await surface.respond(peer, {
    id: 7,
    method: 'locate',
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  surface.close();
  return peer.said[0];
}

describe('locating a session for "show me"', () => {
  it('names the app and tab, and that the agent is still running', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-locate-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_1',
      agent: 'claude-code',
      pid: process.pid,
      app: 'iTerm',
      appPath: '/Applications/iTerm.app',
      tty: 'ttys004',
      cwd: '/work/shop',
      seenAt: 'then',
    });
    expect(await locate(home, 'ses_1')).toEqual({
      id: 7,
      ok: true,
      location: {
        sessionId: 'ses_1',
        agent: 'claude-code',
        app: 'iTerm',
        appPath: '/Applications/iTerm.app',
        tty: 'ttys004',
        cwd: '/work/shop',
        alive: true,
      },
    });
  });

  it('says the agent has gone when its process has', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-locate-'));
    await new SessionHosts(home).note({
      sessionId: 'ses_2',
      agent: 'codex',
      pid: 2_147_483_000,
      seenAt: 'then',
    });
    expect((await locate(home, 'ses_2'))?.location?.alive).toBe(false);
  });

  it('refuses when it knows nothing, rather than pointing somewhere', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-locate-'));
    expect(await locate(home, 'ses_unknown')).toMatchObject({ ok: false });
    expect(await locate(home)).toMatchObject({
      ok: false,
      error: 'locate needs a session',
    });
  });
});

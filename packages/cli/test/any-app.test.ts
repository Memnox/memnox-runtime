import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DisplayRequests, SessionHosts, SpokenInstructions } from '@memnox/core';
import { installedAppNamed } from '../src/session-tools/app-tools';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('typing into any app the person names', () => {
  it('sends a follow up to Cursor through its own prompt link, and calls it sent only once the Mac saw it go', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-cursor-prompt-'));
    const answered = async (
      outcome: 'typed' | 'verified',
    ): Promise<{ said: string; typed: boolean }> => {
      const deps: SessionToolDeps = {
        home,
        cwd: home,
        agent: 'claude-code',
        env: {},
        now: () => NOW,
        readStatus: async () => ({}),
        milestonesAt: async () => [],
        brief: async () => null,
        resolveApp: (agent) => (agent === 'cursor' ? '/Applications/Cursor.app' : null),
        delivered: async () => ({ outcome, at: NOW.toISOString() }),
      };
      return (await callOperatorTool(deps, {} as RewindSeams, 'type_in_app', {
        agent: 'cursor',
        message: 'start a React Native Expo app',
      })) as { said: string; typed: boolean };
    };
    const sent = await answered('verified');
    expect(sent.typed).toBe(true);
    expect(sent.said).toContain('Sent to Cursor');
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/Applications/Cursor.app',
      via: 'send-prefilled',
    });
    expect(request?.text).toBeUndefined();
    expect(request?.links).toEqual([
      'cursor://anysphere.cursor-deeplink/prompt?text=start%20a%20React%20Native%20Expo%20app',
    ]);
    const waiting = await answered('typed');
    expect(waiting.typed).toBe(false);
    expect(waiting.said).toContain('press Return');
    expect(waiting.said).not.toContain('Sent to');
  });

  it('finds it by the name they said, spaces and case aside', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'memnox-apps-'));
    for (const app of [
      'Windsurf.app',
      'Visual Studio Code.app',
      'Zed Preview.app',
      'iTerm.app',
    ]) {
      await mkdir(join(folder, app));
    }
    expect(installedAppNamed('windsurf', [folder])).toBe(join(folder, 'Windsurf.app'));
    expect(installedAppNamed('visual studio code', [folder])).toBe(
      join(folder, 'Visual Studio Code.app'),
    );
    expect(installedAppNamed('Zed', [folder])).toBe(join(folder, 'Zed Preview.app'));
    expect(installedAppNamed('iTerm2', [folder])).toBe(join(folder, 'iTerm.app'));
    expect(installedAppNamed('Perplexity', [folder])).toBeNull();
  });

  it('hands the Mac the app and the words, and says so when the app is not there', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-any-app-'));
    const deps: SessionToolDeps = {
      home,
      cwd: home,
      agent: 'claude-code',
      env: {},
      now: () => NOW,
      readStatus: async () => ({}),
      milestonesAt: async () => [],
      brief: async () => null,
      findApp: (name) => (name === 'Windsurf' ? '/Applications/Windsurf.app' : null),
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const seams = {} as RewindSeams;
    expect(
      await callOperatorTool(deps, seams, 'type_in_app', {
        app: 'Windsurf',
        message: 'ask Cascade to fix the build',
      }),
    ).toMatchObject({ app: 'Windsurf', typed: true });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/Applications/Windsurf.app',
      text: 'ask Cascade to fix the build',
    });
    const missing = (await callOperatorTool(deps, seams, 'type_in_app', {
      app: 'Perplexity',
      message: 'hello',
    })) as { typed: boolean; said: string };
    expect(missing.typed).toBe(false);
    expect(missing.said).toContain('No app called Perplexity');
  });

  it('types a follow up into the desktop app a session lives in, rather than waiting on a hook it never runs', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-app-follow-up-'));
    const deps: SessionToolDeps = {
      home,
      cwd: home,
      agent: 'claude-code',
      env: {},
      now: () => NOW,
      readStatus: async () => ({}),
      milestonesAt: async () => [],
      brief: async () => null,
      resolveApp: (agent) => (agent === 'codex' ? '/Applications/Codex.app' : null),
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const instruction = await new SpokenInstructions(home).propose({
      sessionId: 'dsk_codex_019a',
      agent: 'codex',
      message: 'check the files changed',
      at: NOW.toISOString(),
    });
    expect(
      await callOperatorTool(deps, {} as RewindSeams, 'send_instruction', {
        instruction: instruction.id,
      }),
    ).toMatchObject({ session: 'dsk_codex_019a', typed: true });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/Applications/Codex.app',
      text: 'check the files changed',
    });
  });
  it('keeps words typed into a terminal under the agent session running there, never one made up for the app', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-terminal-app-'));
    const deps: SessionToolDeps = {
      home,
      cwd: home,
      agent: 'claude-code',
      env: {},
      now: () => NOW,
      readStatus: async () => ({}),
      milestonesAt: async () => [],
      brief: async () => null,
      findApp: () => '/Applications/iTerm.app',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const hosts = new SessionHosts(home);
    await hosts.note({
      sessionId: 'ses_older',
      agent: 'codex',
      pid: process.pid,
      app: 'iTerm',
      appPath: '/Applications/iTerm.app',
      seenAt: '2026-10-09T10:00:00.000Z',
    });
    await hosts.note({
      sessionId: 'ses_in_iterm',
      agent: 'claude-code',
      pid: process.pid,
      app: 'iTerm',
      appPath: '/Applications/iTerm.app',
      seenAt: '2026-10-09T11:00:00.000Z',
    });
    await hosts.note({
      sessionId: 'ses_gone',
      agent: 'claude-code',
      pid: 2 ** 22 + 7,
      app: 'iTerm',
      seenAt: '2026-10-09T11:30:00.000Z',
    });

    await callOperatorTool(deps, {} as RewindSeams, 'type_in_app', {
      app: 'iTerm',
      message: 'run the tests',
    });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());

    expect(request).toMatchObject({
      sessionId: 'ses_in_iterm',
      agent: 'claude-code',
      title: 'iTerm',
      appPath: '/Applications/iTerm.app',
    });
  });

  it('keys a terminal with no agent session in it by the app, as before', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-terminal-app-'));
    const deps: SessionToolDeps = {
      home,
      cwd: home,
      agent: 'claude-code',
      env: {},
      now: () => NOW,
      readStatus: async () => ({}),
      milestonesAt: async () => [],
      brief: async () => null,
      findApp: () => '/Applications/iTerm.app',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };

    await callOperatorTool(deps, {} as RewindSeams, 'type_in_app', {
      app: 'iTerm',
      message: 'ls',
    });
    const [request] = await new DisplayRequests(home).open(NOW.toISOString());

    expect(request).toMatchObject({ sessionId: 'app_iterm', agent: 'iTerm' });
  });
});

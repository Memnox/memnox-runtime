import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayRequests, SessionHosts } from '@memnox/core';
import { showPane, type PaneSeams } from '../src/session-tools/multiplexer';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';
import { onATerminal, releaseTerminal } from './terminal-harness';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const SEAMS = {} as RewindSeams;

/** A running tmux that records what it is asked, with one pane per terminal it is told of. */
function tmux(panes: Record<string, string> = {}): { seams: PaneSeams; ran: string[][] } {
  const ran: string[][] = [];
  const seams: PaneSeams = {
    run: (file, args) => {
      if (file !== 'tmux') return null;
      ran.push([...args]);
      if (args[0] === 'list-panes')
        return Object.entries(panes)
          .map(([tty, id]) => `/dev/${tty} ${id}`)
          .join('\n');
      if (args[0] === 'new-window') return '%9\n';
      if (args[0] === 'display-message') return 'work\n';
      if (args[0] === 'list-clients') return 'work 4242\n';
      return '';
    },
    pause: async () => undefined,
  };
  return { seams, ran };
}

async function depsAt(over: Partial<SessionToolDeps> = {}): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-everywhere-'));
  const repo = join(home, 'Documents', 'memnox-runtime');
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
    resolveCommand: () => 'claude',
    resolveEditor: (editor) =>
      editor === 'vscode' ? '/Applications/Visual Studio Code.app' : null,
    delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    startSeen: async () => 'ses_started',
    ...over,
  };
}

async function started(
  deps: SessionToolDeps,
  args: Record<string, string>,
): Promise<unknown> {
  const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
    repository: 'memnox runtime',
    task: 'fix the build',
    ...args,
  })) as { start: string; in?: string };
  return {
    proposedIn: proposed.in,
    ...((await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    })) as object),
  };
}

describe('starting a session wherever they name', () => {
  it('opens a tmux window in the repository and types the start line through tmux', async () => {
    const { seams, ran } = tmux();
    const deps = await depsAt({ panes: seams });
    expect(await started(deps, { terminal: 'tmux' })).toMatchObject({
      proposedIn: 'a new tmux window',
      started: true,
    });
    expect(ran.find((args) => args[0] === 'new-window')).toContain('-c');
    expect(
      ran.find((args) => args[0] === 'send-keys' && args.includes('-l'))?.at(-1),
    ).toMatch(/memnox run -- claude 'fix the build'$/);
    expect(await new DisplayRequests(deps.home).open(NOW.toISOString())).toEqual([]);
  });

  it('asks the Mac to open another terminal app on the repository', async () => {
    // A folder this test makes, so the app is installed wherever the suite runs.
    const base = await depsAt();
    const ghostty = join(base.home, 'Ghostty.app');
    await mkdir(ghostty);
    const deps = {
      ...base,
      findApp: (name: string) => (name === 'Ghostty' ? ghostty : null),
    };
    expect(await started(deps, { terminal: 'Ghostty' })).toMatchObject({ started: true });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'launch',
      via: 'terminal-app',
      appPath: ghostty,
    });
  });

  it('starts Claude Code in its editor panel as a new conversation with the task', async () => {
    const deps = await depsAt();
    expect(await started(deps, { panel: 'true' })).toMatchObject({
      proposedIn: 'a new conversation in the Claude Code panel in VS Code',
      started: true,
    });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'launch',
      via: 'panel',
      text: 'fix the build',
      appPath: '/Applications/Visual Studio Code.app',
    });
  });
});

afterEach(releaseTerminal);

describe('closing a session wherever it runs', () => {
  it('ends the agent in an editor panel, and records it as closed', async () => {
    const ended: number[] = [];
    const deps = await depsAt({
      endAgent: async (pid) => {
        ended.push(pid);
        return true;
      },
    });
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_panel',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      panel: true,
      seenAt: NOW.toISOString(),
    });
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        session: 'ses_panel',
        display: 'close',
      }),
    ).toMatchObject({ closed: true });
    expect(ended).toEqual([process.pid]);
    expect((await new SessionHosts(deps.home).read('ses_panel'))?.endedAt).toBe(
      NOW.toISOString(),
    );
  });

  it('kills its tmux pane', async () => {
    const { pid, tty } = await onATerminal();
    const { seams, ran } = tmux({ [tty]: '%3' });
    const deps = await depsAt({ panes: seams });
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_pane',
      agent: 'claude-code',
      pid,
      seenAt: NOW.toISOString(),
    });
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        session: 'ses_pane',
        display: 'close',
      }),
    ).toMatchObject({ closed: true });
    expect(ran).toContainEqual(['kill-pane', '-t', '%3']);
  });

  it('ends the agent in Terminal first, and says so when its tab could not be closed', async () => {
    const { pid } = await onATerminal();
    const deps = await depsAt({
      endAgent: async () => true,
      delivered: async () => ({
        outcome: 'failed',
        at: NOW.toISOString(),
        reason: 'its tab did not come to the front',
      }),
    });
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_tab',
      agent: 'claude-code',
      pid,
      app: 'Terminal',
      seenAt: NOW.toISOString(),
    });
    const answer = (await callOperatorTool(deps, SEAMS, 'show', {
      session: 'ses_tab',
      display: 'close',
    })) as { closed: boolean; said: string };
    expect(answer.closed).toBe(true);
    expect(answer.said).toContain('still open at a shell prompt');
  });
});

describe('showing a session in a tmux pane', () => {
  it('selects the pane and names the terminal its tmux client runs in', () => {
    const { seams, ran } = tmux();
    const shown = showPane(
      { multiplexer: 'tmux', id: '%3', program: 'tmux' },
      seams,
      () => [
        { pid: 4242, command: 'tmux', tty: 'ttys007' },
        { pid: 4100, command: '-zsh', tty: 'ttys007' },
        {
          pid: 4000,
          command: '/Applications/iTerm.app/Contents/MacOS/iTerm2',
          tty: '??',
        },
      ],
    );
    expect(ran).toContainEqual(['select-window', '-t', '%3']);
    expect(shown).toMatchObject({ app: 'iTerm', tty: 'ttys007' });
  });
});

describe('a desktop app the person names', () => {
  it('is stopped or closed by the Mac, and a new chat is started when asked', async () => {
    const deps = await depsAt({ findApp: () => '/Applications/Perplexity.app' });
    expect(
      await callOperatorTool(deps, SEAMS, 'control_app', {
        app: 'Perplexity',
        action: 'stop',
      }),
    ).toMatchObject({ app: 'Perplexity', done: true });
    await callOperatorTool(deps, SEAMS, 'type_in_app', {
      app: 'Perplexity',
      message: 'summarise this',
      new_chat: 'true',
    });
    const requests = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(requests.map((each) => [each.display, each.via])).toEqual([
      ['interrupt', undefined],
      ['app', 'new-chat'],
    ]);
  });
});

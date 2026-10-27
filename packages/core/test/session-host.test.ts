import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentProcessOf,
  describeHost,
  startedInPanel,
  hostOf,
  SessionHosts,
  type HostProcess,
} from '../src/discovery/session-host';

const VSCODE: HostProcess[] = [
  { pid: 40, command: '/bin/zsh', tty: '??' },
  { pid: 30, command: '/Users/me/.local/bin/claude', tty: 'ttys007' },
  { pid: 20, command: '/bin/zsh', tty: 'ttys007' },
  {
    pid: 10,
    command:
      '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
    tty: '??',
  },
];

describe('where a session runs', () => {
  it('names the outermost app, since an editor runs its terminal inside a helper of its own', () => {
    expect(hostOf(VSCODE)).toEqual({
      tty: 'ttys007',
      appPath: '/Applications/Visual Studio Code.app',
      app: 'Visual Studio Code',
    });
  });

  it('finds iTerm and its tab', () => {
    expect(
      hostOf([
        { pid: 3, command: 'claude', tty: 'ttys004' },
        { pid: 2, command: '-zsh', tty: 'ttys004' },
        { pid: 1, command: '/Applications/iTerm.app/Contents/MacOS/iTerm2', tty: '??' },
      ]),
    ).toEqual({ tty: 'ttys004', appPath: '/Applications/iTerm.app', app: 'iTerm' });
  });

  it('takes the Linux mark for no terminal as none, as it does the macOS one', () => {
    expect(
      hostOf([
        { pid: 3, command: 'claude', tty: '?' },
        { pid: 2, command: '/bin/bash', tty: 'pts/2' },
      ]).tty,
    ).toBe('pts/2');
    expect(hostOf([{ pid: 3, command: 'claude', tty: '?' }]).tty).toBeUndefined();
  });

  it("names the terminal a Codex inside ChatGPT runs in, never the agent's own app", () => {
    expect(
      hostOf([
        { pid: 4, command: '/bin/sh', tty: 'ttys007' },
        {
          pid: 3,
          command: '/Applications/ChatGPT.app/Contents/Resources/codex',
          tty: 'ttys007',
        },
        { pid: 2, command: '-zsh', tty: 'ttys007' },
        {
          pid: 1,
          command: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
          tty: '??',
        },
      ]),
    ).toEqual({
      tty: 'ttys007',
      appPath: '/System/Applications/Utilities/Terminal.app',
      app: 'Terminal',
    });
  });

  it("finds an agent in an editor's panel, which has no terminal", () => {
    expect(
      hostOf([
        {
          pid: 3,
          command: '/Users/me/.vscode/extensions/anthropic.claude-code/resources/claude',
          tty: '??',
        },
        {
          pid: 2,
          command:
            '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
          tty: '??',
        },
        {
          pid: 1,
          command: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
          tty: '??',
        },
      ]),
    ).toEqual({
      appPath: '/Applications/Visual Studio Code.app',
      app: 'Visual Studio Code',
    });
  });

  it('says where it runs the way a person would look for it', () => {
    const at = {
      sessionId: 's',
      agent: 'claude-code',
      pid: 1,
      seenAt: 't',
      cwd: '/code/memnox-runtime',
    };
    expect(describeHost({ ...at, app: 'Visual Studio Code' })).toBe(
      'Visual Studio Code, in its Claude Code panel, opened on memnox-runtime',
    );
    expect(describeHost({ ...at, app: 'Visual Studio Code', tty: 'ttys003' })).toBe(
      'Visual Studio Code, in its terminal, opened on memnox-runtime',
    );
    expect(
      describeHost({ ...at, app: 'Visual Studio Code', tty: 'ttys003', panel: true }),
    ).toBe(describeHost({ ...at, app: 'Visual Studio Code' }));
    expect(describeHost({ ...at, app: 'iTerm', tty: 'ttys004' })).toBe(
      'a tab in iTerm, opened on memnox-runtime',
    );
    expect(describeHost(at)).toBeUndefined();
  });

  it('knows a session started by an editor panel from one in a terminal', () => {
    expect(startedInPanel('claude-vscode')).toBe(true);
    expect(startedInPanel('cli')).toBe(false);
    expect(startedInPanel(undefined)).toBe(false);
  });

  it('says nothing it does not know, rather than guessing an app', () => {
    expect(hostOf([{ pid: 1, command: '/usr/sbin/sshd', tty: '??' }])).toEqual({});
  });

  it('takes the agent to be the first process above the hook that is not a shell', () => {
    expect(agentProcessOf(VSCODE)?.pid).toBe(30);
  });

  it('notes a session once, and keeps the first answer', async () => {
    const hosts = new SessionHosts(await mkdtemp(join(tmpdir(), 'memnox-hosts-')));
    const first = {
      sessionId: 'a/b:c',
      agent: 'claude-code',
      pid: 30,
      seenAt: 't1',
      app: 'iTerm',
    };
    await hosts.note(first);
    await hosts.note({ ...first, app: 'Terminal', seenAt: 't2' });
    expect(await hosts.read('a/b:c')).toEqual(first);
  });

  it('marks a session the person closed as ended, and a resume as a fresh start', async () => {
    const hosts = new SessionHosts(await mkdtemp(join(tmpdir(), 'memnox-hosts-')));
    const first = { sessionId: 's1', agent: 'claude-code', pid: 30, seenAt: 't1' };
    await hosts.note(first);
    await hosts.end('s1', 't2');
    expect((await hosts.read('s1'))?.endedAt).toBe('t2');
    await hosts.end('s1', 't3');
    expect((await hosts.read('s1'))?.endedAt).toBe('t2');
    await hosts.note({ ...first, pid: 31, seenAt: 't4' });
    expect(await hosts.read('s1')).toEqual({ ...first, pid: 31, seenAt: 't4' });
  });
});

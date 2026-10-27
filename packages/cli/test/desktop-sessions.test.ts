import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { desktopRoots, desktopSessions } from '../src/daemon/desktop-sessions';
import { SessionLives } from '../src/daemon/session-lifecycle';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const CODEX_ID = '01a11dee-ee16-76c2-a643-26dfa3df3357';
const REPO = '/Users/me/work/memnox-runtime';

function codexLog(originator: string, finished: boolean): string {
  const lines: unknown[] = [
    {
      timestamp: '2026-10-09T11:50:00.000Z',
      type: 'session_meta',
      payload: { id: CODEX_ID, cwd: REPO, originator },
    },
    {
      timestamp: '2026-10-09T11:50:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started' },
    },
    {
      timestamp: '2026-10-09T11:50:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '<environment_context>cwd</environment_context>' },
        ],
      },
    },
    {
      timestamp: '2026-10-09T11:50:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'check the git history' }],
      },
    },
    {
      timestamp: '2026-10-09T11:50:05.000Z',
      type: 'response_item',
      payload: { type: 'function_call', name: 'exec' },
    },
    {
      timestamp: '2026-10-09T11:50:09.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'The branch is feat/voice-answers.' }],
      },
    },
  ];
  if (finished)
    lines.push({
      timestamp: '2026-10-09T11:50:10.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete' },
    });
  return lines.map((each) => JSON.stringify(each)).join('\n');
}

async function homeWith(originator: string, finished: boolean): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-desktop-'));
  const day = join(home, '.codex', 'sessions', '2026', '10', '09');
  await mkdir(day, { recursive: true });
  await writeFile(
    join(day, `rollout-2026-10-09T11-50-00-${CODEX_ID}.jsonl`),
    codexLog(originator, finished),
  );
  const space = join(
    home,
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
    'org',
    'space',
  );
  await mkdir(join(space, 'local_abc'), { recursive: true });
  await writeFile(
    join(space, 'local_abc.json'),
    JSON.stringify({
      sessionId: 'local_abc',
      title: 'Project overview',
      userSelectedFolders: [REPO],
      createdAt: Date.parse('2026-10-09T11:00:00.000Z'),
      lastActivityAt: Date.parse('2026-10-09T11:30:00.000Z'),
    }),
  );
  await writeFile(
    join(space, 'local_abc', 'audit.jsonl'),
    [
      {
        type: 'user',
        _audit_timestamp: '2026-10-09T11:01:00.000Z',
        message: { role: 'user', content: 'what is this project about?' },
      },
      {
        type: 'assistant',
        _audit_timestamp: '2026-10-09T11:02:00.000Z',
        message: { content: [{ type: 'text', text: 'It is Memnox, a control plane.' }] },
      },
      { type: 'result', _audit_timestamp: '2026-10-09T11:02:01.000Z' },
    ]
      .map((each) => JSON.stringify(each))
      .join('\n'),
  );
  return home;
}

function depsFor(home: string): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

describe('sessions in the agents’ desktop apps', () => {
  it('lists the Codex app and Claude desktop sessions, and never Codex in a terminal twice', async () => {
    const home = await homeWith('Codex Desktop', false);
    const rows = (await callOperatorTool(
      depsFor(home),
      {} as RewindSeams,
      'sessions',
      {},
    )) as {
      session: string;
      runningIn: string;
      state: string;
      task?: string;
      waitingOnYou: number;
    }[];
    // The phones read every session view with the count, so an app's session carries it too.
    expect(rows.map((each) => each.waitingOnYou)).toEqual([0, 0]);
    expect(rows.map((each) => [each.runningIn, each.task, each.state])).toEqual([
      ['the Codex app', 'check the git history', 'working'],
      ['Claude desktop', 'Project overview', expect.any(String)],
    ]);
    const terminal = await homeWith('codex-tui', false);
    expect(desktopSessions(desktopRoots(terminal), '').map((each) => each.app)).toEqual([
      'Claude',
    ]);
  });

  it('reads one whole: what was asked, what it answered and what it ran', async () => {
    const home = await homeWith('Codex Desktop', true);
    const history = (await callOperatorTool(depsFor(home), {} as RewindSeams, 'history', {
      session: `dsk_codex_${CODEX_ID}`,
    })) as { turns: { asked: string; answered?: string; tools: number }[] };
    expect(history.turns).toEqual([
      expect.objectContaining({
        asked: 'check the git history',
        answered: 'The branch is feat/voice-answers.',
        tools: 1,
      }),
    ]);
    const claude = (await callOperatorTool(depsFor(home), {} as RewindSeams, 'history', {
      session: 'dsk_claude_local_abc',
    })) as { turns: { asked: string; answered?: string }[] };
    expect(claude.turns[0]).toMatchObject({
      asked: 'what is this project about?',
      answered: 'It is Memnox, a control plane.',
    });
  });

  it('tells of a session begun in the app, and of a turn there that finished', async () => {
    const home = await homeWith('Codex Desktop', false);
    // Begun before the files are written, which carry the real clock as their modified time.
    const lives = new SessionLives(home, '2026-01-01T00:00:00.000Z', {
      alive: () => true,
    });
    const first = await lives.look('2026-10-09T11:51:00.000Z');
    const codex = first.find((each) => each.sessionId === `dsk_codex_${CODEX_ID}`);
    expect(codex?.notice).toBe('started');
    expect(codex?.summary).toContain('in the Codex app, in memnox-runtime');
    const day = join(home, '.codex', 'sessions', '2026', '10', '09');
    await writeFile(
      join(day, `rollout-2026-10-09T11-50-00-${CODEX_ID}.jsonl`),
      codexLog('Codex Desktop', true),
    );
    const then = await lives.look('2026-10-09T11:52:00.000Z');
    expect(then.map((each) => each.notice)).toEqual(['finished']);
  });
});

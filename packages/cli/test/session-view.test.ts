import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SessionHosts,
  SessionTasks,
  SessionTurns,
  SqliteEventStore,
  type MemnoxEvent,
} from '@memnox/core';
import { SessionViews } from '../src/daemon/session-view';
import { deliveredAs } from '../src/daemon/session-view-steps';

const NOW = new Date('2026-10-02T12:00:00.000Z');

function row(over: Partial<MemnoxEvent>): MemnoxEvent {
  return {
    id: `evt_${over.at ?? ''}`,
    schemaVersion: 1,
    at: '2026-10-02T11:58:00.000Z',
    sessionId: 'ses_live',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'filesystem',
    operation: 'file.edit',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

describe('the live window on a session', () => {
  it('says what it is on, what it just did in words, and marks what was refused', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-live-'));
    const store = SqliteEventStore.forHome(home);
    await store.append(
      row({ at: '2026-10-02T11:58:00.000Z', target: '/r/src/orders.ts' }),
    );
    await store.append(
      row({
        at: '2026-10-02T11:59:00.000Z',
        surface: 'git',
        operation: 'git.push',
        target: 'main',
        effect: 'deny',
      }),
    );
    store.close();
    await new SessionTasks(home).declare({
      id: 'tsk_1',
      sessionId: 'ses_live',
      statement: 'add order cancellation',
      scope: {},
      declaredAt: '2026-10-02T11:50:00.000Z',
    });
    await new SessionTurns(home).prompted(
      'ses_live',
      'claude-code',
      '2026-10-02T11:57:00.000Z',
    );

    const view = await new SessionViews(home, () => NOW).view('ses_live');
    expect(view).toMatchObject({
      agentName: 'Claude Code',
      task: 'add order cancellation',
      state: 'working',
      thinking: true,
    });
    expect(view?.steps).toEqual([
      expect.objectContaining({ surface: 'filesystem', text: 'Edited src/orders.ts' }),
      expect.objectContaining({ surface: 'git', text: 'Pushed main', refused: true }),
    ]);
    expect(await new SessionViews(home, () => NOW).view('ses_unknown')).toBeNull();
    // The switcher's cards: the same session, with who it is and what it is on.
    expect(await new SessionViews(home, () => NOW).list()).toEqual([
      expect.objectContaining({
        sessionId: 'ses_live',
        agent: 'claude-code',
        agentName: 'Claude Code',
        task: 'add order cancellation',
        thinking: true,
      }),
    ]);
  });

  it('shows the lines it changed in the file it changed most', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-live-'));
    const repo = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-live-repo-')));
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
        cwd: repo,
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_COMMITTER_DATE: '2026-10-02T11:00:00Z',
          GIT_AUTHOR_DATE: '2026-10-02T11:00:00Z',
        },
      });
    };
    git('init', '-q');
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'invoice.ts'), 'export const TVA = 0.2;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'start');
    await writeFile(
      join(repo, 'src', 'invoice.ts'),
      'export const TVA = 0.196;\nexport const total = 0;\n',
    );
    const touched = new Date('2026-10-02T11:58:30.000Z');
    await utimes(join(repo, 'src', 'invoice.ts'), touched, touched);
    await new SessionHosts(home).note({
      sessionId: 'ses_live',
      agent: 'claude-code',
      pid: process.pid,
      seenAt: '2026-10-02T11:50:00.000Z',
      cwd: repo,
    });
    const store = SqliteEventStore.forHome(home);
    await store.append(row({ target: 'src/invoice.ts' }));
    store.close();
    const turns = new SessionTurns(home);
    await turns.prompted('ses_live', 'claude-code', '2026-10-02T11:55:00.000Z');
    await turns.ended('ses_live', 'claude-code', '2026-10-02T11:59:30.000Z');

    const view = await new SessionViews(home, () => NOW).view('ses_live');
    expect(view?.excerpt).toEqual({
      path: 'src/invoice.ts',
      lines: [
        '-export const TVA = 0.2;',
        '+export const TVA = 0.196;',
        '+export const total = 0;',
      ],
    });
    const diff = await new SessionViews(home, () => NOW).diff(
      'ses_live',
      'src/invoice.ts',
    );
    expect(diff?.path).toBe('src/invoice.ts');
    expect(diff?.lines[0]).toMatch(/^@@/);
    expect(diff?.lines).toContain('+export const total = 0;');
    expect(
      await new SessionViews(home, () => NOW).diff('ses_live', 'src/none.ts'),
    ).toBeNull();
  });

  it('says what a session is about from its first request, with its branch, where it runs and where it stands', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-live-'));
    const repo = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-live-repo-')));
    execFileSync('git', ['init', '-q', '-b', 'feat/cancel'], {
      cwd: repo,
      stdio: 'ignore',
    });
    const agentSession = 'a1b2c3d4-0000-4000-8000-000000000001';
    await new SessionHosts(home).note({
      sessionId: 'ses_about',
      agent: 'claude-code',
      pid: process.pid,
      seenAt: '2026-10-02T11:50:00.000Z',
      cwd: repo,
      app: 'Terminal',
      tty: '/dev/ttys004',
      agentSession,
    });
    const store = SqliteEventStore.forHome(home);
    await store.append(
      row({
        sessionId: 'ses_about',
        surface: 'shell',
        operation: 'shell.exec',
        target: 'ls',
      }),
    );
    store.close();
    const line = (value: unknown): string => JSON.stringify(value);
    await mkdir(join(home, '.claude', 'projects', 'repo'), { recursive: true });
    await writeFile(
      join(home, '.claude', 'projects', 'repo', `${agentSession}.jsonl`),
      [
        line({
          type: 'user',
          timestamp: 't1',
          message: { content: 'add order cancellation to the cart' },
        }),
        line({
          type: 'assistant',
          timestamp: 't2',
          message: {
            content: [
              {
                type: 'text',
                text: '## Done\n- The **cancel** button is in `Cart.tsx`.',
              },
            ],
          },
        }),
      ].join('\n'),
    );

    const view = await new SessionViews(home, () => NOW).view('ses_about');
    expect(view).toMatchObject({
      task: 'add order cancellation to the cart',
      branch: 'feat/cancel',
      where: expect.stringContaining('Terminal'),
      lastSaid: 'Done The cancel button is in Cart.tsx.',
    });
    expect(view?.repository).toBe(basename(repo));
  });

  it('orders the cards by when the person last wrote to each, not by which agent last ran something', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-live-'));
    const line = (value: unknown): string => JSON.stringify(value);
    await mkdir(join(home, '.claude', 'projects', 'repo'), { recursive: true });
    const said = async (id: string, at: string): Promise<void> => {
      await writeFile(
        join(home, '.claude', 'projects', 'repo', `${id}.jsonl`),
        [
          line({ type: 'user', timestamp: at, message: { content: 'fix the relay' } }),
          line({
            type: 'assistant',
            timestamp: '2026-10-02T11:59:00.000Z',
            message: { content: [{ type: 'text', text: 'Working on it.' }] },
          }),
        ].join('\n'),
      );
    };
    const busy = 'b0000000-0000-4000-8000-000000000001';
    const mine = 'b0000000-0000-4000-8000-000000000002';
    await said(busy, '2026-10-02T10:00:00.000Z');
    await said(mine, '2026-10-02T11:40:00.000Z');
    const store = SqliteEventStore.forHome(home);
    await store.append(row({ sessionId: busy, at: '2026-10-02T11:59:00.000Z' }));
    await store.append(row({ sessionId: mine, at: '2026-10-02T11:41:00.000Z' }));
    store.close();

    const cards = await new SessionViews(home, () => NOW).list();
    expect(cards.map((each) => [each.sessionId, each.spokenToAt])).toEqual([
      [mine, '2026-10-02T11:40:00.000Z'],
      [busy, '2026-10-02T10:00:00.000Z'],
    ]);
  });
});

describe('what became of a message, as a step reads', () => {
  it("says it in the person's words rather than as the ledger row", () => {
    expect(deliveredAs('verified')).toBe('Your message went in');
    expect(deliveredAs('typed')).toBe('Your message was typed in');
    expect(deliveredAs('clipboard')).toBe('Your message was left on the clipboard');
    expect(deliveredAs('failed')).toBe('Your message did not go in');
  });

  it('never prints a raw outcome it does not know', () => {
    expect(deliveredAs('something-new')).toBe('You sent it a message');
    expect(deliveredAs(undefined)).toBe('You sent it a message');
  });
});

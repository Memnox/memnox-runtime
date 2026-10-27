import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configPathFor,
  DEFAULT_CONFIG,
  ENFORCEMENT_MODE,
  renderConfig,
  SessionTasks,
  taskFor,
  type SessionBriefAsk,
} from '@memnox/core';
import { sessionBriefLine } from '../src/session-brief-line';
import { answerSessionStart, type SessionContextDeps } from '../src/session-context-hook';

/**
 * The workspace's word on where a session starts: work people have open there and what was
 * said about it, asked once, and nothing at all whenever it cannot be.
 */

const NOW = new Date('2026-10-19T10:00:00.000Z');
const REMOTE = 'github.com/acme/api';

const PACK = {
  humanWork: [
    {
      kind: 'pull_request',
      person: 'Priya Shah',
      paths: ['src/billing/invoice.ts'],
      url: 'https://github.com/acme/api/pull/12',
      title: 'Retry failed charges',
    },
  ],
};

async function machine(): Promise<{ home: string; repo: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-session-brief-'));
  const repo = join(home, 'work', 'repo');
  await mkdir(join(repo, 'src', 'billing'), { recursive: true });
  await mkdir(join(configPathFor(home), '..'), { recursive: true });
  await writeFile(
    configPathFor(home),
    renderConfig({ ...DEFAULT_CONFIG, mode: ENFORCEMENT_MODE.ENFORCE }),
  );
  return { home, repo };
}

function recorder(answer: unknown = PACK) {
  const asked: SessionBriefAsk[] = [];
  const brief = async (ask: SessionBriefAsk): Promise<unknown> => {
    asked.push(ask);
    return answer;
  };
  return { asked, brief };
}

describe('what a session starting is asked about', () => {
  it('asks about the paths and the task the person declared', async () => {
    const { home, repo } = await machine();
    await new SessionTasks(home).declare(
      taskFor(
        {
          sessionId: 'run-1',
          statement: 'Cap the retries on failed charges',
          scope: { paths: ['src/billing/**', `${repo}/docs/billing.md`] },
        },
        NOW.toISOString(),
      ),
    );
    const { asked, brief } = recorder();

    const line = await sessionBriefLine({
      home,
      sessionId: 'run-1',
      cwd: repo,
      root: repo,
      brief,
      remoteOf: () => REMOTE,
    });

    expect(asked).toEqual([
      {
        resources: ['src/billing', 'docs/billing.md'],
        repository: REMOTE,
        task: 'Cap the retries on failed charges',
      },
    ]);
    expect(line).toContain('Priya Shah has an open pull request');
  });

  it('asks about the folder it opened in where nothing was declared', async () => {
    const { home, repo } = await machine();
    const { asked, brief } = recorder();

    await sessionBriefLine({
      home,
      sessionId: 's1',
      cwd: join(repo, 'src', 'billing'),
      root: repo,
      brief,
      remoteOf: () => REMOTE,
    });

    expect(asked[0]).toEqual({ resources: ['src/billing'], repository: REMOTE });
  });

  it('asks about the whole repository, by its remote, from the repository root', async () => {
    const { home, repo } = await machine();
    const { asked, brief } = recorder();

    await sessionBriefLine({
      home,
      sessionId: 's1',
      cwd: repo,
      root: repo,
      brief,
      remoteOf: () => REMOTE,
    });

    expect(asked[0]).toEqual({ resources: [REMOTE], repository: REMOTE });
  });

  it('asks nothing outside a repository with no remote to name', async () => {
    const { home } = await machine();
    const { asked, brief } = recorder();

    const line = await sessionBriefLine({
      home,
      sessionId: 's1',
      cwd: '/somewhere/else',
      root: null,
      brief,
    });

    expect(line).toBe('');
    expect(asked).toEqual([]);
  });

  it('reads no remote and asks nothing on a machine in no workspace', async () => {
    const { home, repo } = await machine();
    let remoteRead = false;

    const line = await sessionBriefLine({
      home,
      sessionId: 's1',
      cwd: repo,
      root: repo,
      remoteOf: () => {
        remoteRead = true;
        return REMOTE;
      },
    });

    expect(line).toBe('');
    expect(remoteRead).toBe(false);
  });
});

describe('the session start, with the workspace in it', () => {
  async function deps(brief: SessionContextDeps['brief']): Promise<SessionContextDeps> {
    const { home, repo } = await machine();
    return {
      home,
      agent: 'claude-code',
      env: {},
      cwd: repo,
      now: () => NOW,
      rootOf: () => repo,
      remoteOf: () => REMOTE,
      ...(brief === undefined ? {} : { brief }),
    };
  }

  function contextOf(said: string): string {
    return (JSON.parse(said) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
  }

  it('carries the people working on these files into the added context', async () => {
    const { brief } = recorder();
    const text = contextOf(
      await answerSessionStart({ sessionId: 's1' }, await deps(brief)),
    );

    expect(text).toContain('People working on these files now:');
    expect(text).toContain('(https://github.com/acme/api/pull/12)');
  });

  it('starts the session the same when the workspace fails or says nothing', async () => {
    const failing = async (): Promise<unknown> => {
      throw new Error('control plane down');
    };
    const quiet = recorder({ humanWork: [], openWork: [], discussion: [] }).brief;

    const base = await deps(undefined);
    const offline = contextOf(await answerSessionStart({ sessionId: 's1' }, base));
    const broken = contextOf(
      await answerSessionStart({ sessionId: 's1' }, { ...base, brief: failing }),
    );
    const silent = contextOf(
      await answerSessionStart({ sessionId: 's1' }, { ...base, brief: quiet }),
    );

    expect(broken).toBe(offline);
    expect(silent).toBe(offline);
    expect(offline).not.toContain('From your workspace');
  });
});

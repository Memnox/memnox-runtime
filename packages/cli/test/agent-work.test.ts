import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentWorks,
  DAEMON_METHOD,
  SESSION_VAR,
  SessionTasks,
  startedWork,
  withHandoffRequest,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { profilesAnswer } from '../src/daemon/profiles-answer';
import { workAnswer } from '../src/daemon/work-answer';
import {
  markBlockedTool,
  myWorkTool,
  reportProgressTool,
  requestHandoffTool,
} from '../src/session-tools/agent-work-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { joinWork } from '../src/work/join-work';

/**
 * A person points a profile's agent at a tracker issue from their own screen. A session of that
 * agent on a branch named for the issue joins it and is held to it as its task.
 */

const NOW = new Date('2026-11-07T12:00:00.000Z');

async function machine(): Promise<{ home: string; repo: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-work-'));
  const repo = await mkdtemp(join(tmpdir(), 'memnox-work-repo-'));
  await mkdir(join(repo, '.git'), { recursive: true });
  await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feat/LIN-123-retry\n');
  await profilesAnswer(
    home,
    {
      id: 1,
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Coder', responsiblePerson: 'ana' },
    } as DaemonRequest,
    NOW,
  );
  return { home, repo };
}

function ask(home: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  return workAnswer(
    home,
    { id: 1, method: DAEMON_METHOD.WORK, ...request } as DaemonRequest,
    { now: NOW },
  );
}

describe('agent work on this machine', () => {
  it('is started by a person against an issue, kept in its project, and never a copy of it', async () => {
    const { home, repo } = await machine();
    const started = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'coder',
      workTarget: 'LIN-123',
      workTitle: 'Retry failed payments',
      workProject: repo,
    });
    expect(started.ok).toBe(true);
    const [work] = started.agentWork ?? [];
    expect(work).toMatchObject({
      profileId: 'coder',
      responsiblePerson: 'ana',
      target: { source: 'linear', externalId: 'LIN-123', title: 'Retry failed payments' },
      projectRoot: repo,
      status: 'active',
    });
    const kept = await new AgentWorks(home).all();
    expect(kept.map((each) => each.id)).toEqual([work?.id]);
  });

  it('refuses an issue nobody could find and a profile nobody made', async () => {
    const { home } = await machine();
    const vague = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'coder',
      workTarget: 'make it better',
    });
    expect(vague.ok).toBe(false);
    const nobody = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'ghost',
      workTarget: 'LIN-1',
    });
    expect(nobody.error).toBe('No profile is called ghost.');
  });

  it('is joined by a session on a branch named for the issue, which takes it as its task', async () => {
    const { home, repo } = await machine();
    // No scan has found an agent here, so there is no default profile to point at.
    const started = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'default-claude-code',
      workTarget: 'LIN-123',
    });
    expect(started.ok).toBe(false);
    await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'coder',
      workTarget: 'LIN-123',
    });
    // The agent works under its default profile, which carries none of it, so nothing joins.
    const none = await joinWork({
      home,
      sessionId: 'ses_1',
      agent: 'claude-code',
      root: repo,
      now: NOW.toISOString(),
    });
    expect(none).toBeNull();
    const [work] = await new AgentWorks(home).all();
    if (work === undefined) throw new Error('no work');
    await new AgentWorks(home).write({ ...work, profileId: 'default-claude-code' });
    const task = await joinWork({
      home,
      sessionId: 'ses_2',
      agent: 'claude-code',
      root: repo,
      now: NOW.toISOString(),
    });
    expect(task?.statement).toBe('LIN-123');
    expect((await new SessionTasks(home).read('ses_2'))?.statement).toBe('LIN-123');
    expect((await new AgentWorks(home).read(work.id))?.sessions).toEqual(['ses_2']);
  });

  it('is handed on only when a person accepts, and stopped or closed only by one', async () => {
    const { home } = await machine();
    const started = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'coder',
      workTarget: 'LIN-7',
    });
    const [work] = started.agentWork ?? [];
    if (work === undefined) throw new Error('no work');
    const asked = withHandoffRequest(work, {
      to: { profileId: 'reviewer' },
      reason: 'ready for review',
      at: NOW.toISOString(),
    });
    if ('refused' in asked) throw new Error(asked.refused);
    await new AgentWorks(home).write(asked.work);
    const handoffId = asked.work.handoffs[0]?.id ?? '';
    const accepted = await ask(home, {
      method: DAEMON_METHOD.HANDOFF_ANSWER,
      handoffId,
      handoffAnswer: 'accept',
    });
    expect(accepted.agentWork?.[0]?.profileId).toBe('reviewer');
    const closed = await ask(home, { method: DAEMON_METHOD.WORK_CLOSE, workId: work.id });
    expect(closed.agentWork?.[0]?.status).toBe('done');
    const again = await ask(home, { method: DAEMON_METHOD.WORK_STOP, workId: work.id });
    expect(again.ok).toBe(false);
  });
});

describe('the agent side of its work, through memnox-session', () => {
  async function working(): Promise<{
    home: string;
    deps: SessionToolDeps;
    workId: string;
  }> {
    const { home } = await machine();
    const started = await ask(home, {
      method: DAEMON_METHOD.WORK_START,
      workProfile: 'default-claude-code',
      workTarget: 'LIN-5',
    });
    expect(started.ok).toBe(false);
    const work = startedWork(
      {
        profileId: 'default-claude-code',
        responsiblePerson: 'ana',
        target: { source: 'linear', externalId: 'LIN-5' },
      },
      NOW.toISOString(),
    );
    await new AgentWorks(home).write(work);
    // Cast is safe: the work tools read only these fields of their deps.
    const deps = {
      home,
      agent: 'claude-code',
      env: { [SESSION_VAR]: 'ses_9' },
      now: () => NOW,
    } as unknown as SessionToolDeps;
    return { home, deps, workId: work.id };
  }

  it('reads the work its person pointed it at, and reports on it', async () => {
    const { home, deps, workId } = await working();
    const mine = (await myWorkTool(deps)) as { work: { id: string }[] };
    expect(mine.work.map((each) => each.id)).toEqual([workId]);
    await reportProgressTool(deps, { note: 'tests pass', refs: 'commit:abc,bogus:1' });
    await markBlockedTool(deps, { note: 'needs a key' });
    const kept = await new AgentWorks(home).read(workId);
    expect(kept?.status).toBe('blocked');
    expect(kept?.progress.map((each) => [each.by, each.note])).toEqual([
      ['ses_9', 'tests pass'],
      ['ses_9', 'needs a key'],
    ]);
    expect(kept?.progress[0]?.refs).toEqual([{ kind: 'commit', id: 'abc' }]);
  });

  it('can claim done and ask to hand on, but never close or move the work itself', async () => {
    const { home, deps, workId } = await working();
    const done = (await reportProgressTool(deps, {
      note: 'finished',
      state: 'done',
    })) as {
      status: string;
    };
    expect(done.status).toBe('active');
    await reportProgressTool(deps, { note: 'finished', state: 'done_claimed' });
    await requestHandoffTool(deps, { to_profile: 'reviewer', reason: 'ready' });
    const kept = await new AgentWorks(home).read(workId);
    expect(kept?.status).toBe('handoff_requested');
    expect(kept?.profileId).toBe('default-claude-code');
  });
});

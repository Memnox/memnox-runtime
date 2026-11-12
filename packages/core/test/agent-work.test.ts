import { describe, expect, it } from 'vitest';
import {
  branchRefOf,
  externalTaskOf,
  finishedWork,
  HANDOFF_STATE,
  joinedBy,
  MOST_PROGRESS_NOTES,
  sessionTaskOfWork,
  startedWork,
  TRACKER,
  WORK_STATUS,
  withHandoffAnswer,
  withHandoffRequest,
  withProgress,
  type AgentWork,
  type WorkOutcome,
} from '../src/index';

/**
 * Agent work references a tracker's issue and never copies it. A person starts and ends it and
 * answers a handoff; an agent only reports, and can never mark its own work done.
 */

const AT = '2026-11-07T10:00:00.000Z';

function work(): AgentWork {
  return startedWork(
    {
      profileId: 'coder',
      responsiblePerson: 'ana',
      target: { source: TRACKER.LINEAR, externalId: 'LIN-123' },
      projectRoot: '/repo',
    },
    AT,
  );
}

function ok(outcome: WorkOutcome): AgentWork {
  if ('refused' in outcome) throw new Error(outcome.refused);
  return outcome.work;
}

describe('external task references', () => {
  it('read a key, a Linear, Jira, GitHub and Asana link, and nothing else', () => {
    // A bare key names no tracker until the person says which.
    expect(externalTaskOf('lin-123')).toBeNull();
    expect(externalTaskOf('lin-123', TRACKER.LINEAR)).toEqual({
      source: 'linear',
      externalId: 'LIN-123',
    });
    expect(externalTaskOf('PAY-4', TRACKER.JIRA)?.source).toBe('jira');
    expect(externalTaskOf('https://linear.app/acme/issue/LIN-9/fix')?.externalId).toBe(
      'LIN-9',
    );
    expect(externalTaskOf('https://acme.atlassian.net/browse/PAY-42')).toMatchObject({
      source: 'jira',
      externalId: 'PAY-42',
    });
    expect(externalTaskOf('https://github.com/acme/api/pull/17')?.externalId).toBe(
      'acme/api#17',
    );
    expect(externalTaskOf('https://app.asana.com/0/1/1203456789/f')?.externalId).toBe(
      '1203456789',
    );
    expect(externalTaskOf('fix the flaky test')).toBeNull();
  });

  it('match the ref a branch named for the issue declares', () => {
    expect(branchRefOf({ source: TRACKER.LINEAR, externalId: 'LIN-123' })).toBe(
      'ticket:LIN-123',
    );
    expect(branchRefOf({ source: TRACKER.GITHUB, externalId: 'acme/api#17' })).toBeNull();
  });
});

describe('agent work', () => {
  it('starts active with one attempt and an id no workspace brief answers to', () => {
    const started = work();
    expect(started.status).toBe(WORK_STATUS.ACTIVE);
    expect(started.attempts).toBe(1);
    expect(started.id.startsWith('agw_')).toBe(true);
  });

  it('lets an agent report, be blocked or claim done, and never close its own work', () => {
    const blocked = ok(
      withProgress(work(), {
        at: AT,
        by: 'ses_1',
        note: 'waiting on keys',
        state: WORK_STATUS.BLOCKED,
      }),
    );
    expect(blocked.status).toBe(WORK_STATUS.BLOCKED);
    const refused = withProgress(work(), {
      at: AT,
      by: 'ses_1',
      note: 'done',
      state: WORK_STATUS.DONE,
    });
    expect('refused' in refused).toBe(true);
    const claimed = ok(
      withProgress(work(), {
        at: AT,
        by: 'ses_1',
        note: 'done',
        state: WORK_STATUS.DONE_CLAIMED,
      }),
    );
    expect(ok(finishedWork(claimed, { status: WORK_STATUS.DONE, at: AT })).status).toBe(
      WORK_STATUS.DONE,
    );
  });

  it('keeps only the latest notes and only references it understands', () => {
    let current = work();
    for (let index = 0; index < MOST_PROGRESS_NOTES + 5; index += 1)
      current = ok(withProgress(current, { at: AT, by: 'ses_1', note: `step ${index}` }));
    expect(current.progress.length).toBe(MOST_PROGRESS_NOTES);
    const noted = ok(
      withProgress(work(), {
        at: AT,
        by: 'ses_1',
        note: 'pushed',
        refs: [
          { kind: 'commit', id: 'abc123' },
          // Cast is safe: an agent's argument is untrusted, which is what this test sends.
          { kind: 'secret' as 'commit', id: 'x' },
        ],
      }),
    );
    expect(noted.progress[0]?.refs).toEqual([{ kind: 'commit', id: 'abc123' }]);
  });

  it('moves to another profile only once a person accepts the handoff', () => {
    const asked = ok(
      withHandoffRequest(work(), {
        to: { profileId: 'reviewer' },
        reason: 'ready',
        at: AT,
      }),
    );
    expect(asked.status).toBe(WORK_STATUS.HANDOFF_REQUESTED);
    expect(asked.profileId).toBe('coder');
    const handoff = asked.handoffs[0];
    if (handoff === undefined) throw new Error('no handoff');
    const declined = ok(
      withHandoffAnswer(asked, {
        handoffId: handoff.id,
        accepted: false,
        by: 'ana',
        at: AT,
      }),
    );
    expect(declined.profileId).toBe('coder');
    expect(declined.handoffs[0]?.state).toBe(HANDOFF_STATE.DECLINED);
    const accepted = ok(
      withHandoffAnswer(asked, {
        handoffId: handoff.id,
        accepted: true,
        by: 'ana',
        at: AT,
      }),
    );
    expect(accepted).toMatchObject({
      profileId: 'reviewer',
      attempts: 2,
      status: 'active',
    });
    expect(accepted.handoffs[0]?.decidedBy).toBe('ana');
  });

  it('gives a joining session the issue as its task, scoped to the project', () => {
    const joined = joinedBy(work(), 'ses_1', AT);
    expect(joinedBy(joined, 'ses_1', AT).sessions).toEqual(['ses_1']);
    const task = sessionTaskOfWork(joined, 'ses_1', AT);
    expect(task.statement).toBe('LIN-123');
    expect(task.scope).toEqual({ paths: ['/repo/**'] });
  });
});

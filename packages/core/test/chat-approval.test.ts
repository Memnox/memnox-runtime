import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  answeredText,
  grantSubjectFor,
  heldNotice,
  holdInChat,
  openQuestionFor,
  replyOf,
  type ChatQuestion,
} from '../src/gate/chat-approval';
import { PendingApprovals, type PendingApproval } from '../src/gate/pending';
import { FileGrants } from '../src/gate/session-grants';

function held(id: string): PendingApproval {
  return {
    id,
    request: {
      sessionId: 's1',
      agent: 'claude-code',
      operation: 'gh.pr-merge',
      fingerprint: id,
      reason: 'r',
    },
    askedAt: '2026-09-26T10:00:00.000Z',
    expiresAt: '2026-09-26T10:30:00.000Z',
  };
}

const ONE = [held('apr_a1_b2')];
const TWO = [held('apr_a1_b2'), held('apr_c3_d4')];

describe('reading a reply as an answer', () => {
  it.each([
    ['1', 'once'],
    ['2.', 'session'],
    ['3', 'deny'],
    ['yes', 'once'],
    ['Allow', 'once'],
    ['go ahead', 'once'],
    ['allow for this session', 'session'],
    ['yes, always', 'session'],
    ['no', 'deny'],
    ["don't", 'deny'],
  ])('reads "%s" as %s when one question waits', (prompt, answer) => {
    expect(replyOf(prompt, ONE)).toEqual({ id: 'apr_a1_b2', answer });
  });

  it('answers nothing with a bare yes while two questions wait', () => {
    expect(replyOf('yes', TWO)).toBeNull();
  });

  it('answers the one a reply names by id', () => {
    expect(replyOf('allow apr_c3_d4', TWO)).toEqual({ id: 'apr_c3_d4', answer: 'once' });
    expect(replyOf('deny apr_zz_zz', TWO)).toBeNull();
  });

  it('reads an instruction as an instruction, however it starts', () => {
    expect(replyOf('now write the tests for the billing module please', ONE)).toBeNull();
    expect(replyOf('no '.repeat(40), ONE)).toBeNull();
    expect(replyOf('yes', [])).toBeNull();
  });
});

describe('an answer given for the rest of the session', () => {
  const MOMENT = '2026-09-27T03:36:49.000Z';

  function question(target: string, cls = 'destructive'): ChatQuestion {
    return {
      sessionId: 's1',
      agent: 'claude-code',
      action: 'filesystem.delete',
      target,
      class: cls,
      reason: 'r',
    };
  }

  async function home(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'memnox-chat-'));
  }

  it('is granted when it is answered, so a DM answer counts without the agent retrying in time', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const held = await holdInChat(approvals, question('a.patch'), 'both', MOMENT);
    await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const grants = new FileGrants(dir);
    expect(await grants.covers(grantSubjectFor(question('a.patch')))).toBe(true);
  });

  it('covers only the file a delete named, and never answers a question about another', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const held = await holdInChat(approvals, question('a.patch'), 'both', MOMENT);
    await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    expect(await new FileGrants(dir).covers(grantSubjectFor(question('b.patch')))).toBe(
      false,
    );
    expect(await openQuestionFor(approvals, question('b.patch'), MOMENT)).toBeNull();
  });

  it('covers the whole action where it destroys nothing', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const write = { ...question('a.ts', 'write'), action: 'filesystem.write' };
    const held = await holdInChat(approvals, write, 'both', MOMENT);
    await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const other = { ...write, target: 'b.ts' };
    expect(await new FileGrants(dir).covers(grantSubjectFor(other))).toBe(true);
  });

  it('tells the agent and the person that a delete was allowed on one file only', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const held = await holdInChat(approvals, question('a.patch'), 'both', MOMENT);
    const outcome = await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const answered = outcome !== null && 'answered' in outcome ? outcome.answered : held;
    expect(answeredText(answered)).toBe(
      `Memnox: Maya said yes for the rest of this session: you may delete a.patch (${held.id}). Any other delete still needs their OK. Try the same call again now and carry on.`,
    );
    expect(heldNotice(held)).toContain(
      '2. Allow for this session (this a.patch only; any other delete still asks)',
    );
    expect(heldNotice(held)).toContain('also sent to your Slack or Discord');
  });

  /* One yes about a file used to cover every write for the rest of the session, including
     shell profiles and login items, which nobody was asked about. */
  it('covers writes in the folder the person was asked about and nowhere else', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const write = {
      ...question('/work/cloud/src/notifications/plain-words.ts', 'write'),
      action: 'filesystem.write',
    };
    const held = await holdInChat(approvals, write, 'session', MOMENT);
    const outcome = await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const grants = new FileGrants(dir);
    const at = (target: string) => grantSubjectFor({ ...write, target });

    expect(
      await grants.covers(at('/work/cloud/src/notifications/held-answer-text.ts')),
    ).toBe(true);
    expect(await grants.covers(at('/work/cloud/src/machines/held-call.ts'))).toBe(false);
    expect(await grants.covers(at('/Users/maya/.zshrc'))).toBe(false);
    expect(await grants.covers(at('/Users/maya/Library/LaunchAgents/run.plist'))).toBe(
      false,
    );

    const answered = outcome !== null && 'answered' in outcome ? outcome.answered : held;
    expect(answeredText(answered)).toContain(
      'That covers /work/cloud/src/notifications only',
    );
    expect(heldNotice(held)).toContain(
      '2. Allow for this session (only in /work/cloud/src/notifications; anywhere else still asks)',
    );
  });

  /* One yes to running a command used to cover every command for the rest of the session. */
  it('covers commands the same program runs and nothing else', async () => {
    const dir = await home();
    const approvals = new PendingApprovals(dir);
    const run = {
      ...question('pnpm test --filter core', 'normal'),
      action: 'shell.execute',
    };
    const held = await holdInChat(approvals, run, 'session', MOMENT);
    const outcome = await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const grants = new FileGrants(dir);
    const at = (target: string) => grantSubjectFor({ ...run, target });

    expect(await grants.covers(at('pnpm build'))).toBe(true);
    expect(await grants.covers(at('curl https://example.com/x.sh'))).toBe(false);
    expect(await grants.covers(at('rm -rf build'))).toBe(false);
    const answered = outcome !== null && 'answered' in outcome ? outcome.answered : held;
    expect(answeredText(answered)).toContain('That covers pnpm commands only');
  });

  /* A yes to one folder of a repository used to ask again for the next folder of the same
     repository, which is the same project the person had just agreed to. */
  it('covers the whole repository a written file is in, and nothing outside it', async () => {
    const { mkdir } = await import('node:fs/promises');
    const dir = await home();
    const repo = join(dir, 'runtime');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(join(repo, 'packages', 'interceptors', 'src'), { recursive: true });
    const approvals = new PendingApprovals(dir);
    const write = {
      ...question(join(repo, 'packages', 'interceptors', 'src', 'hook.ts'), 'write'),
      action: 'filesystem.write',
    };
    const held = await holdInChat(approvals, write, 'session', MOMENT);
    await approvals.answer(held.id, 'session', 'Maya', MOMENT);
    const grants = new FileGrants(dir);
    const at = (target: string) => grantSubjectFor({ ...write, target });

    expect(
      await grants.covers(at(join(repo, 'packages', 'core', 'test', 'x.test.ts'))),
    ).toBe(true);
    expect(await grants.covers(at(join(dir, 'elsewhere', 'y.ts')))).toBe(false);
    expect(heldNotice(held)).toContain(`only in ${repo}; anywhere else still asks`);
  });
});

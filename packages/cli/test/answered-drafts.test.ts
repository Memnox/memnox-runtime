import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROPOSAL_ANSWER, PROPOSAL_KIND, Proposals } from '@memnox/core';
import { answeredContext, answeredSince } from '../src/daemon/answered-drafts';
import { BY_VOICE, OPERATOR_AGENT } from '../src/session-tools/propose-tools';

const RAISED = '2026-10-19T10:00:00.000Z';
const SPOKE = '2026-10-19T10:00:05.000Z';
const SENT = '2026-10-19T10:00:30.000Z';
const NOW = '2026-10-19T10:02:00.000Z';

async function draft(home: string, label: string, at = RAISED): Promise<string> {
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.WORK,
      toolkit: 'github',
      tool: 'GITHUB_CREATE_AN_ISSUE_COMMENT',
      argumentsText: '{}',
      label,
    },
    rationale: label,
    proposedBy: OPERATOR_AGENT,
    at,
    ttlMs: 5 * 60_000,
  });
  return proposal.id;
}

describe('a draft the person settled while the voice was not listening', () => {
  it('tells a resumed brain the draft went out, as in the voice log', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answered-'));
    const proposals = new Proposals(home);
    const id = await draft(home, 'Comment on pull request 58 in memnox/runtime');
    await proposals.answer(id, PROPOSAL_ANSWER.CONFIRMED, 'person (Touch ID)', SENT);
    await proposals.ran(id, { ok: true, said: 'Comment posted', at: SENT });

    const answered = await answeredSince(home, NOW, SPOKE);
    expect(answered).toEqual([
      'The draft "Comment on pull request 58 in memnox/runtime" was sent with Touch ID.',
    ]);
    expect(answeredContext(answered)).toContain('Never call one waiting');
  });

  it('names a withdrawn, a failed and an expired draft for what they became', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answered-'));
    const proposals = new Proposals(home);
    const dropped = await draft(home, 'Dropped');
    await proposals.answer(dropped, PROPOSAL_ANSWER.DECLINED, BY_VOICE, SENT);
    const failed = await draft(home, 'Failed', '2026-10-19T09:59:00.000Z');
    await proposals.answer(failed, PROPOSAL_ANSWER.CONFIRMED, 'person (Touch ID)', SENT);
    await proposals.ran(failed, { ok: false, said: 'Not Found', at: SENT });
    await draft(home, 'Lapsed', '2026-10-19T09:56:00.000Z');

    const answered = await answeredSince(home, NOW, SPOKE);
    expect(answered).toEqual([
      'The draft "Dropped" was withdrawn, so nothing went out.',
      'The draft "Failed" was confirmed but failed: "Not Found".',
      'The draft "Lapsed" ran out unanswered, so nothing went out.',
    ]);
  });

  it('says nothing of a draft still waiting, or one settled before they last spoke', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answered-'));
    const proposals = new Proposals(home);
    await draft(home, 'Waiting');
    const old = await draft(home, 'Old');
    await proposals.answer(old, PROPOSAL_ANSWER.DECLINED, BY_VOICE, RAISED);

    expect(await answeredSince(home, NOW, SPOKE)).toEqual([]);
    expect(answeredContext([])).toBe('');
  });
});

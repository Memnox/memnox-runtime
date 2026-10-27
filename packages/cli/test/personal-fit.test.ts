import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISPLAY,
  DisplayRequests,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  WORK_ACCOUNT_CHECK,
} from '@memnox/core';
import { answerText } from '../src/session-tools/bounded';
import { openLinkTool, showListTool } from '../src/session-tools/link-tools';
import {
  fittedListing,
  MOST_DATA_CHARS,
  voiceTools,
} from '../src/session-tools/personal-fit';
import { OPERATOR_AGENT } from '../src/session-tools/propose-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { withdrawTool } from '../src/session-tools/withdraw-tool';
import type { PersonalTool } from '../src/sync/personal-work';

/**
 * What the voice reaches in the person's own tools once an answer is fitted to its budget: every write a search
 * ranked first, every item of a listing, and the ways to discard a draft, open a page and put a list on screen.
 */

const NOW = new Date('2026-10-14T09:00:00.000Z');

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-fit-'));
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

/** A tool shaped as the catalogue sends it: a long schema with titles and examples on every input. */
function catalogueTool(slug: string, workClass: 'read' | 'act'): PersonalTool {
  const input = (about: string): Record<string, unknown> => ({
    type: 'string',
    title: about,
    examples: ['octocat', 'my-organization', 'Spoon-Knife', 'my-awesome-project'],
    description: `${about} of the repository, as GitHub names it; not case sensitive and without the .git extension.`,
  });
  return {
    slug,
    name: slug,
    toolkit: 'github',
    workClass,
    description: `${slug} does what its name says, within the specified repository, with options for filtering and pagination.`,
    inputParameters: {
      type: 'object',
      required: ['owner', 'repo', 'issue_number'],
      properties: {
        owner: input('Owner'),
        repo: input('Repo'),
        issue_number: {
          type: 'integer',
          description: 'Number of the issue or pull request.',
        },
        page: { type: 'integer', examples: [1, 2], description: 'Page of results.' },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Which ones.',
        },
      },
    },
  };
}

describe('a tool search fitted to the answer', () => {
  it('keeps the write the search ranked first, which halving the list used to drop', () => {
    const tools = [
      catalogueTool('GITHUB_CREATE_AN_ISSUE_COMMENT', 'act'),
      ...Array.from({ length: 24 }, (_, at) =>
        catalogueTool(`GITHUB_READ_${at}`, 'read'),
      ),
    ];
    const fitted = voiceTools(tools);
    expect(fitted.tools[0]).toMatchObject({
      slug: 'GITHUB_CREATE_AN_ISSUE_COMMENT',
      workClass: 'act',
      needs: { issue_number: 'integer: Number of the issue or pull request.' },
      optional: 'page integer, state open|closed|all',
    });
    expect(JSON.stringify(fitted.tools).length).toBeLessThanOrEqual(MOST_DATA_CHARS);
    expect(fitted.tools.length + fitted.leftOut).toBe(tools.length);
    const answered = JSON.parse(answerText({ tools: fitted.tools })) as {
      tools: Array<{ slug: string }>;
    };
    expect(answered.tools[0]?.slug).toBe('GITHUB_CREATE_AN_ISSUE_COMMENT');
  });
});

describe('a listing fitted to the answer', () => {
  it('keeps every item and names what each lost, rather than cutting items', () => {
    const issues = Array.from({ length: 20 }, (_, at) => ({
      number: at + 1,
      title: `Issue ${at + 1}`,
      html_url: `https://github.com/acme/shop/issues/${at + 1}`,
      isPullRequest: at % 2 === 0,
      body: 'b'.repeat(600),
      created_at: '2026-10-01T10:00:00Z',
    }));
    const fitted = fittedListing(issues);
    const rows = fitted.value as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(20);
    expect(fitted.leftOut).toContain('body');
    expect(rows[19]).toMatchObject({ number: 20, isPullRequest: false });
    expect(rows[0]?.html_url).toBe('https://github.com/acme/shop/issues/1');
    expect(answerText({ data: fitted.value })).not.toContain('left out');
  });
});

describe('a draft taken back by voice', () => {
  async function drafted(deps: SessionToolDeps): Promise<string> {
    const proposal = await new Proposals(deps.home).propose({
      change: {
        kind: PROPOSAL_KIND.WORK,
        toolkit: 'slack',
        tool: 'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL',
        argumentsText: '{"channel":"D1","text":"hi"}',
        label: 'message Pac: hi',
        account: { check: WORK_ACCOUNT_CHECK.MATCHED },
      },
      rationale: 'message Pac',
      proposedBy: OPERATOR_AGENT,
      at: NOW.toISOString(),
      ttlMs: 60_000,
    });
    return proposal.id;
  }

  it('closes the newest one as declined, so its card goes and nothing is sent', async () => {
    const deps = await depsAt();
    const id = await drafted(deps);
    const answer = (await withdrawTool(deps, {})) as { withdrawn: string; said: string };
    expect(answer.withdrawn).toBe(id);
    expect(answer.said).toContain('Discarded');
    const closed = await new Proposals(deps.home).read(id);
    expect(closed?.answer).toBe(PROPOSAL_ANSWER.DECLINED);
    expect(await new Proposals(deps.home).open(NOW.toISOString())).toEqual([]);
  });

  it('never says it discarded anything when nothing waits', async () => {
    const answer = (await withdrawTool(await depsAt(), {})) as {
      withdrawn: boolean;
      said: string;
    };
    expect(answer.withdrawn).toBe(false);
    expect(answer.said).toContain('nothing was discarded');
  });
});

describe('a page or a list put in front of the person', () => {
  it('asks the Mac to open a web address, and nothing else', async () => {
    const deps = await depsAt();
    const opened = (await openLinkTool(deps, {
      url: 'https://github.com/acme/shop/pull/49',
    })) as { opened: string };
    expect(opened.opened).toBe('https://github.com/acme/shop/pull/49');
    const [shown] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(shown).toMatchObject({
      display: DISPLAY.LINK,
      links: ['https://github.com/acme/shop/pull/49'],
    });
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://me:secret@example.com/',
      'not a link',
    ]) {
      const refused = (await openLinkTool(deps, { url })) as { opened: unknown };
      expect(refused.opened).toBe(false);
    }
  });

  it('puts a list on a card that belongs to no session', async () => {
    const deps = await depsAt();
    await showListTool(deps, {
      title: 'Open pull requests',
      text: '- #49 Close the orbit\n- #48 Faster sync',
    });
    const [shown] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(shown).toMatchObject({ display: DISPLAY.CARD, title: 'Open pull requests' });
  });
});

import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  confirmationMessage,
  DISPLAY,
  DisplayRequests,
  PROPOSAL_KIND,
  Proposals,
  WORK_ACCOUNT_CHECK,
  WORK_DRAFT_KIND,
  workDraftOf,
  type WorkAccountCheck,
} from '@memnox/core';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import {
  findToolTool,
  proposeToolTool,
  repositoriesTool,
  runToolTool,
  workspaceGithubTool,
  sentTool,
  signInTool,
} from '../src/session-tools/personal-tools';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { confirmAccountTool, signOutTool } from '../src/session-tools/account-tools';
import { PendingSignIns } from '../src/sync/sign-ins';
import { workDigest, workSubject } from '../src/sync/personal-work';

const NOW = new Date('2026-10-09T09:00:00.000Z');
const COMMENT = 'GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST';
const ARGS =
  '{"owner":"memnox","repo":"runtime","pull_number":412,"body":"Fixed in the last push"}';

interface Seen {
  ran: Array<{ tool: string; argumentsText: string }>;
}

interface World {
  signInFirst?: string[];
  signInAgain?: string[];
  needsAdmin?: string[];
  unknown?: string[];
  check?: WorkAccountCheck;
}

async function depsAt(seen: Seen, world: World = {}): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-personal-'));
  const github = {
    toolkit: 'github',
    account: { externalId: '42', handle: 'maya' },
    check: world.check ?? WORK_ACCOUNT_CHECK.MATCHED,
  };
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
    personalWork: {
      find: async () => ({
        ok: true,
        value: {
          tools: [
            { slug: COMMENT, name: 'Comment', toolkit: 'github', workClass: 'act' },
          ],
          accounts: [github],
          signInFirst: world.signInFirst ?? [],
          signInAgain: world.signInAgain ?? [],
          needsAdmin: world.needsAdmin ?? [],
          unknown: world.unknown ?? [],
        },
      }),
      run: async (tool, argumentsText) => {
        seen.ran.push({ tool, argumentsText });
        return { ok: true, value: { workClass: 'read', data: { messages: [] } } };
      },
      link: async (toolkit) => ({ ok: true, value: `https://consent/${toolkit}` }),
      accounts: async () => ({ ok: true, value: [github] }),
      signOut: async () => ({ ok: true, value: 1 }),
      signIn: async () => ({ ok: true, value: { url: 'https://consent', opened: true } }),
      github: async (read) => ({
        ok: true,
        value: [{ number: read.number ?? 1, title: 'Rate limits' }],
      }),
      repositories: async (all) => ({
        ok: true,
        value: {
          repositories: [
            { name: 'memnox/runtime', isPrivate: true, pushedAt: '2026-10-09T08:00:00Z' },
          ],
          linked: true,
          elsewhere: 2,
          ...(all === true ? { others: [{ name: 'maya/leaderboard-app' }] } : {}),
        },
      }),
    },
  };
}

describe("the person's own tools by voice", () => {
  it('opens the sign in of each tool still to sign in to in front of them', async () => {
    const deps = await depsAt(
      { ran: [] },
      { signInFirst: ['linear'], signInAgain: ['slack'] },
    );
    const found = (await findToolTool(deps, { what: 'move ticket' })) as {
      signIn?: string[];
      said?: string;
    };
    expect(found.signIn).toEqual(['linear', 'slack']);
    const [shown] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(shown?.display).toBe(DISPLAY.SIGN_IN);
    expect(shown?.signIn).toEqual([
      { toolkit: 'linear', url: 'https://consent/linear' },
      { toolkit: 'slack', url: 'https://consent/slack', again: true },
    ]);
    expect(found.said).toContain('sign in is now open in front of them');
  });

  it('says why a tool they named cannot be used rather than reaching for another', async () => {
    const team = await depsAt({ ran: [] }, { needsAdmin: ['airtable'] });
    const waits = (await findToolTool(team, {
      what: 'add a row',
      toolkit: 'airtable',
    })) as {
      said?: string;
    };
    expect(waits.said).toContain('Airtable could not be connected for them');
    expect(waits.said).not.toMatch(/admin/);
    const none = await depsAt({ ran: [] }, { unknown: ['frobly'] });
    const missing = (await findToolTool(none, { what: 'post', toolkit: 'frobly' })) as {
      said?: string;
    };
    expect(missing.said).toContain('never use a different one');
  });

  it('keeps what they asked, so it carries on once they sign in', async () => {
    const deps = await depsAt({ ran: [] }, { signInFirst: ['gmail'] });
    await findToolTool(deps, { what: 'send email', said: 'email Sara the summary' });
    expect(await new PendingSignIns(deps.home).all()).toEqual([
      { toolkit: 'gmail', said: 'email Sara the summary', at: NOW.toISOString() },
    ]);
  });

  it('writes "that account is mine" down for Touch ID, and signs out at once', async () => {
    const deps = await depsAt({ ran: [] }, { check: WORK_ACCOUNT_CHECK.UNVERIFIED });
    const answer = (await confirmAccountTool(deps, { toolkit: 'github' })) as {
      proposed: string;
    };
    const proposal = await new Proposals(deps.home).read(answer.proposed);
    expect(proposal?.change).toEqual({
      kind: PROPOSAL_KIND.ACCOUNT,
      toolkit: 'github',
      label: 'maya on github',
    });
    const out = (await signOutTool(deps, { toolkit: 'github' })) as { done: boolean };
    expect(out.done).toBe(true);
  });

  it('shows nothing in the notch when every tool is signed in', async () => {
    const deps = await depsAt({ ran: [] });
    await findToolTool(deps, { what: 'reply to review' });
    expect(await new DisplayRequests(deps.home).open(NOW.toISOString())).toEqual([]);
  });

  it('runs a read and marks what came back as written by others', async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const read = (await runToolTool(deps, {
      tool: 'GITHUB_LIST_REVIEW_COMMENTS',
      arguments: '{"pull_number":412}',
    })) as { untrusted?: boolean };
    expect(read.untrusted).toBe(true);
    expect(seen.ran).toHaveLength(1);
  });

  it('writes an act down with the account it goes out as, and runs nothing', async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const answer = (await proposeToolTool(deps, {
      tool: COMMENT,
      arguments: ARGS,
      label: 'reply on pull request 412: fixed in the last push',
    })) as { proposed: string; said: string };
    expect(seen.ran).toHaveLength(0);
    expect(answer.said).toContain('As maya on GitHub');
    expect(answer.said).toContain('though not who it goes to');
    const proposal = await new Proposals(deps.home).read(answer.proposed);
    expect(proposal?.change).toEqual({
      kind: PROPOSAL_KIND.WORK,
      toolkit: 'github',
      tool: COMMENT,
      argumentsText: ARGS,
      label: 'reply on pull request 412: fixed in the last push',
      account: { check: WORK_ACCOUNT_CHECK.MATCHED, key: '42', handle: 'maya' },
    });
  });

  it('hands the Mac a draft drawn the way the tool draws it', async () => {
    const deps = await depsAt({ ran: [] });
    await proposeToolTool(deps, {
      tool: COMMENT,
      arguments: ARGS,
      label: 'reply on 412',
    });
    const [event] = await new WaitingFeed(deps.home).current(NOW.toISOString());
    expect(event?.work).toEqual({
      toolkit: 'github',
      tool: COMMENT,
      kind: WORK_DRAFT_KIND.COMMENT,
      account: { check: WORK_ACCOUNT_CHECK.MATCHED, key: '42', handle: 'maya' },
      where: 'memnox/runtime#412',
      body: 'Fixed in the last push',
      fields: [],
    });
  });

  it('writes nothing down through a sign in that reached somebody else', async () => {
    const deps = await depsAt({ ran: [] }, { check: WORK_ACCOUNT_CHECK.MISMATCH });
    const answer = (await proposeToolTool(deps, {
      tool: COMMENT,
      arguments: ARGS,
      label: 'reply on 412',
    })) as { proposed?: string };
    expect(answer.proposed).toBeUndefined();
    const [shown] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(shown?.signIn).toEqual([
      { toolkit: 'github', url: 'https://consent/github', again: true },
    ]);
  });

  it('refuses arguments that are not a JSON object before writing anything', async () => {
    const deps = await depsAt({ ran: [] });
    const answer = (await proposeToolTool(deps, {
      tool: COMMENT,
      arguments: 'merged',
      label: 'reply',
    })) as { proposed?: string };
    expect(answer.proposed).toBeUndefined();
  });

  it('drops the carry on once the voice already reaches the tool, so nothing old is asked again later', async () => {
    const deps = await depsAt({ ran: [] });
    await new PendingSignIns(deps.home).offer({
      toolkit: 'github',
      said: 'reply on the review',
      at: NOW.toISOString(),
    });
    await findToolTool(deps, { what: 'reply to review comment' });
    expect(await new PendingSignIns(deps.home).all()).toEqual([]);
  });

  it('lays out a Gmail reply as a mail with its words in the box', () => {
    const draft = workDraftOf('gmail', 'GMAIL_REPLY_TO_THREAD', {
      thread_id: '18f2',
      recipient_email: 'sara@acme.test',
      message_body: 'Thank you, I will send it soon.',
    });
    expect(draft.kind).toBe(WORK_DRAFT_KIND.EMAIL);
    expect(draft.body).toBe('Thank you, I will send it soon.');
    expect(draft.fields).toEqual([]);
  });

  it('names who a message goes to by name, not by the id the tool takes', () => {
    const draft = workDraftOf(
      'slack',
      'SLACK_SEND_MESSAGE',
      { channel: 'U07AB', text: 'Could you take a look?' },
      { toName: 'Deco Mukendi' },
    );
    expect(draft.to).toEqual(['Deco Mukendi']);
  });

  it('opens the sign in for any tool the person names', async () => {
    const deps = await depsAt({ ran: [] });
    const signed = (await signInTool(deps, { toolkit: 'linear' })) as { said: string };
    expect(signed.said).toContain('Linear sign in is open');
  });

  it('never opens a sign in again for a tool already signed in, unless asked to', async () => {
    const deps = await depsAt({ ran: [] });
    const twice = (await signInTool(deps, { toolkit: 'github' })) as {
      said: string;
      url?: string;
    };
    expect(twice.url).toBeUndefined();
    expect(twice.said).toContain('already signed in to GitHub as maya');
    const again = (await signInTool(deps, { toolkit: 'github', again: 'true' })) as {
      url?: string;
    };
    expect(again.url).toBe('https://consent');
  });

  it('never opens a second page while the first sign in is still waiting', async () => {
    const deps = await depsAt({ ran: [] });
    await signInTool(deps, { toolkit: 'linear', said: 'list my tickets' });
    const second = (await signInTool(deps, {
      toolkit: 'linear',
      said: 'yes start it',
    })) as {
      said: string;
      url?: string;
    };
    expect(second.url).toBeUndefined();
    expect(second.said).toContain('still waiting in their browser');
  });

  it('says whether what they confirmed went out, from what happened', async () => {
    const deps = await depsAt({ ran: [] });
    const proposals = new Proposals(deps.home);
    const work = (label: string) => ({
      change: {
        kind: PROPOSAL_KIND.WORK,
        toolkit: 'slack',
        tool: 'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL',
        argumentsText: '{}',
        label,
      },
      rationale: label,
      proposedBy: 'agt_memnox-operator',
      at: NOW.toISOString(),
      ttlMs: 5 * 60 * 1000,
    });
    const went = await proposals.propose(work('DM to Pac'));
    await proposals.answer(went.id, 'confirmed', 'person (Touch ID)', NOW.toISOString());
    await proposals.ran(went.id, {
      ok: true,
      said: 'confirmed: DM to Pac',
      at: NOW.toISOString(),
    });
    const broke = await proposals.propose(work('DM to Ana'));
    await proposals.answer(broke.id, 'confirmed', 'person (Touch ID)', NOW.toISOString());
    await proposals.ran(broke.id, {
      ok: false,
      said: 'Slack is not connected',
      at: NOW.toISOString(),
    });
    await proposals.propose(work('DM to Deco'));
    const read = (await sentTool(deps)) as {
      sent: Array<{ what: string; state: string; result?: string }>;
    };
    const states = Object.fromEntries(read.sent.map((each) => [each.what, each.state]));
    expect(states).toEqual({
      'DM to Pac': 'sent',
      'DM to Ana': 'failed',
      'DM to Deco': 'waiting',
    });
    expect(read.sent.find((each) => each.what === 'DM to Ana')?.result).toBe(
      'Slack is not connected',
    );
  });

  it('reads a repository through the workspace GitHub App, with no sign in', async () => {
    const deps = await depsAt({ ran: [] });
    const read = (await workspaceGithubTool(deps, {
      repository: 'memnox/runtime',
      what: 'pull',
      number: '412',
    })) as { data: Array<{ number: number }>; untrusted: boolean };
    expect(read.data[0]?.number).toBe(412);
    expect(read.untrusted).toBe(true);
    const missing = (await workspaceGithubTool(deps, { what: 'pulls' })) as {
      said: string;
    };
    expect(missing.said).toContain('owner/repo');
  });

  it('names the repositories the workspace connected', async () => {
    const deps = await depsAt({ ran: [] });
    const read = (await repositoriesTool(deps)) as {
      repositories: Array<{ name: string }>;
    };
    expect(read.repositories.map((each) => each.name)).toEqual(['memnox/runtime']);
  });

  it('answers with the linked repository and only counts the rest the App can reach', async () => {
    const deps = await depsAt({ ran: [] });
    const read = (await repositoriesTool(deps)) as { said: string; others?: unknown };
    expect(read.said).toContain('linked as its own');
    expect(read.said).toContain('2 more');
    expect(read.others).toBeUndefined();
    const every = (await repositoriesTool(deps, { all: 'true' })) as {
      others: Array<{ name: string }>;
    };
    expect(every.others.map((each) => each.name)).toEqual(['maya/leaderboard-app']);
  });

  it('lets the Mac app connect this machine through the voice surface', () => {
    expect(isVoiceMethod('machine')).toBe(true);
    expect(isVoiceMethod('machine-sign-in')).toBe(true);
    expect(isVoiceMethod('machine-sign-out')).toBe(true);
  });

  it('lays out a Slack message and a mail with every argument shown', () => {
    expect(
      workDraftOf('slack', 'SLACK_SEND_MESSAGE', {
        channel: 'D123',
        text: 'merged',
        unfurl: false,
      }),
    ).toEqual({
      toolkit: 'slack',
      tool: 'SLACK_SEND_MESSAGE',
      kind: WORK_DRAFT_KIND.MESSAGE,
      to: ['D123'],
      body: 'merged',
      fields: [{ name: 'unfurl', value: 'false' }],
    });
    const mail = workDraftOf('gmail', 'GMAIL_SEND_EMAIL', {
      recipient_email: 'sara@acme.test',
      subject: 'Summary',
      body: 'Here it is',
    });
    expect(mail.kind).toBe(WORK_DRAFT_KIND.EMAIL);
    expect(mail.to).toEqual(['sara@acme.test']);
    expect(mail.subject).toBe('Summary');
  });

  it('signs the same words the control plane checks', () => {
    const digest = createHash('sha256').update(`${COMMENT}\n${ARGS}`).digest('hex');
    expect(confirmationMessage(workSubject('prp_1'), workDigest(COMMENT, ARGS))).toBe(
      `memnox-confirm:v1:work:prp_1:${digest}`,
    );
  });
});

import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  DECISION_EFFECT,
  EXECUTION,
  isWorkspaceTool,
  MEMORY_SCOPE,
  MEMORY_SOURCE_KIND,
  MEMORY_STATUS,
  PROPOSAL_KIND,
  Proposals,
  SqliteEventStore,
  SqliteMemoryStore,
  SYNC_KIND,
  WORK_ACCOUNT_CHECK,
  writePolicyDocumentFile,
  type MemnoxEvent,
} from '@memnox/core';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { appRunTool, appsTool, appWorkClass } from '../src/session-tools/app-calls';
import {
  AGENT_SIGN_IN_FIRST,
  ACCOUNT_REQUIRED,
  VOICE_SIGN_IN_FIRST,
} from '../src/sync/cloud-account';
import { registerPolicyFile } from '../src/policy-registry';
import { readMemorySource } from '../src/memory/memory-read';
import { itemsView } from '../src/memory/memory-views';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { usesOf, withUses } from '../src/daemon/app-uses';
import { answerConnections } from '../src/daemon/connection-calls';
import { localSyncItems } from '../src/personal-sync/local-items';
import { confirmItem } from '../src/memory/memory-learn';

const NOW = new Date('2026-10-31T09:00:00.000Z');
const AGENT = 'claude-code';
const LIST = 'GITHUB_LIST_REPOSITORY_ISSUES';
const CREATE = 'GITHUB_CREATE_AN_ISSUE';
const ARGS = '{"owner":"memnox","repo":"runtime","state":"open"}';
const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const ISSUES = {
  issues: [
    { number: 412, title: 'Releases ship on Thursdays only', body: `ci token ${TOKEN}` },
  ],
};

interface Seen {
  ran: Array<{ tool: string; argumentsText: string }>;
}

async function depsAt(
  seen: Seen,
  world: { signedIn?: boolean; runRefusal?: { said: string; code?: string } } = {},
): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-agent-apps-'));
  const github = {
    toolkit: 'github',
    account: { externalId: '42', handle: 'maya' },
    check: WORK_ACCOUNT_CHECK.MATCHED,
  };
  return {
    home,
    cwd: home,
    agent: AGENT,
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
            { slug: LIST, name: 'List issues', toolkit: 'github', workClass: 'read' },
            { slug: CREATE, name: 'Create issue', toolkit: 'github', workClass: 'act' },
            {
              slug: 'LOCAL:files:read',
              name: 'Read',
              toolkit: 'files',
              workClass: 'read',
              local: true,
            },
          ],
          accounts: [github],
          signInFirst: ['linear'],
          signInAgain: [],
          needsAdmin: [],
          unknown: [],
        },
      }),
      run: async (tool, argumentsText) => {
        seen.ran.push({ tool, argumentsText });
        return world.runRefusal === undefined
          ? { ok: true, value: { workClass: 'read', data: ISSUES } }
          : { ok: false, ...world.runRefusal };
      },
      link: async (toolkit) => ({ ok: true, value: `https://consent/${toolkit}` }),
      accounts: async () => ({ ok: true, value: [github] }),
      signOut: async () => ({ ok: true, value: 1 }),
      signIn: async () => ({ ok: true, value: { url: 'https://consent', opened: true } }),
      signedIn: async () => world.signedIn ?? true,
    },
  };
}

async function ledgerOf(home: string): Promise<MemnoxEvent[]> {
  const store = SqliteEventStore.forHome(home);
  try {
    return await store.query({ limit: 50 });
  } finally {
    store.close();
  }
}

/** The person's own agent CLI stood in: it reads the one passage and says what it teaches. */
const extract = async (): Promise<string> =>
  JSON.stringify({
    candidates: [
      {
        kind: 'fact',
        statement: 'Releases ship on Thursdays only.',
        subject: 'releases',
        confidence: 0.8,
        evidenceRefs: [1],
      },
    ],
  });

async function readCalls(home: string): Promise<SqliteMemoryStore> {
  const store = SqliteMemoryStore.forHome(home);
  for (const source of store.sources())
    await readMemorySource(store, source, {
      reach: { secret: async () => undefined, fetch },
      extract,
      now: () => NOW,
    });
  return store;
}

describe("an agent's connected apps through Memnox", () => {
  it('finds tools in connected apps only, and says what is not connected yet', async () => {
    const deps = await depsAt({ ran: [] });
    const found = (await appsTool(deps, { what: 'open issues' })) as {
      tools: Array<{ slug: string }>;
      said: string;
    };
    expect(found.tools.map((each) => each.slug)).toEqual([LIST, CREATE]);
    expect(found.said).toContain('linear');
    expect(found.said).toContain('Touch ID');
  });

  it('runs a read at once and records it by name only', async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const answer = (await appRunTool(deps, { tool: LIST, arguments: ARGS })) as {
      data: unknown;
      untrusted: boolean;
    };
    expect(seen.ran).toEqual([{ tool: LIST, argumentsText: ARGS }]);
    expect(answer.untrusted).toBe(true);
    const [row, ...rest] = await ledgerOf(deps.home);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      agent: AGENT,
      operation: `app.github.${LIST}`,
      target: 'github',
      class: 'read',
      effect: DECISION_EFFECT.ALLOW,
      execution: EXECUTION.COMPLETED,
    });
    const written = JSON.stringify(row);
    expect(written).not.toContain('runtime');
    expect(written).not.toContain('Thursdays');
    expect(row?.argsDigest).toBeUndefined();
  });

  it("keeps a read's content in the person's own memory, redacted, and learns from it as that agent's candidate", async () => {
    const deps = await depsAt({ ran: [] });
    await appRunTool(deps, { tool: LIST, arguments: ARGS });
    const store = await readCalls(deps.home);
    try {
      const [source] = store.sources();
      expect(source).toMatchObject({
        kind: MEMORY_SOURCE_KIND.APP_CALLS,
        name: 'github',
        scope: MEMORY_SCOPE.PERSONAL,
        trust: 'tainted',
      });
      const [file] = await readdir(source?.location ?? '');
      const kept = await readFile(join(source?.location ?? '', file ?? ''), 'utf8');
      expect(kept).toContain('Thursdays');
      expect(kept).not.toContain(TOKEN);
      expect(kept).toContain('[redacted]');
      const [item] = store.items({});
      expect(item).toMatchObject({
        status: MEMORY_STATUS.CANDIDATE,
        suggestedBy: AGENT,
        tainted: true,
        scope: MEMORY_SCOPE.PERSONAL,
      });
      const view = itemsView(store, store.items({}), 1).items[0];
      expect(view?.evidence[0]?.document).toBe(file?.replace(/\.json$/, ''));
      expect(view?.evidence[0]?.call).toEqual({
        via: 'app',
        agent: AGENT,
        sessionId: `ses_tools_${AGENT}`,
        app: 'github',
        tool: LIST,
        at: NOW.toISOString(),
      });
    } finally {
      store.close();
    }
  });

  it('never carries what an agent read into personal sync, even once the person confirms it', async () => {
    const deps = await depsAt({ ran: [] });
    await appRunTool(deps, { tool: LIST, arguments: ARGS });
    const store = await readCalls(deps.home);
    try {
      const [item] = store.items({});
      await confirmItem(deps.home, store, item?.id ?? '', NOW);
      store.add(
        {
          kind: 'fact',
          statement: 'The person prefers short commits.',
          subject: 'commits',
          scope: MEMORY_SCOPE.PERSONAL,
          origin: 'person',
          tainted: false,
          evidence: [],
        },
        NOW.toISOString(),
      );
      const own = store.items({ statuses: [MEMORY_STATUS.CANDIDATE] })[0];
      await confirmItem(deps.home, store, own?.id ?? '', NOW);
    } finally {
      store.close();
    }
    const synced = (await localSyncItems(deps.home)).filter(
      (each) => each.kind === SYNC_KIND.MEMORY,
    );
    const said = JSON.stringify(synced);
    expect(said).toContain('short commits');
    expect(said).not.toContain('Thursdays');
  });

  it('puts a write on the Mac for Send and Touch ID by default, and runs nothing', async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const args = '{"owner":"memnox","repo":"runtime","title":"Flaky test"}';
    const answer = (await appRunTool(deps, {
      tool: CREATE,
      arguments: args,
      label: 'Open an issue about the flaky test',
    })) as { proposed: string; said: string };
    expect(seen.ran).toEqual([]);
    const proposal = await new Proposals(deps.home).read(answer.proposed);
    expect(proposal).toMatchObject({
      proposedBy: AGENT,
      change: {
        kind: PROPOSAL_KIND.WORK,
        toolkit: 'github',
        tool: CREATE,
        argumentsText: args,
      },
    });
    const [event] = await new WaitingFeed(deps.home).current(NOW.toISOString());
    expect(event?.agentAsked).toBe(true);
    expect(event?.agent).toBe(AGENT);
    const [row] = await ledgerOf(deps.home);
    expect(row).toMatchObject({ effect: DECISION_EFFECT.ASK, class: 'write' });
    expect(await appRunTool(deps, { proposal: answer.proposed })).toMatchObject({
      waiting: true,
    });
  });

  it('asks for a label before a write goes on the card', async () => {
    const deps = await depsAt({ ran: [] });
    expect(await appRunTool(deps, { tool: CREATE, arguments: '{}' })).toMatchObject({
      done: false,
    });
    expect(await new Proposals(deps.home).since('2000-01-01')).toEqual([]);
  });

  it("refuses what the person's rules deny, and proposes nothing", async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const path = join(deps.home, 'memnox.policies.toml');
    await writePolicyDocumentFile(path, {
      version: 1,
      policies: [
        {
          name: 'no-github-from-agents',
          match: { actions: ['app.github.*'] },
          decision: {
            effect: DECISION_EFFECT.DENY,
            reason: 'GitHub is off limits to agents',
          },
        },
      ],
    });
    await registerPolicyFile(deps.home, path);
    const read = (await appRunTool(deps, { tool: LIST, arguments: ARGS })) as {
      refused: boolean;
    };
    const write = (await appRunTool(deps, {
      tool: CREATE,
      arguments: '{}',
      label: 'Open an issue',
    })) as { refused: boolean };
    expect(read.refused).toBe(true);
    expect(write.refused).toBe(true);
    expect(seen.ran).toEqual([]);
    expect(await new Proposals(deps.home).since('2000-01-01')).toEqual([]);
    expect((await ledgerOf(deps.home)).map((each) => each.effect)).toEqual([
      DECISION_EFFECT.DENY,
      DECISION_EFFECT.DENY,
    ]);
  });

  it('holds a read the rules ask about for the signed yes, as a write is', async () => {
    const seen: Seen = { ran: [] };
    const deps = await depsAt(seen);
    const path = join(deps.home, 'memnox.policies.toml');
    await writePolicyDocumentFile(path, {
      version: 1,
      policies: [
        {
          name: 'ask-before-mail',
          match: { actions: ['mcp.github.*'] },
          decision: { effect: DECISION_EFFECT.ASK },
        },
      ],
    });
    await registerPolicyFile(deps.home, path);
    const answer = await appRunTool(deps, {
      tool: LIST,
      arguments: ARGS,
      label: 'Read issues',
    });
    expect(answer).toHaveProperty('proposed');
    expect(seen.ran).toEqual([]);
  });

  it('answers that a Memnox Cloud sign in is needed when nobody is signed in, in the words the voice uses', async () => {
    const signedOut = await depsAt({ ran: [] }, { signedIn: false });
    expect(await appRunTool(signedOut, { tool: LIST, arguments: ARGS })).toMatchObject({
      signInNeeded: true,
      said: AGENT_SIGN_IN_FIRST,
    });
    expect(await appsTool(signedOut, { what: 'issues' })).toMatchObject({
      signInNeeded: true,
    });
    const refused = await depsAt(
      { ran: [] },
      { runRefusal: { said: VOICE_SIGN_IN_FIRST, code: ACCOUNT_REQUIRED } },
    );
    expect(await appRunTool(refused, { tool: LIST, arguments: ARGS })).toMatchObject({
      said: AGENT_SIGN_IN_FIRST,
    });
    const first = VOICE_SIGN_IN_FIRST.slice(0, VOICE_SIGN_IN_FIRST.indexOf('.') + 1);
    expect(AGENT_SIGN_IN_FIRST.startsWith(first)).toBe(true);
  });

  it('classes a slug as the cloud does, by its verb', () => {
    expect(appWorkClass(LIST, 'github')).toBe('read');
    expect(appWorkClass('GITHUB_PULLS_GET', 'github')).toBe('read');
    expect(appWorkClass('SLACK_SEND_MESSAGE_AND_GET_LINK', 'slack')).toBe('act');
    expect(appWorkClass(CREATE, 'github')).toBe('act');
  });

  it('is never ruled on twice: the hook leaves the app tools to rule on the call they carry', () => {
    expect(isWorkspaceTool('memnox-session', 'app_run')).toBe(true);
    expect(isWorkspaceTool('memnox-session', 'rewind')).toBe(false);
    expect(isWorkspaceTool('memnox-session', 'app_run', () => true)).toBe(false);
  });

  it('names the agents that used each app lately on the connections list', async () => {
    const deps = await depsAt({ ran: [] });
    await appRunTool(deps, { tool: LIST, arguments: ARGS });
    const rows = await ledgerOf(deps.home);
    const uses = usesOf(rows);
    expect(uses.get('github')).toEqual([
      { agent: AGENT, sessionId: `ses_tools_${AGENT}`, at: NOW.toISOString() },
    ]);
    expect(withUses([{ toolkit: 'gmail', connected: true }], uses)).toEqual([
      { toolkit: 'gmail', connected: true },
    ]);
    const answer = await answerConnections(
      { id: 1, method: DAEMON_METHOD.CONNECTIONS_LIST },
      deps.home,
      async () => ({ ok: true, value: [{ toolkit: 'github', connected: true }] }),
      async () => [],
      async () => uses,
    );
    expect(answer.connections?.[0]?.usedBy?.[0]?.agent).toBe(AGENT);
  });
});

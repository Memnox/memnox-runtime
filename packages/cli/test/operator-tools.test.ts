import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ACTION,
  DisplayRequests,
  renderNotes,
  SpokenInstructions,
  HOLD_ANSWER,
  MEMNOX_HOME,
  Milestones,
  NodeGit,
  NodeWorktree,
  PendingApprovals,
  PROPOSAL_KIND,
  Proposals,
  selfProtection,
  SessionHosts,
  SessionPauses,
  SessionSubagents,
  SessionTasks,
  SessionTurns,
  SqliteEventStore,
  type HoldRequest,
  writeWorkspaceMemory,
  type MemnoxEvent,
  VoiceFocusStore,
} from '@memnox/core';
import {
  callOperatorTool,
  OPERATOR_CATALOGUE,
  OPERATOR_TOOLS,
} from '../src/session-tools/operator-tools';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { FOCUS_STARTED } from '../src/session-tools/focus';
import { registerPolicyFile } from '../src/policy-registry';
import { machinePolicyPath } from '../src/protect/machine-rules';
import { OPERATOR_AGENT } from '../src/session-tools/propose-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { sendInstructionTool } from '../src/session-tools/instruct-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';
import { serveSession } from '../src/session-tools/session-server';

/**
 * The voice's brain reads everything and writes only proposals. These are the tests that
 * would fail the day one of its tools could put something in force on its own.
 */

const NOW = new Date('2026-09-30T12:00:00.000Z');
const TWO_MINUTES = 120_000;

const HELD: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

function milestonesIn(place: string): Milestones {
  return new Milestones(new NodeGit(place), new NodeWorktree(place));
}

const SEAMS: RewindSeams = {
  build: milestonesIn,
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-operator-'));
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async (place) =>
      milestonesIn(place)
        .list()
        .catch(() => []),
    brief: async () => null,
  };
}

function event(
  sessionId: string,
  agent: string,
  over: Partial<MemnoxEvent>,
): MemnoxEvent {
  return {
    id: `evt_${sessionId}_${over.operation ?? 'x'}_${over.at ?? ''}`,
    schemaVersion: 1,
    at: '2026-09-30T11:00:00.000Z',
    sessionId,
    agent,
    actorType: 'agent',
    surface: 'filesystem',
    operation: 'filesystem.write',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

async function recorded(home: string, events: MemnoxEvent[]): Promise<void> {
  const store = SqliteEventStore.forHome(home);
  for (const each of events) await store.append(each);
  store.close();
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** A commit dated in the past, so it sits before a session recorded on the fixed clock. */
function gitAt(cwd: string, moment: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_COMMITTER_DATE: moment, GIT_AUTHOR_DATE: moment },
  });
}

/** A file's time on disk set to a moment, as a command running then would have left it. */
async function stamp(path: string, moment: string): Promise<void> {
  const when = new Date(moment);
  await utimes(path, when, when);
}

describe('what the operator is offered', () => {
  it("reads, and writes nothing but a proposal, a pause, a watch, the person's answer to their agent's question in its picker or its terminal, their words typed into an agent's app, an app they named stopped or closed, a word they were misheard saying, what they told it about themselves, its own screenshots forgotten, a folder to open or make, a draft it put up withdrawn, a page opened, a list put on screen, an ask to another owner for their agent's lines or the answer to one, an incident taken, an exception refused, or a request to show or start what the person said yes to", () => {
    for (const tool of OPERATOR_TOOLS) {
      if (tool.annotations.readOnlyHint) continue;
      expect(tool.name).toMatch(
        /^(propose_|show$|pause_session$|pause_agent$|send_instruction$|type_in_app$|control_app$|answer_question$|answer_agent$|watch_for$|walk_through$|start_session$|show_agents$|memnox_command$|traces$|remember_word$|forget_word$|remember_about_me$|forget_about_me$|forget_screen$|open_folder$|create_folder$|withdraw$|open_link$|search_web$|show_list$|ask_for_lines$|answer_ask_for_lines$|message_person$|answer_person$|acknowledge_incident$|reject_exception$)/,
      );
    }
  });

  it('offers nothing that allows, approves, grants or trusts outright', () => {
    for (const tool of OPERATOR_TOOLS) {
      for (const word of ['allow', 'approve', 'grant', 'trust', 'unfreeze', 'mode']) {
        expect(tool.name).not.toContain(word);
      }
    }
  });

  it('is governed like any agent: it may not approve or write what governs it', () => {
    expect(
      selfProtection({ action: 'memnox.approve', target: 'approve apr_1' }),
    ).not.toBeNull();
    expect(
      selfProtection({
        action: ACTION.FILESYSTEM_WRITE,
        target: '/Users/someone/.memnox/proposals/prp_1.json',
      }),
    ).not.toBeNull();
    expect(
      selfProtection({
        action: ACTION.FILESYSTEM_WRITE,
        target: '/work/shop/memnox.policies.toml',
      }),
    ).not.toBeNull();
  });
});

describe('answering a held call from what the person said', () => {
  it('refuses at once on a deny, since saying no can do no harm', async () => {
    const deps = await depsAt();
    const held = await new PendingApprovals(deps.home).raise(
      HELD,
      NOW.toISOString(),
      TWO_MINUTES,
    );

    const answer = await callOperatorTool(deps, SEAMS, 'propose_answer', {
      call: held.id,
      answer: HOLD_ANSWER.DENY,
      said: 'no, not on main',
    });

    expect(answer).toMatchObject({ answered: held.id, answer: HOLD_ANSWER.DENY });
    expect((await new PendingApprovals(deps.home).read(held.id))?.answer).toBe(
      HOLD_ANSWER.DENY,
    );
    const store = SqliteEventStore.forHome(deps.home);
    const rows = await store.query({ sessionId: HELD.sessionId, limit: 10 });
    store.close();
    expect(rows[0]?.reason).toContain('saying "no, not on main"');
  });

  it("only proposes an allow, keeping the person's words, and leaves the call held", async () => {
    const deps = await depsAt();
    const held = await new PendingApprovals(deps.home).raise(
      HELD,
      NOW.toISOString(),
      TWO_MINUTES,
    );

    const answer = await callOperatorTool(deps, SEAMS, 'propose_answer', {
      call: held.id,
      answer: HOLD_ANSWER.ONCE,
      said: 'yeah go ahead, just this once',
    });

    expect(answer).toHaveProperty('proposed');
    expect((await new PendingApprovals(deps.home).read(held.id))?.answer).toBeUndefined();
    const [proposal] = await new Proposals(deps.home).open(NOW.toISOString());
    expect(proposal).toMatchObject({
      rationale: 'yeah go ahead, just this once',
      proposedBy: OPERATOR_AGENT,
      change: {
        kind: PROPOSAL_KIND.ANSWER,
        pendingId: held.id,
        answer: HOLD_ANSWER.ONCE,
      },
    });
    // Never outlives the call it answers.
    expect(proposal?.expiresAt).toBe(held.expiresAt);
  });

  it('turns down an answer a voice cannot give, and a call nobody is waiting on', async () => {
    const deps = await depsAt();
    const held = await new PendingApprovals(deps.home).raise(
      HELD,
      NOW.toISOString(),
      TWO_MINUTES,
    );

    expect(
      await callOperatorTool(deps, SEAMS, 'propose_answer', {
        call: held.id,
        answer: 'edit',
      }),
    ).toHaveProperty('refused');
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_answer', {
        call: 'apr_gone',
        answer: 'deny',
      }),
    ).toHaveProperty('refused');
  });
});

describe('a rule the person asked for', () => {
  it('is proposed and never written, so it is not in force until Touch ID', async () => {
    const deps = await depsAt();
    const project = join(deps.home, 'shop');
    await mkdir(project);

    const answer = await callOperatorTool(deps, SEAMS, 'propose_rule', {
      action: 'npm.publish',
      effect: 'deny',
      reason: 'nobody publishes from a laptop',
      project,
    });

    expect(answer).toMatchObject({
      rule: { name: 'voice-deny-npm-publish', action: 'npm.publish', effect: 'deny' },
    });
    expect(existsSync(join(project, 'memnox.policies.toml'))).toBe(false);
    const [proposal] = await new Proposals(deps.home).open(NOW.toISOString());
    expect(proposal?.change.kind).toBe(PROPOSAL_KIND.RULES);
  });

  it('names a spoken command the way the engine rules on it', async () => {
    const deps = await depsAt();
    const answer = await callOperatorTool(deps, SEAMS, 'propose_rule', {
      action: 'railway deploy',
      effect: 'deny',
      project: deps.home,
    });
    expect(answer).toMatchObject({
      rule: { action: expect.stringMatching(/^railway\./) },
    });
  });

  it('refuses an effect the engine does not know', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_rule', {
        action: 'npm.publish',
        effect: 'sort-of',
        project: deps.home,
      }),
    ).toHaveProperty('refused');
  });

  it('finds the project by its folder name, and always proposes a full path', async () => {
    const deps = await depsAt();
    const file = join(deps.home, 'memnox-runtime', 'memnox.policies.toml');
    await registerPolicyFile(deps.home, file);
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      action: 'npm.publish',
      effect: 'ask',
      project: 'memnox-runtime',
    })) as { rule: { file: string } };
    expect(answer.rule.file).toBe(file);
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_rule', {
        action: 'npm.publish',
        effect: 'ask',
        project: 'somewhere-else',
      }),
    ).toMatchObject({ refused: expect.stringContaining('memnox-runtime') });
  });

  it('suggests the whole Mac when no project was named, for the person to narrow on the card', async () => {
    const deps = await depsAt();
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      action: 'npm.publish',
      effect: 'deny',
    })) as { rule: { file: string }; places: string[] };
    expect(answer.rule.file).toBe(machinePolicyPath(deps.home));
    expect(answer.places[0]).toBe('This Mac');
  });
});

describe('the operator on the wire', () => {
  it('introduces itself as the operator and lists its own tools', async () => {
    const deps = await depsAt();
    const input = new PassThrough();
    const output = new PassThrough();
    const replies: { id?: number; result?: Record<string, unknown> }[] = [];
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter((each) => each !== '')) {
        const reply = JSON.parse(line) as {
          id?: number;
          result?: Record<string, unknown>;
        };
        replies.push(reply);
        if (reply.id === 2) input.end();
      }
    });
    const served = serveSession({
      input,
      output,
      deps,
      seams: {
        // Listing tools never rewinds, so the milestone builder is never reached.
        build: () => null as never,
        unattended: () => true,
        terminal: () => false,
      },
      catalogue: OPERATOR_CATALOGUE,
    });
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`,
    );
    await served;

    const info = replies.find((each) => each.id === 1)?.result?.['serverInfo'];
    expect(info).toMatchObject({ name: 'memnox-operator' });
    const tools = replies.find((each) => each.id === 2)?.result?.['tools'] as {
      name: string;
    }[];
    expect(tools.map((each) => each.name)).toContain('propose_rule');
  });
});

describe('more than one session at once', () => {
  it('lists every session, so two Claude sessions are two rows and not the newest one', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_checkout', 'claude-code', { at: '2026-09-30T11:00:00.000Z' }),
      event('ses_api', 'claude-code', { at: '2026-09-30T11:30:00.000Z' }),
      event('ses_codex', 'codex', { at: '2026-09-30T11:45:00.000Z' }),
    ]);
    await new SessionTasks(deps.home).declare({
      id: 'tsk_1',
      sessionId: 'ses_checkout',
      statement: 'add order cancellation',
      scope: {},
      declaredAt: '2026-09-30T10:59:00.000Z',
    });

    const claude = (await callOperatorTool(deps, SEAMS, 'sessions', {
      agent: 'claude-code',
    })) as { session: string; task?: string; quietForMinutes: number }[];

    expect(claude.map((each) => each.session)).toEqual(['ses_api', 'ses_checkout']);
    expect(claude[1]?.task).toBe('add order cancellation');
    expect(claude[0]?.quietForMinutes).toBe(30);
    expect((claude[0] as { state?: string }).state).toBe('quiet');
    const everyone = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as unknown[];
    expect(everyone).toHaveLength(3);
  });

  it("lists one conversation once when its edits record under the agent's own id, as on the island", async () => {
    const deps = await depsAt();
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_hosted',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      agentSession: 'conversation-uuid',
      seenAt: '2026-09-30T10:00:00.000Z',
      cwd: deps.home,
    });
    await recorded(deps.home, [
      event('ses_hosted', 'claude-code', {
        surface: 'network',
        operation: 'http.connect',
        target: 'api.anthropic.com',
        at: '2026-09-30T11:00:00.000Z',
      }),
      event('conversation-uuid', 'claude-code', {
        target: join(deps.home, 'cart.ts'),
        at: '2026-09-30T11:30:00.000Z',
      }),
    ]);
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
      actions: number;
      lastActive: string;
    }[];
    expect(rows.map((each) => each.session)).toEqual(['ses_hosted']);
    expect(rows[0]?.actions).toBe(2);
    expect(rows[0]?.lastActive).toBe('2026-09-30T11:30:00.000Z');
  });

  it('says the catch-all session is this Mac and not an agent', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_local', 'an agent', { surface: 'git', operation: 'git.unknown' }),
    ]);
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      notAnAgent?: string;
    }[];
    expect(rows[0]?.notAnAgent).toContain('outside any agent session');
  });

  it('never reads its own run as the session the person asked about', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_work', 'claude-code', {})]);
    const answer = await callOperatorTool(
      { ...deps, env: { MEMNOX_SESSION: 'ses_operator_itself' } },
      SEAMS,
      'replay',
      { agent: 'claude-code' },
    );
    expect(answer).toMatchObject({ sessionId: 'ses_work' });
  });
});

describe('a question about the workspace', () => {
  it('is answered from the memory this Mac pulled, rather than sent to the console', async () => {
    const deps = await depsAt();
    await writeWorkspaceMemory(deps.home, {
      hash: 'm1',
      withheld: 0,
      syncedAt: '2026-09-30T11:00:00.000Z',
      facts: [
        {
          id: 'f_owner',
          kind: 'ownership',
          statement: 'The billing service is owned by Engineering.',
          subject: 'billing',
          verifiedBy: 'ada@acme.test',
        },
      ],
    });

    expect(OPERATOR_TOOLS.map((each) => each.name)).toEqual(
      expect.arrayContaining(['memory', 'brief']),
    );
    expect(await callOperatorTool(deps, SEAMS, 'memory', {})).toMatchObject({
      held: 1,
      facts: [{ statement: 'The billing service is owned by Engineering.' }],
    });
  });
});

describe('a person still talking', () => {
  it('is waited for rather than answered half way', async () => {
    const deps = await depsAt();
    expect(OPERATOR_TOOLS.map((each) => each.name)).toContain('keep_listening');
    expect(await callOperatorTool(deps, SEAMS, 'keep_listening', {})).toEqual({
      listening: true,
    });
  });
});

describe('what a session changed in the code', () => {
  it('lists the files it changed since its first write, and the diff of one', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-repo-'));
    git(repo, 'init', '-q');
    await writeFile(join(repo, 'orders.ts'), 'export const orders = [];\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'start');
    await milestonesIn(repo).take({ at: '2026-09-30T11:00:00.000Z', sessionId: 'ses_1' });
    await writeFile(
      join(repo, 'orders.ts'),
      'export const orders = [];\nexport function cancel(): void {}\n',
    );
    await writeFile(join(repo, 'cancel.test.ts'), 'test();\n');
    await recorded(deps.home, [
      event('ses_1', 'claude-code', { target: join(repo, 'orders.ts') }),
      event('ses_1', 'claude-code', {
        operation: 'file.edit',
        target: join(repo, 'cancel.test.ts'),
        at: '2026-09-30T11:00:05.000Z',
      }),
    ]);

    const files = (await callOperatorTool(deps, SEAMS, 'changes', {
      agent: 'claude-code',
    })) as { files: { total: number; shown: { path: string; status: string }[] } };
    expect(files.files.shown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'cancel.test.ts', status: 'A', added: 1 }),
        expect.objectContaining({ path: 'orders.ts', status: 'M', added: 1, removed: 0 }),
      ]),
    );

    const diff = (await callOperatorTool(deps, SEAMS, 'changes', {
      agent: 'claude-code',
      path: 'orders.ts',
    })) as { diff: { lines: string[] } };
    expect(diff.diff.lines).toContain('+export function cancel(): void {}');
    // Only objects were written, so the person's own index and refs never moved.
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }),
    ).toContain('?? cancel.test.ts');
  });

  it('compares with the last commit when no milestone was taken, and shows only its own files', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-repo-'));
    git(repo, 'init', '-q');
    await writeFile(join(repo, 'orders.ts'), 'export const orders = [];\n');
    await writeFile(join(repo, 'other.ts'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'start');
    await writeFile(
      join(repo, 'orders.ts'),
      'export const orders = [];\nexport function cancel(): void {}\n',
    );
    await writeFile(join(repo, 'other.ts'), 'somebody else\n');
    await recorded(deps.home, [
      event('ses_3', 'claude-code', { target: join(repo, 'orders.ts') }),
    ]);

    const answer = (await callOperatorTool(deps, SEAMS, 'changes', {
      agent: 'claude-code',
    })) as { comparedWith: string; files: { shown: { path: string }[] } };
    expect(answer.comparedWith).toContain('the last commit');
    expect(answer.files.shown.map((each) => each.path)).toEqual(['orders.ts']);

    const diff = (await callOperatorTool(deps, SEAMS, 'changes', {
      agent: 'claude-code',
      path: 'orders.ts',
    })) as { diff: { lines: string[] } };
    expect(diff.diff.lines).toContain('+export function cancel(): void {}');
  });

  it('still shows work the session has already committed', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-repo-'));
    git(repo, 'init', '-q');
    await writeFile(join(repo, 'orders.ts'), 'export const orders = [];\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-30T10:00:00Z', 'commit', '-q', '-m', 'start');
    await writeFile(
      join(repo, 'orders.ts'),
      'export const orders = [];\nexport function cancel(): void {}\n',
    );
    git(repo, 'commit', '-q', '-am', 'add cancel');
    await recorded(deps.home, [
      event('ses_5', 'claude-code', { target: join(repo, 'orders.ts') }),
    ]);

    const answer = (await callOperatorTool(deps, SEAMS, 'changes', {
      agent: 'claude-code',
    })) as { files: { shown: { path: string; added: number }[] } };
    expect(answer.files.shown).toEqual([
      expect.objectContaining({ path: 'orders.ts', added: 1 }),
    ]);
  });

  it('keeps the files a shell command changed while it ran, and not those changed around it', async () => {
    const deps = await depsAt();
    const repo = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-operator-repo-')));
    git(repo, 'init', '-q');
    await mkdir(join(repo, 'Support'));
    await writeFile(join(repo, 'Setup.swift'), 'let logo = nil\n');
    await writeFile(join(repo, 'Other.swift'), 'one\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-30T10:00:00Z', 'commit', '-q', '-m', 'start');
    await writeFile(join(repo, 'Support', 'logo.png'), 'png');
    await writeFile(join(repo, 'Setup.swift'), 'let logo = "logo.png"\n');
    await writeFile(join(repo, 'Other.swift'), 'somebody else\n');
    await stamp(join(repo, 'Support', 'logo.png'), '2026-09-30T11:46:01.000Z');
    await stamp(join(repo, 'Setup.swift'), '2026-09-30T11:47:13.000Z');
    // Another session's edit an hour earlier, in the same tree.
    await stamp(join(repo, 'Other.swift'), '2026-09-30T10:30:00.000Z');
    await recorded(deps.home, [
      event('ses_logo', 'claude-code', {
        target: `${repo}/.`,
        at: '2026-09-30T11:46:00.000Z',
      }),
      event('ses_logo', 'claude-code', {
        operation: 'file.read',
        class: 'read',
        target: `${repo}/Support`,
        at: '2026-09-30T11:46:30.000Z',
      }),
      event('ses_logo', 'claude-code', {
        target: `${repo}/.`,
        at: '2026-09-30T11:47:12.500Z',
      }),
    ]);
    await new SessionTurns(deps.home).prompted(
      'ses_logo',
      'claude-code',
      '2026-09-30T11:45:00.000Z',
    );

    const answer = (await callOperatorTool(deps, SEAMS, 'changes', {
      session: 'ses_logo',
    })) as {
      repository: string;
      files: { shown: { path: string }[] };
      latestTurn: { files: string[] };
    };
    expect(answer.repository).toBe(repo);
    expect(answer.files.shown.map((each) => each.path)).toEqual([
      'Setup.swift',
      'Support/logo.png',
    ]);
    expect(answer.latestTurn.files).toEqual(['Setup.swift', 'Support/logo.png']);
    // The image is what a person sees; a Swift file that imports no UI framework is not.
    expect((answer as unknown as { interfaceFiles: string[] }).interfaceFiles).toEqual([
      'Support/logo.png',
    ]);

    const diff = (await callOperatorTool(deps, SEAMS, 'changes', {
      session: 'ses_logo',
      path: 'setup.swift',
    })) as { path: string; diff: { lines: string[] } };
    expect(diff.path).toBe('Setup.swift');
    expect(diff.diff.lines).toContain('+let logo = "logo.png"');
  });

  it('reads the repository it wrote in last, and names the others', async () => {
    const deps = await depsAt();
    const older = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-operator-repo-')));
    const newer = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-operator-repo-')));
    for (const repo of [older, newer]) {
      git(repo, 'init', '-q');
      await writeFile(join(repo, 'a.ts'), 'one\n');
      git(repo, 'add', '.');
      gitAt(repo, '2026-09-29T10:00:00Z', 'commit', '-q', '-m', 'start');
      // A different length, since git trusts a same sized file stamped in the second it was indexed.
      await writeFile(join(repo, 'a.ts'), 'one, then two\n');
    }
    await recorded(deps.home, [
      event('ses_6', 'claude-code', {
        operation: 'file.edit',
        target: join(older, 'a.ts'),
        at: '2026-09-29T11:00:00.000Z',
      }),
      event('ses_6', 'claude-code', {
        operation: 'file.edit',
        target: join(newer, 'a.ts'),
        at: '2026-09-30T11:00:00.000Z',
      }),
    ]);
    const answer = (await callOperatorTool(deps, SEAMS, 'changes', {
      session: 'ses_6',
    })) as { repository: string; alsoChanged: { repository: string }[] };
    expect(answer.repository).toBe(newer);
    expect(answer.alsoChanged).toEqual([expect.objectContaining({ repository: older })]);
  });

  it('says so when no milestone was taken, rather than inventing a diff', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_2', 'claude-code', {})]);
    expect(
      await callOperatorTool(deps, SEAMS, 'changes', { agent: 'claude-code' }),
    ).toMatchObject({ found: false });
  });
});

describe('telling an agent what the person said', () => {
  async function proposed(deps: SessionToolDeps): Promise<string> {
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_instruction', {
      session: 'ses_work',
      agent: 'claude-code',
      message: 'git push the voice branch',
      said: 'guitar push the voice branch',
    })) as { instruction: string; readBack: string };
    expect(answer.readBack).toBe('git push the voice branch');
    return answer.instruction;
  }

  it('says plainly that OpenClaw cannot be handed work yet, rather than queueing it for nothing', async () => {
    const deps = await depsAt();
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_instruction', {
      session: 'ses_claw',
      agent: 'openclaw',
      message: 'rotate the nginx logs',
    })) as { instruction: string };

    const sent = await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: answer.instruction,
    });

    expect(sent).toMatchObject({ sent: false, how: 'failed' });
    expect(
      await new SpokenInstructions(deps.home, () => NOW).collect('openclaw', 'ses_claw'),
    ).toEqual([]);
  });

  it('starts Hermes on its own session from its command line, since no Mac types on a server', async () => {
    const deps = await depsAt();
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_instruction', {
      session: 'hermes:s_42',
      agent: 'hermes',
      message: 'rotate the nginx logs',
    })) as { instruction: string };
    const resumed: [string, string][] = [];

    const sent = await sendInstructionTool(
      deps,
      { instruction: answer.instruction },
      () => false,
      (sessionId, words) => {
        resumed.push([sessionId, words]);
        return true;
      },
    );

    expect(sent).toMatchObject({ sent: true, how: 'resumed', session: 'hermes:s_42' });
    expect(resumed).toEqual([['hermes:s_42', 'rotate the nginx logs']]);
  });

  it('sends nothing until it is said yes to, and then hands it to a working session at its next pause', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_work',
      'claude-code',
      '2026-09-30T11:50:00.000Z',
    );
    const id = await proposed(deps);
    const inbox = new SpokenInstructions(deps.home, () => NOW);
    expect(await inbox.collect('claude-code', 'ses_work')).toEqual([]);

    expect(
      await callOperatorTool(deps, SEAMS, 'send_instruction', { instruction: id }),
    ).toMatchObject({
      sent: true,
      how: 'queued',
    });
    const notes = await inbox.collect('claude-code', 'ses_work');
    expect(notes.map((each) => each.message)).toEqual(['git push the voice branch']);
    expect(renderNotes(notes)).toContain('It is their own request');
    // Handed over once, and a second send of the same id finds nothing.
    expect(await inbox.collect('claude-code', 'ses_work')).toEqual([]);
    expect(
      await callOperatorTool(deps, SEAMS, 'send_instruction', { instruction: id }),
    ).toMatchObject({
      sent: false,
    });
  });

  it('still hands a typed follow up over at the next step where there is no terminal prompt to type it into', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_work',
      'claude-code',
      '2026-09-30T11:50:00.000Z',
    );
    const id = await proposed(deps);
    expect(
      await sendInstructionTool(deps, { instruction: id }, () => true, undefined, {
        typedWhileWorking: true,
      }),
    ).toMatchObject({ sent: true, how: 'queued' });
  });

  it('puts it in the input of a session waiting in an editor, for the person to send', async () => {
    const deps = await depsAt();
    const turns = new SessionTurns(deps.home);
    await turns.prompted('ses_work', 'claude-code', '2026-09-30T11:00:00.000Z');
    await turns.ended('ses_work', 'claude-code', '2026-09-30T11:10:00.000Z');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_work',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      // In its chat panel, so the terminal the tests run in is never taken for where it waits.
      panel: true,
      seenAt: '2026-09-30T11:00:00.000Z',
      cwd: deps.home,
    });
    const id = await proposed(deps);
    expect(
      await callOperatorTool(deps, SEAMS, 'send_instruction', { instruction: id }),
    ).toMatchObject({
      how: 'prefilled',
    });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'prefill',
      text: 'git push the voice branch',
    });
    expect(
      await new SpokenInstructions(deps.home).collect('claude-code', 'ses_work'),
    ).toEqual([]);
  });

  async function waitingInEditor(): Promise<SessionToolDeps> {
    const deps = await depsAt();
    const turns = new SessionTurns(deps.home);
    await turns.prompted('ses_work', 'claude-code', '2026-09-30T11:00:00.000Z');
    await turns.ended('ses_work', 'claude-code', '2026-09-30T11:10:00.000Z');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_work',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      // In its chat panel, or a run from a terminal reads that terminal as where it waits.
      panel: true,
      seenAt: '2026-09-30T11:00:00.000Z',
      cwd: deps.home,
    });
    return deps;
  }

  it('says nothing over the Mac when it is not allowed to type, and retries only when asked', async () => {
    const base = await waitingInEditor();
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (requestId) => {
        await new DisplayRequests(base.home).deliver(requestId, {
          outcome: 'not-allowed',
          at: NOW.toISOString(),
          reason: 'Memnox is not allowed to type yet',
        });
        return new DisplayRequests(base.home).deliveryOf(requestId);
      },
    };
    const id = await proposed(deps);
    const answer = (await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: id,
    })) as { sent: boolean; how: string; said: string };
    expect(answer).toMatchObject({ sent: false, how: 'not-allowed' });
    expect(answer.said).toContain('Write nothing at all this turn');
    expect(answer.said).toContain('ask you to try again');
  });

  it('sends a used instruction again on a retry rather than reading it back', async () => {
    const answer = (await callOperatorTool(await depsAt(), SEAMS, 'send_instruction', {
      instruction: 'ins_gone',
    })) as { sent: boolean; said: string };
    expect(answer.sent).toBe(false);
    expect(answer.said).toContain('send_instruction straight away');
    expect(answer.said).toContain('Never tell them it expired');
  });

  it('never says it was sent when the Mac said the typing failed', async () => {
    const base = await waitingInEditor();
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (requestId) => {
        await new DisplayRequests(base.home).deliver(requestId, {
          outcome: 'failed',
          at: NOW.toISOString(),
          reason: 'no message box in focus',
        });
        return new DisplayRequests(base.home).deliveryOf(requestId);
      },
    };
    const id = await proposed(deps);
    const answer = (await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: id,
    })) as { sent: boolean; how: string; why: string; said: string };
    expect(answer).toMatchObject({
      sent: false,
      how: 'failed',
      why: 'no message box in focus',
    });
    expect(answer.said).toContain('Do not say it is on its way');
    // Delivered, so the Mac is never asked to type it a second time.
    expect(await new DisplayRequests(deps.home).open(NOW.toISOString())).toEqual([]);
  });

  it('says nothing over the Mac when it already told them what to do', async () => {
    const base = await waitingInEditor();
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (requestId) => {
        await new DisplayRequests(base.home).deliver(requestId, {
          outcome: 'failed',
          at: NOW.toISOString(),
          reason: 'the editor runs the older Memnox extension',
          told: true,
        });
        return new DisplayRequests(base.home).deliveryOf(requestId);
      },
    };
    const answer = (await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: await proposed(deps),
    })) as { sent: boolean; said: string };
    expect(answer.sent).toBe(false);
    expect(answer.said).toContain('already said out loud');
    expect(answer.said).toContain('Write nothing at all this turn');
  });

  it('answers a retry at once when the Mac said the same send would fail again', async () => {
    const base = await waitingInEditor();
    let typed = 0;
    const failing = (reason: string): SessionToolDeps => ({
      ...base,
      delivered: async (requestId) => {
        typed += 1;
        await new DisplayRequests(base.home).deliver(requestId, {
          outcome: 'failed',
          at: NOW.toISOString(),
          reason,
        });
        return new DisplayRequests(base.home).deliveryOf(requestId);
      },
    });
    const lost = failing(
      "none of iTerm's tabs holds it, and sending again would fail the same way",
    );
    await callOperatorTool(lost, SEAMS, 'send_instruction', {
      instruction: await proposed(lost),
    });
    const again = (await callOperatorTool(lost, SEAMS, 'send_instruction', {
      instruction: await proposed(lost),
    })) as { sent: boolean; said: string };
    expect(typed).toBe(1);
    expect(again.sent).toBe(false);
    expect(again.said).toContain('not tried again');
    expect(again.said).toContain('never offer to retry');
  });

  it('tries again when the person can fix what stopped it', async () => {
    const base = await waitingInEditor();
    let typed = 0;
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (requestId) => {
        typed += 1;
        await new DisplayRequests(base.home).deliver(requestId, {
          outcome: 'failed',
          at: NOW.toISOString(),
          reason: 'the Memnox extension is not in Visual Studio Code yet',
        });
        return new DisplayRequests(base.home).deliveryOf(requestId);
      },
    };
    await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: await proposed(deps),
    });
    await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: await proposed(deps),
    });
    expect(typed).toBe(2);
  });

  it('says it started only once the Mac read it back and saw it land', async () => {
    const base = await waitingInEditor();
    const proof = { checked: 'the message box emptied', seen: 'push the branch' };
    const verified: SessionToolDeps = {
      ...base,
      delivered: async () => ({ outcome: 'verified', at: NOW.toISOString(), proof }),
    };
    expect(
      await callOperatorTool(verified, SEAMS, 'send_instruction', {
        instruction: await proposed(verified),
      }),
    ).toMatchObject({
      sent: true,
      proof,
      said: expect.stringContaining('starting on it now'),
    });
    const typed: SessionToolDeps = {
      ...base,
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const unchecked = (await callOperatorTool(typed, SEAMS, 'send_instruction', {
      instruction: await proposed(typed),
    })) as { sent: boolean; said: string };
    expect(unchecked.sent).toBe(true);
    expect(unchecked.said).toContain('could not confirm it yet');
    expect(unchecked.said).not.toContain('starting on it now');
    const silent: SessionToolDeps = { ...base, delivered: async () => null };
    expect(
      await callOperatorTool(silent, SEAMS, 'send_instruction', {
        instruction: await proposed(silent),
      }),
    ).toMatchObject({
      sent: true,
      said: expect.stringContaining('never say it was typed'),
    });
  });

  it('keeps it for the next prompt when the Mac would not take the window', async () => {
    const base = await waitingInEditor();
    const deps: SessionToolDeps = {
      ...base,
      delivered: async () => ({ outcome: 'waiting', at: NOW.toISOString() }),
    };
    const answer = (await callOperatorTool(deps, SEAMS, 'send_instruction', {
      instruction: await proposed(deps),
    })) as { sent: boolean; how: string; said: string };
    expect(answer).toMatchObject({ sent: true, how: 'later' });
    expect(answer.said).toContain('next prompts that session');
    expect(answer.said).toContain('Never say it will pick it up at its next step');
    const queued = await new SpokenInstructions(deps.home, () => NOW).collect(
      'claude-code',
      'ses_work',
    );
    expect(queued).toHaveLength(1);
  });

  it('looks at the screen only through what the Mac saw', async () => {
    const base = await depsAt();
    const sight = {
      app: 'Safari',
      window: 'Pull request',
      image: '/tmp/s.png',
      outline: 'button Merge',
    };
    const seeing: SessionToolDeps = { ...base, seen: async () => sight };
    // The words and the outline go to the brain; the picture stays on the Mac unless how it looks matters.
    const read = await callOperatorTool(seeing, SEAMS, 'look', {});
    expect(read).toMatchObject({ seen: true, app: 'Safari', outline: 'button Merge' });
    expect(read).not.toHaveProperty('image');
    expect(
      await callOperatorTool(seeing, SEAMS, 'look', { visual: 'true' }),
    ).toMatchObject({ image: '/tmp/s.png' });
    const blind: SessionToolDeps = { ...base, seen: async () => null };
    expect(await callOperatorTool(blind, SEAMS, 'look', {})).toMatchObject({
      seen: false,
      said: expect.stringContaining('never describe the screen from a guess'),
    });
    const outlineOnly: SessionToolDeps = {
      ...base,
      seen: async () => ({ app: 'Safari', outline: 'button Merge' }),
    };
    expect(await callOperatorTool(outlineOnly, SEAMS, 'look', {})).toMatchObject({
      seen: true,
      said: expect.stringContaining('Screen Recording'),
    });
  });

  it('says what changed on screen since it last looked, and forgets every capture when asked', async () => {
    const base = await depsAt();
    let text = 'Tests: 3 passed\nBuild ok';
    const deps: SessionToolDeps = {
      ...base,
      seen: async () => ({ app: 'Terminal', image: '/tmp/t.png', text }),
    };
    expect(await callOperatorTool(deps, SEAMS, 'look', {})).not.toHaveProperty('changed');
    text = 'Tests: 2 passed, 1 failed\nBuild ok';
    expect(await callOperatorTool(deps, SEAMS, 'look', {})).toMatchObject({
      changed: { appeared: ['Tests: 2 passed, 1 failed'], gone: ['Tests: 3 passed'] },
    });
    const captures = join(deps.home, MEMNOX_HOME, 'proof');
    await mkdir(captures, { recursive: true });
    await writeFile(join(captures, 'dsp_1-after.png'), 'png');
    expect(await callOperatorTool(deps, SEAMS, 'forget_screen', {})).toMatchObject({
      forgotten: true,
    });
    expect(existsSync(captures)).toBe(false);
  });

  it('refuses a proposal said yes to after it went stale', async () => {
    const deps = await depsAt();
    const id = await proposed(deps);
    const later = { ...deps, now: () => new Date(NOW.getTime() + 10 * 60_000) };
    expect(
      await callOperatorTool(later, SEAMS, 'send_instruction', { instruction: id }),
    ).toMatchObject({
      sent: false,
    });
  });
});

describe('a session whose writes the ledger only partly saw', () => {
  async function workedIn(): Promise<{ deps: SessionToolDeps; repo: string }> {
    const deps = await depsAt();
    const repo = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-operator-repo-')));
    git(repo, 'init', '-q');
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src', 'edited.ts'), 'export const a = 1;\n');
    await writeFile(join(repo, 'src', 'scripted.ts'), 'export const b = 1;\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-30T09:00:00Z', 'commit', '-q', '-m', 'start');
    await writeFile(join(repo, 'src', 'edited.ts'), 'export const a = 2; // edited\n');
    await writeFile(
      join(repo, 'src', 'scripted.ts'),
      'export const b = 2;\nexport const c = 3;\n',
    );
    await stamp(join(repo, 'src', 'scripted.ts'), '2026-09-30T11:20:00.000Z');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_py',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Visual Studio Code',
      seenAt: '2026-09-30T11:00:00.000Z',
      cwd: repo,
    });
    // The edit tool names a path relative to the repository it was opened in.
    await recorded(deps.home, [
      event('ses_py', 'claude-code', {
        operation: 'file.edit',
        target: 'src/edited.ts',
        at: '2026-09-30T11:10:00.000Z',
      }),
    ]);
    const turns = new SessionTurns(deps.home);
    await turns.prompted('ses_py', 'claude-code', '2026-09-30T11:05:00.000Z');
    await turns.ended('ses_py', 'claude-code', '2026-09-30T11:30:00.000Z');
    return { deps, repo };
  }

  it('places a relative edit in its repository, and finds what changed while it worked', async () => {
    const { deps, repo } = await workedIn();
    const answer = (await callOperatorTool(deps, SEAMS, 'changes', {
      session: 'ses_py',
    })) as { repository: string; files: { shown: { path: string; evidence: string }[] } };
    expect(answer.repository).toBe(repo);
    expect(answer.files.shown).toEqual([
      expect.objectContaining({ path: 'src/scripted.ts', evidence: 'turn' }),
      expect.objectContaining({ path: 'src/edited.ts', evidence: 'named' }),
    ]);
  });

  it('keeps every turn, so each stretch of work is known', async () => {
    const deps = await depsAt();
    const turns = new SessionTurns(deps.home);
    await turns.prompted('ses_t', 'claude-code', '2026-09-30T10:00:00.000Z');
    await turns.ended('ses_t', 'claude-code', '2026-09-30T10:05:00.000Z');
    await turns.prompted('ses_t', 'claude-code', '2026-09-30T11:00:00.000Z');
    expect((await turns.read('ses_t'))?.windows).toEqual([
      { promptAt: '2026-09-30T10:00:00.000Z', endedAt: '2026-09-30T10:05:00.000Z' },
      { promptAt: '2026-09-30T11:00:00.000Z' },
    ]);
  });

  it('puts the files and a few changed lines on the summary card', async () => {
    const { deps } = await workedIn();
    const shown = await callOperatorTool(deps, SEAMS, 'show', {
      session: 'ses_py',
      display: 'card',
      title: 'Constants',
      text: 'It changed two constants.',
    });
    expect(shown).toMatchObject({ shown: true, filesOnCard: 2 });
    expect(JSON.stringify(shown)).not.toContain('Visual Studio Code');
    const [card] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(card?.files?.map((each) => each.path)).toEqual([
      'src/scripted.ts',
      'src/edited.ts',
    ]);
    expect(card?.excerpt).toEqual({
      path: 'src/scripted.ts',
      lines: ['-export const b = 1;', '+export const b = 2;', '+export const c = 3;'],
    });
  });
});

describe('what a session reached outside the machine', () => {
  it('names the hosts it fetched and the MCP tools it called, for the session asked about', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_4', 'claude-code', {
        surface: 'network',
        operation: 'http.request',
        target: 'api.github.com',
        class: 'read',
      }),
      event('ses_4', 'claude-code', {
        at: '2026-09-30T11:05:00.000Z',
        surface: 'mcp',
        operation: 'mcp.linear.list_issues',
        class: 'read',
      }),
    ]);
    const answer = (await callOperatorTool(deps, SEAMS, 'outside', {
      agent: 'claude-code',
    })) as { contacts: { kind: string; name: string; operations: string[] }[] };
    expect(
      answer.contacts.map((each) => [each.kind, each.name, each.operations]),
    ).toEqual([
      ['mcp', 'linear', ['list_issues']],
      ['web', 'api.github.com', ['http.request']],
    ]);
  });
});

describe('which branch, and what a session committed', () => {
  it('reads the branch and each commit since the session started, by folder name too', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-runtime-'));
    git(repo, 'init', '-q', '-b', 'feat/voice-answers');
    await writeFile(join(repo, 'orders.ts'), 'one\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-30T10:00:00Z', 'commit', '-q', '-m', 'before the session');
    await writeFile(join(repo, 'orders.ts'), 'two\n');
    gitAt(
      repo,
      '2026-09-30T11:30:00Z',
      'commit',
      '-q',
      '-am',
      'fix(cli): cancel an order',
    );
    await recorded(deps.home, [
      event('ses_6', 'claude-code', { target: join(repo, 'orders.ts') }),
    ]);

    const answer = (await callOperatorTool(deps, SEAMS, 'repository', {
      agent: 'claude-code',
    })) as {
      repositories: { branch: string; commits: { subject: string; files: string[] }[] }[];
    };
    expect(answer.repositories[0]?.branch).toBe('feat/voice-answers');
    expect(answer.repositories[0]?.commits).toEqual([
      expect.objectContaining({
        subject: 'fix(cli): cancel an order',
        files: ['orders.ts'],
      }),
    ]);

    const named = (await callOperatorTool(deps, SEAMS, 'repository', {
      repository: 'runtime',
    })) as { repositories: { name: string }[] };
    expect(named.repositories.map((each) => each.name)).toEqual([basename(repo)]);
  });

  it('reads the git status where a session was opened, though it only ran commands', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-cloud-'));
    git(repo, 'init', '-q', '-b', 'main');
    await writeFile(join(repo, 'orders.ts'), 'one\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-30T10:00:00Z', 'commit', '-q', '-m', 'before the session');
    await writeFile(join(repo, 'orders.ts'), 'two\n');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_commands',
      agent: 'claude-code',
      pid: process.pid,
      seenAt: '2026-09-30T11:00:00.000Z',
      cwd: repo,
    });
    await recorded(deps.home, [
      event('ses_commands', 'claude-code', { surface: 'shell', operation: 'shell.exec' }),
    ]);

    const answer = (await callOperatorTool(deps, SEAMS, 'repository', {
      session: 'ses_commands',
    })) as {
      repositories: { name: string; uncommitted: { total: number; shown: string[] } }[];
    };
    expect(answer.repositories.map((each) => each.name)).toEqual([basename(repo)]);
    expect(answer.repositories[0]?.uncommitted).toEqual({
      total: 1,
      shown: ['M orders.ts'],
    });
  });

  it('reads the last commit on the branch though the session made none', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-cloud-'));
    git(repo, 'init', '-q', '-b', 'main');
    await writeFile(join(repo, 'orders.ts'), 'one\n');
    git(repo, 'add', '.');
    gitAt(repo, '2026-09-28T10:00:00Z', 'commit', '-q', '-m', 'feat: take orders');
    await writeFile(join(repo, 'orders.ts'), 'two\n');
    gitAt(repo, '2026-09-29T10:00:00Z', 'commit', '-q', '-am', 'fix: cancel an order');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_reader',
      agent: 'claude-code',
      pid: process.pid,
      seenAt: '2026-09-30T11:00:00.000Z',
      cwd: repo,
    });
    await recorded(deps.home, [
      event('ses_reader', 'claude-code', { surface: 'shell', operation: 'shell.exec' }),
    ]);

    const answer = (await callOperatorTool(deps, SEAMS, 'repository', {
      session: 'ses_reader',
    })) as {
      repositories: {
        commits: unknown[];
        latestCommits: { sha: string; author: string; subject: string; at: string }[];
      }[];
    };
    const [found] = answer.repositories;
    expect(found?.commits).toEqual([]);
    expect(found?.latestCommits.map((each) => each.subject)).toEqual([
      'fix: cancel an order',
      'feat: take orders',
    ]);
    expect(found?.latestCommits[0]?.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(found?.latestCommits[0]?.author).not.toBe('');
    expect(Date.parse(found?.latestCommits[0]?.at ?? '')).toBe(
      Date.parse('2026-09-29T10:00:00Z'),
    );
  });
});

describe('which session is working right now', () => {
  it('puts the one working now first, and never calls a paused or ended one working', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_old', 'claude-code', { at: '2026-09-30T11:58:00.000Z' }),
      event('ses_now', 'claude-code', { at: '2026-09-30T11:59:00.000Z' }),
      event('ses_gone', 'claude-code', { at: '2026-09-30T11:59:30.000Z' }),
    ]);
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_gone',
      agent: 'claude-code',
      pid: 2_147_483_000,
      seenAt: '2026-09-30T11:59:30.000Z',
    });
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
      state: string;
    }[];
    expect(rows.map((each) => [each.session, each.state])).toEqual([
      ['ses_now', 'working'],
      ['ses_old', 'working'],
      ['ses_gone', 'ended'],
    ]);
  });
});

describe('showing the person a session', () => {
  it('says which session it put up and what it last did, so the voice names the right one', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_7', 'claude-code', { operation: 'git.commit', target: 'main' }),
    ]);
    await new SessionTasks(deps.home).declare({
      id: 'tsk_7',
      sessionId: 'ses_7',
      statement: 'fix the popup card',
      scope: {},
      declaredAt: '2026-09-30T10:59:00.000Z',
    });
    const shown = (await callOperatorTool(deps, SEAMS, 'show', {
      session: 'ses_7',
      display: 'open',
    })) as { showing: Record<string, unknown>; said: string };
    expect(shown.showing).toMatchObject({
      task: 'fix the popup card',
      actions: 1,
      lastDid: 'git.commit main',
    });
    expect(shown.said).toContain('never describe work showing does not list');
  });

  it('asks the app for a card with the summary, and refuses a card with nothing on it', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_7', 'claude-code', {})]);
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        agent: 'claude-code',
        display: 'card',
      }),
    ).toMatchObject({ shown: false });
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        agent: 'claude-code',
        display: 'card',
        title: 'Order cancellation',
        text: 'It added a cancel button and two tests.',
      }),
    ).toMatchObject({ shown: true, display: 'card' });
    const shown = await new WaitingFeed(deps.home).everything(NOW.toISOString());
    expect(shown).toEqual([
      expect.objectContaining({
        kind: 'show',
        display: 'card',
        title: 'Order cancellation',
      }),
    ]);
    // Never listed as waiting on the person, since nothing is.
    expect(await new WaitingFeed(deps.home).current(NOW.toISOString())).toEqual([]);
  });

  it('puts every session up at once when asked for them all, naming none', async () => {
    const deps = await depsAt();
    expect(await callOperatorTool(deps, SEAMS, 'show', { display: 'all' })).toMatchObject(
      {
        shown: true,
        display: 'sessions',
      },
    );
    const shown = await new WaitingFeed(deps.home).everything(NOW.toISOString());
    expect(shown).toEqual([
      expect.objectContaining({
        kind: 'show',
        display: 'sessions',
        title: 'Your sessions',
      }),
    ]);
  });

  it('opens the repository a session worked in when its window was never noted', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-repo-'));
    git(repo, 'init', '-q');
    await recorded(deps.home, [
      event('ses_10', 'claude-code', { target: join(repo, 'orders.ts') }),
    ]);
    expect(
      await callOperatorTool(deps, SEAMS, 'show', {
        agent: 'claude-code',
        display: 'open',
      }),
    ).toMatchObject({ shown: true, display: 'focus' });
    const [shown] = await new WaitingFeed(deps.home).everything(NOW.toISOString());
    expect(shown?.host?.cwd).toContain('memnox-operator-repo-');
  });

  it('opens where a session was just started when asked by the id of its start', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-started-'));
    git(repo, 'init', '-q');
    await new VoiceFocusStore(deps.home).set({
      repository: repo,
      agent: 'claude-code',
      why: FOCUS_STARTED,
      at: NOW.toISOString(),
    });
    await callOperatorTool(deps, SEAMS, 'show', {
      agent: 'claude-code',
      session: 'stt_mv1mibrb_cff5efd1',
      display: 'open',
    });
    const [shown] = await new WaitingFeed(deps.home).everything(NOW.toISOString());
    expect(realpathSync(shown?.host?.cwd ?? '')).toBe(realpathSync(repo));
  });

  it('opens the main checkout, never the worktree an agent made for itself', async () => {
    const deps = await depsAt();
    const repo = await mkdtemp(join(tmpdir(), 'memnox-operator-main-'));
    git(repo, 'init', '-q');
    await writeFile(join(repo, 'orders.ts'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'start');
    const worktree = join(repo, '.claude', 'worktrees', 'agent-1');
    git(repo, 'worktree', 'add', '-q', worktree);
    await recorded(deps.home, [
      event('ses_11', 'claude-code', { target: join(worktree, 'orders.ts') }),
    ]);
    await callOperatorTool(deps, SEAMS, 'show', {
      agent: 'claude-code',
      display: 'open',
    });
    const [shown] = await new WaitingFeed(deps.home).everything(NOW.toISOString());
    expect(shown?.host?.cwd).toBe(realpathSync(repo));
  });

  it('opens a live window on a session only when asked to watch it', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_8', 'claude-code', {})]);
    const shown = await callOperatorTool(deps, SEAMS, 'show', {
      agent: 'claude-code',
      display: 'watch',
    });
    expect(shown).toMatchObject({ shown: true, display: 'open' });
    expect(JSON.stringify(shown)).toContain('live window');
  });

  it('clears every popup at once without naming or closing any session', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'show', { display: 'dismiss' }),
    ).toMatchObject({ dismissed: true });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'dismiss', sessionId: 'all' });
  });

  it('takes the person to the session itself when asked to open it, never a popup', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_9', 'claude-code', {})]);
    const shown = await callOperatorTool(deps, SEAMS, 'show', {
      agent: 'claude-code',
      display: 'open',
    });
    expect(shown).toMatchObject({ shown: true, display: 'focus' });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request?.display).toBe('focus');
  });
});

describe('stopping and restarting a session by voice', () => {
  it('pauses at once, and only proposes the resume, which waits on Touch ID', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [event('ses_9', 'claude-code', {})]);
    expect(
      await callOperatorTool(deps, SEAMS, 'pause_session', {
        agent: 'claude-code',
        said: 'stop that one',
      }),
    ).toMatchObject({ paused: true, session: 'ses_9' });
    expect(await new SessionPauses(deps.home).inForce('ses_9')).toMatchObject({
      signal: 'asked',
    });
    const resumed = (await callOperatorTool(deps, SEAMS, 'propose_resume', {
      agent: 'claude-code',
      said: 'carry on',
    })) as { proposed: string };
    expect(resumed.proposed).toMatch(/^prp_/);
    // Still paused: a spoken yes alone restarts nothing.
    expect(await new SessionPauses(deps.home).inForce('ses_9')).not.toBeNull();
  });

  it('never pauses this Mac itself', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'pause_session', { session: 'ses_local' }),
    ).toMatchObject({ paused: false });
  });
});

describe('a session just opened', () => {
  it('is listed first, but never read in place of the session that did the work', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_older', 'claude-code', { at: '2026-09-30T11:00:00.000Z' }),
    ]);
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_new',
      agent: 'claude-code',
      pid: process.pid,
      app: 'Terminal',
      tty: 'ttys009',
      seenAt: '2026-09-30T11:58:00.000Z',
    });
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
      state: string;
      runningIn?: string;
    }[];
    expect(rows[0]).toMatchObject({
      session: 'ses_new',
      state: 'open',
      runningIn: 'Terminal',
    });
    // Opened after the work finished, it has nothing to read, so "what changed" stays on the work.
    expect(
      await callOperatorTool(deps, SEAMS, 'replay', { agent: 'claude-code' }),
    ).toMatchObject({ sessionId: 'ses_older' });
  });

  it('is read once it has been asked something', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_older', 'claude-code', { at: '2026-09-30T11:00:00.000Z' }),
    ]);
    await new SessionTurns(deps.home).prompted(
      'ses_new',
      'claude-code',
      '2026-09-30T11:58:00.000Z',
    );
    expect(
      await callOperatorTool(deps, SEAMS, 'replay', { agent: 'claude-code' }),
    ).toMatchObject({ sessionId: 'ses_new' });
  });
});

describe('a session that has handed back', () => {
  it('is waiting on the person, not working, however recently it acted', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_done', 'claude-code', { at: '2026-09-30T11:59:00.000Z' }),
    ]);
    await new SessionTurns(deps.home).prompted(
      'ses_done',
      'claude-code',
      '2026-09-30T11:40:00.000Z',
    );
    await new SessionTurns(deps.home).ended(
      'ses_done',
      'claude-code',
      '2026-09-30T11:59:10.000Z',
    );
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      state: string;
      turn?: string;
    }[];
    expect(rows[0]).toMatchObject({ state: 'open', turn: 'handed back to you' });
  });
});

describe("Memnox's own voice brain", () => {
  it('is never listed as a session, since it answers the person and is not their agent', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      event('ses_work', 'claude-code', { at: '2026-09-30T11:59:00.000Z' }),
      event('ses_brain', 'memnox-operator', { at: '2026-09-30T11:59:30.000Z' }),
    ]);
    await new SessionTurns(deps.home).prompted(
      'ses_asked',
      'memnox-operator',
      '2026-09-30T11:59:40.000Z',
    );
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
    }[];
    expect(rows.map((each) => each.session)).toEqual(['ses_work']);
  });
});

describe('a session working with no ledger rows to show for it', () => {
  it('counts a turn still being thought through as working, and lists its helpers', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_think',
      'claude-code',
      '2026-09-30T11:50:00.000Z',
    );
    await new SessionSubagents(deps.home).launched({
      sessionId: 'ses_think',
      description: 'review the voice prompts',
      type: 'Explore',
      background: true,
      at: '2026-09-30T11:51:00.000Z',
    });
    await new SessionSubagents(deps.home).acted({
      sessionId: 'ses_think',
      agentId: 'agent_1',
      type: 'Explore',
      tool: 'Grep',
      at: '2026-09-30T11:59:30.000Z',
    });
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
      state: string;
      turn?: string;
      subagents?: {
        launched: { description: string }[];
        working: { lastTool?: string }[];
      };
    }[];
    expect(rows[0]).toMatchObject({
      session: 'ses_think',
      state: 'working',
      turn: 'in progress',
    });
    expect(rows[0]?.subagents?.launched[0]?.description).toBe('review the voice prompts');
    expect(rows[0]?.subagents?.working[0]?.lastTool).toBe('Grep');
  });
});

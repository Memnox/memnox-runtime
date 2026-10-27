import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DISPLAY,
  DisplayRequests,
  Milestones,
  NodeGit,
  NodeWorktree,
  PROPOSAL_KIND,
  Proposals,
  Clashes,
  RunTerminals,
  SessionHosts,
  SessionStarts,
  SessionTurns,
  SessionWatches,
  SpokenInstructions,
  SqliteEventStore,
  STARTABLE_AGENT,
  VoiceFocusStore,
  writeWorkspaceMemory,
  type DiscoveryReport,
  type EnvironmentSnapshot,
  type MemnoxEvent,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { NoticeWatcher } from '../src/daemon/notice-watch';
import { testRunsIn } from '../src/daemon/transcript';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';
import { showAgentsTool } from '../src/session-tools/agents-tool';
import { repositoryNamed } from '../src/session-tools/known-repositories';
import { callTool } from '../src/session-tools/session-tools';

/**
 * The voice doing things rather than reading them: watching for news, putting work back,
 * starting a session, handing work between agents and walking through a change.
 */

const NOW = new Date('2026-09-30T12:00:00.000Z');

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
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-control-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async (place) =>
      milestonesIn(place)
        .list()
        .catch(() => []),
    brief: async () => null,
    resolveCommand: (agent) => STARTABLE_AGENT[agent],
  };
}

function edit(sessionId: string, target: string, at: string): MemnoxEvent {
  return {
    id: `evt_${sessionId}_${at}`,
    schemaVersion: 1,
    at,
    sessionId,
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'filesystem',
    operation: 'file.edit',
    target,
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
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

/** A repository a session edited after its milestone, the way a real session leaves one. */
async function workedOn(deps: SessionToolDeps, name = 'memnox-cloud'): Promise<string> {
  const parent = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-voice-repos-')));
  const repo = join(parent, name);
  await mkdir(repo);
  git(repo, 'init', '-q');
  await writeFile(join(repo, 'card.ts'), 'export const card = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'start');
  await milestonesIn(repo).take({
    at: '2026-09-30T11:00:00.000Z',
    sessionId: 'ses_work',
  });
  await writeFile(
    join(repo, 'card.ts'),
    'export const card = 2;\nexport const flat = true;\n',
  );
  await recorded(deps.home, [
    edit('ses_work', join(repo, 'card.ts'), '2026-09-30T11:10:00.000Z'),
  ]);
  await new SessionHosts(deps.home).note({
    sessionId: 'ses_work',
    agent: 'claude-code',
    pid: process.pid,
    app: 'iTerm',
    cwd: repo,
    seenAt: '2026-09-30T11:00:00.000Z',
  });
  return repo;
}

describe('telling the person when something they asked about happens', () => {
  it('speaks once when the turn they were waiting on ends, and never again', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_work',
      'claude-code',
      '2026-09-30T11:50:00.000Z',
    );
    expect(
      await callOperatorTool(deps, SEAMS, 'watch_for', {
        session: 'ses_work',
        for: 'finished',
        said: 'tell me when it is done',
      }),
    ).toMatchObject({ watching: true, for: 'finished' });
    const watcher = new NoticeWatcher(deps.home, NOW.toISOString());
    expect(await watcher.look('2026-09-30T12:00:30.000Z')).toEqual([]);

    await new SessionTurns(deps.home).ended(
      'ses_work',
      'claude-code',
      '2026-09-30T12:01:00.000Z',
    );
    const told = await watcher.look('2026-09-30T12:01:30.000Z');
    const watched = told.filter((each) => each.notice === 'watched');
    expect(watched).toHaveLength(1);
    expect(watched[0]?.summary).toContain('it finished its turn');
    expect(watched[0]?.summary).toContain('tell me when it is done');
    expect(await new SessionWatches(deps.home).open('2026-09-30T12:02:00.000Z')).toEqual(
      [],
    );
  });

  it('refuses something it cannot watch for, rather than watching for nothing', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'watch_for', {
        session: 'ses_work',
        for: 'lunch',
      }),
    ).toMatchObject({ watching: false });
  });

  it('reads test runs from the transcript, passed and failed', () => {
    const lines = [
      {
        type: 'assistant',
        timestamp: '2026-09-30T12:00:00.000Z',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-09-30T12:00:10.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: 'Exit code 1\nFAIL',
              is_error: true,
            },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-30T12:01:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't2',
              name: 'Bash',
              input: { command: 'git status' },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-09-30T12:01:01.000Z',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't2', content: 'clean', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-30T12:02:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't3',
              name: 'Bash',
              input: { command: 'npx vitest run cart' },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-09-30T12:02:09.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't3',
              content: 'all passed',
              is_error: false,
            },
          ],
        },
      },
    ];
    expect(testRunsIn(lines.map((each) => JSON.stringify(each)).join('\n'))).toEqual([
      { at: '2026-09-30T12:00:10.000Z', command: 'pnpm test', passed: false },
      { at: '2026-09-30T12:02:09.000Z', command: 'npx vitest run cart', passed: true },
    ]);
  });
});

describe('putting back what a session broke', () => {
  it('proposes the rewind with what goes back, and moves nothing until it is confirmed', async () => {
    const deps = await depsAt();
    const repo = await workedOn(deps);
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rewind', {
      session: 'ses_work',
      said: 'that broke it, put it back',
    })) as { proposed: string; repository: string; files: number };
    expect(answer).toMatchObject({ repository: 'memnox-cloud', files: 1 });
    const proposal = await new Proposals(deps.home).read(answer.proposed);
    expect(proposal?.change).toMatchObject({
      kind: PROPOSAL_KIND.REWIND,
      repository: repo,
    });
    // Proposed only: the file is still as the session left it.
    expect(await readFile(join(repo, 'card.ts'), 'utf8')).toContain('flat');
  });

  it('puts the files back once Touch ID signs for it, and refuses an unsigned yes', async () => {
    const deps = await depsAt();
    const repo = await workedOn(deps);
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    await new ConfirmKeys(deps.home).register(
      spki.subarray(spki.length - 65).toString('base64'),
      NOW.toISOString(),
    );
    const { proposed } = (await callOperatorTool(deps, SEAMS, 'propose_rewind', {
      session: 'ses_work',
    })) as { proposed: string };
    const at = '2026-09-30T12:00:30.000Z';
    expect(
      await confirmAnswer(deps.home, { subject: proposed, answer: 'confirmed', at }),
    ).toMatchObject({ ok: false });
    expect(await readFile(join(repo, 'card.ts'), 'utf8')).toContain('flat');

    const signature = sign(
      'sha256',
      Buffer.from(confirmationMessage(proposed, 'confirmed')),
      privateKey,
    ).toString('base64');
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: 'confirmed',
        signature,
        at,
      }),
    ).toMatchObject({ ok: true });
    expect(await readFile(join(repo, 'card.ts'), 'utf8')).toBe(
      'export const card = 1;\n',
    );
  });

  it('says there is nothing to put back for a session that took no milestone', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_rewind', { session: 'ses_nothing' }),
    ).toMatchObject({ proposed: false });
  });
});

describe('starting a session out loud', () => {
  it('finds the repository by the name said, reads it back, and starts it only once', async () => {
    const deps = await depsAt();
    const repo = await workedOn(deps, 'memnox-runtime');
    const sibling = join(repo, '..', 'memnox-cloud');
    await mkdir(sibling);
    git(sibling, 'init', '-q');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox cloud',
      task: "fix the failing auth test, it's flaky",
    })) as { start: string; repository: string };
    expect(proposed.repository).toBe('memnox-cloud');
    const typed: SessionToolDeps = {
      ...deps,
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    expect(
      await callOperatorTool(typed, SEAMS, 'start_session', { start: proposed.start }),
    ).toMatchObject({ started: true, repository: 'memnox-cloud' });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'launch', cwd: sibling });
    // Quoted whole, so a quote in the task stays words and never ends the command.
    expect(request?.text).toBe(
      `cd '${sibling}' && memnox run -- claude 'fix the failing auth test, it'\\''s flaky'`,
    );
    expect(
      await callOperatorTool(typed, SEAMS, 'start_session', { start: proposed.start }),
    ).toMatchObject({ started: false });
  });

  it('calls it started only once the agent shows itself running in that repository', async () => {
    const base = await depsAt();
    await workedOn(base, 'memnox-runtime');
    const asked: string[] = [];
    const startAs = (seen: boolean): SessionToolDeps => ({
      ...base,
      resolveCommand: () => 'claude',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
      startSeen: async (repository) => {
        asked.push(basename(repository));
        return seen ? 'ses_started' : null;
      },
    });
    const start = async (deps: SessionToolDeps): Promise<unknown> => {
      const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
        repository: 'memnox runtime',
        task: 'fix the build',
      })) as { start: string };
      return callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    };

    const unseen = (await start(startAs(false))) as { said: string };
    expect(unseen).toMatchObject({ started: true, confirmed: false });
    expect(unseen.said).toContain('has not come up yet');
    expect(unseen.said).toContain('never say it is starting');
    const seen = (await start(startAs(true))) as {
      said: string;
      confirmed?: boolean;
      session?: string;
    };
    expect(seen.confirmed).toBeUndefined();
    // Named, so "there" and "that session" mean the one that just started.
    expect(seen.session).toBe('ses_started');
    expect(seen.said).toContain('the agent is starting on the task');
    expect(asked).toEqual(['memnox-runtime', 'memnox-runtime']);
  });

  it('starts in the folder they named over a repository they use whose name only sounds like it', async () => {
    const deps: SessionToolDeps = { ...(await depsAt()), resolveCommand: () => 'claude' };
    await workedOn(deps, 'bacco');
    await mkdir(join(deps.home, 'Documents', 'babco'), { recursive: true });
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', { repository: 'babco' }),
    ).toMatchObject({ proposed: true, repository: 'babco' });

    // With no such folder, the near name is only offered, read back rather than started on a guess.
    const elsewhere: SessionToolDeps = {
      ...(await depsAt()),
      resolveCommand: () => 'claude',
    };
    await workedOn(elsewhere, 'bacco');
    const near = (await callOperatorTool(elsewhere, SEAMS, 'propose_start', {
      repository: 'babco',
    })) as { repository?: string; repositoryFrom?: string };
    expect(near.repository).toBe('bacco');
    expect(near.repositoryFrom).toContain('the closest name');
  });

  it('reads the tab when the agent stops on a question before it starts, and answers it only there', async () => {
    const base = await depsAt();
    const repo = await workedOn(base, 'memnox-runtime');
    const pressed: { text?: string; tty?: string }[] = [];
    let up = false;
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'claude',
      delivered: async (id) => {
        const request = await new DisplayRequests(base.home).read(id);
        if (request?.display === DISPLAY.PRESS) {
          pressed.push({ text: request.text, tty: request.tty });
          up = true;
        }
        return { outcome: 'typed', at: NOW.toISOString() };
      },
      startSeen: async () => (up ? 'ses_run' : null),
      // A yes here would also accept the permissions the folder brings, so it is theirs to give.
      seen: async () => ({
        app: 'Terminal',
        text: 'Do you trust this folder?\nThis folder pre-approves 2 tool permissions in .claude/settings.json\n❯ No, exit\n  Yes, I trust this folder',
      }),
    };
    // The run noted its tab as it came up, before the agent's own hook could.
    await new RunTerminals(base.home).note({
      sessionId: 'ses_run',
      agent: 'claude-code',
      pid: process.pid,
      tty: 'ttys009',
      app: 'Terminal',
      cwd: repo,
      startedAt: NOW.toISOString(),
    });
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox runtime',
      task: 'check the git history',
    })) as { start: string };
    const started = (await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    })) as { session?: string; screen?: string; said: string };
    expect(started.session).toBe('ses_run');
    expect(started.screen).toContain('Do you trust this folder?');
    expect(started.said).toContain('answer_agent');

    // Words are never typed this way, only keys.
    expect(
      await callOperatorTool(deps, SEAMS, 'answer_agent', {
        session: 'ses_run',
        keys: 'yes I trust it',
      }),
    ).toMatchObject({ answered: false });
    expect(pressed).toEqual([]);

    const answered = await callOperatorTool(deps, SEAMS, 'answer_agent', {
      session: 'ses_run',
      keys: 'down enter',
    });
    expect(answered).toMatchObject({ answered: true, session: 'ses_run' });
    expect(pressed).toEqual([{ text: 'down enter', tty: 'ttys009' }]);
  });

  it('knows Claude Code is asking about the folder when the tab cannot be read, from its own record', async () => {
    const base = await depsAt();
    const repo = await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'claude',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
      startSeen: async () => null,
      // Screen Recording is off, so the look answers with nothing to read.
      seen: async () => null,
    };
    // The folder brings settings of its own, so a yes unseen could accept more than the folder.
    await mkdir(join(repo, '.claude'));
    await writeFile(join(repo, '.claude', 'settings.json'), '{}');
    // Claude Code has opened other folders and never this one.
    await writeFile(
      join(base.home, '.claude.json'),
      JSON.stringify({ projects: { '/elsewhere': { hasTrustDialogAccepted: true } } }),
    );
    await new RunTerminals(base.home).note({
      sessionId: 'ses_run',
      agent: 'claude-code',
      pid: process.pid,
      tty: 'ttys009',
      app: 'Terminal',
      cwd: repo,
      startedAt: NOW.toISOString(),
    });
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox runtime',
      task: 'check the git history',
    })) as { start: string };
    const started = (await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    })) as { session?: string; question?: string; answerYes?: string; said: string };
    expect(started.session).toBe('ses_run');
    expect(started.question).toBe('Do you trust the files in this folder?');
    expect(started.answerYes).toBe('down enter');
    expect(started.said).toContain('never told to trust this folder');

    // Once the person said yes there, the same unread tab is only offered a look.
    await writeFile(
      join(base.home, '.claude.json'),
      JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }),
    );
    const again = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox runtime',
      task: 'check the git history',
    })) as { start: string };
    const second = (await callOperatorTool(deps, SEAMS, 'start_session', {
      start: again.start,
    })) as { question?: string; said: string };
    expect(second.question).toBeUndefined();
    expect(second.said).toContain('offer to look');
  });

  it('starts it without the tokens when they asked to keep them away from it', async () => {
    const base = await depsAt();
    const repo = await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'claude',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox runtime',
      task: 'fix the build',
      hold_credentials: 'true',
    })) as { start: string; holdsCredentials?: boolean; said: string };
    expect(proposed.holdsCredentials).toBe(true);
    // No agent named, so it was a guess and is read back first.
    expect(proposed.said).toContain('Read it back once');
    await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request?.text).toBe(
      `cd '${repo}' && memnox run --hold-credentials -- claude 'fix the build'`,
    );
    const plain = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'claude-code',
      repository: 'memnox runtime',
      task: 'fix the build',
    })) as { said: string };
    expect(plain.said).toContain('call start_session with this id now');
  });

  it('finds a repository no session has opened yet, in the folders code is kept in', async () => {
    const base = await depsAt();
    const deps: SessionToolDeps = { ...base, resolveCommand: () => 'claude' };
    const client = join(deps.home, 'Documents', 'Memnox-saas', 'memnox-client');
    await mkdir(client, { recursive: true });
    git(client, 'init', '-q');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox client',
      task: 'check for uncommitted changes',
    })) as { repository: string };
    expect(proposed.repository).toBe('memnox-client');
  });

  it('starts in a folder that is not a repository, and in a new folder it makes when asked', async () => {
    const base = await depsAt();
    const deps: SessionToolDeps = { ...base, resolveCommand: () => 'claude' };
    const plain = join(deps.home, 'Documents', 'labvanced');
    await mkdir(plain, { recursive: true });
    const there = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'claude-code',
      repository: 'labvanced',
    })) as { proposed: boolean; repository: string };
    expect(there).toMatchObject({ proposed: true, repository: 'labvanced' });
    // A name heard a little wrong is read back, never started on the guess.
    const near = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'claude-code',
      repository: 'lab vansed',
    })) as { repositoryFrom?: string };
    expect(near.repositoryFrom ?? '').toContain('labvanced');

    const made = (await callOperatorTool(deps, SEAMS, 'create_folder', {
      name: 'health',
    })) as { path: string; created: boolean };
    expect(made).toMatchObject({
      created: true,
      path: join(deps.home, 'Documents', 'health'),
    });
    expect(
      await callOperatorTool(deps, SEAMS, 'create_folder', { name: 'health' }),
    ).toMatchObject({ created: false });
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'claude-code',
        repository: made.path,
      }),
    ).toMatchObject({ proposed: true, repository: 'health' });
    // Never a hidden folder, and never anywhere outside the home.
    for (const unsafe of [
      { name: '../escape' },
      { name: 'x', in: '/tmp' },
      { name: 'x', in: '~/.ssh' },
    ]) {
      expect(await callOperatorTool(deps, SEAMS, 'create_folder', unsafe)).toMatchObject({
        created: false,
      });
    }
  });

  it('starts an agent from where it is installed when the shell cannot find it', async () => {
    const base = await depsAt();
    const repo = await workedOn(base, 'memnox-runtime');
    const codexInChatGpt = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: (agent) => (agent === 'codex' ? codexInChatGpt : null),
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      repository: 'my locks runtime',
      task: 'tell me the git changes',
    })) as { start: string };
    await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request?.text).toBe(
      `cd '${repo}' && memnox run -- '${codexInChatGpt}' 'tell me the git changes'`,
    );
  });

  it('opens the Codex app on the repository with the task, rather than a terminal', async () => {
    const base = await depsAt();
    const repo = await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => null,
      resolveApp: (agent) => (agent === 'codex' ? '/Applications/ChatGPT.app' : null),
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      app: 'true',
      repository: 'memnox runtime',
      task: 'review my changes',
    })) as { start: string; in: string };
    expect(proposed.in).toBe('the Codex app');
    expect(
      await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start }),
    ).toMatchObject({ started: true, app: 'Codex', repository: 'memnox-runtime' });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      cwd: repo,
      appPath: '/Applications/ChatGPT.app',
      links: [`codex://threads/new?path=${encodeURIComponent(repo)}`],
      // Typed into the new thread and sent, so the person watches it go in.
      text: 'review my changes',
    });
  });

  it('opens Hermes with nothing to ask it yet, rather than asking what it should do', async () => {
    const base = await depsAt();
    await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveApp: () => '/x/Hermes.app',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'hermes',
      app: 'true',
      repository: 'memnox runtime',
    })) as { start: string; proposed: boolean };
    expect(proposed.proposed).toBe(true);
    await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/x/Hermes.app',
      links: [],
    });
    expect(request?.text).toBeUndefined();
  });

  it('starts an agent where the person last had it, its app, until they say otherwise', async () => {
    const base = await depsAt();
    await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'hermes',
      resolveApp: () => '/x/Hermes.app',
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    const first = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'hermes',
      app: 'true',
      repository: 'memnox runtime',
    })) as { start: string };
    await callOperatorTool(deps, SEAMS, 'start_session', { start: first.start });
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'hermes',
        repository: 'memnox runtime',
        task: 'check the git history',
      }),
    ).toMatchObject({ in: 'the Hermes app' });
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'hermes',
        app: 'false',
        repository: 'memnox runtime',
        task: 'check the git history',
      }),
    ).not.toHaveProperty('in');
  });

  it('starts Claude Code in a terminal inside VS Code when the person names it, as in the voice log', async () => {
    const base = await depsAt();
    await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'claude',
      resolveApp: () => '/Applications/Claude.app',
      resolveEditor: (editor) =>
        editor === 'vscode' ? '/Applications/Visual Studio Code.app' : null,
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    // They last had Claude Code in its desktop app, which "in VS Code" said aloud overrides.
    const inApp = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      app: 'true',
      repository: 'memnox runtime',
    })) as { start: string };
    await callOperatorTool(deps, SEAMS, 'start_session', { start: inApp.start });
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      editor: 'Visual Studio Code',
      repository: 'memnox runtime',
      task: 'check the changed files',
    })) as { start: string; in: string };
    expect(proposed.in).toBe('a new terminal in VS Code');
    expect(
      await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start }),
    ).toMatchObject({ started: true, in: 'VS Code' });
    const launch = (await new DisplayRequests(deps.home).open(NOW.toISOString())).find(
      (each) => each.display === 'launch',
    );
    expect(launch).toMatchObject({
      appPath: '/Applications/Visual Studio Code.app',
      cwd: expect.stringContaining('memnox-runtime'),
    });
    expect(launch?.text).toMatch(/memnox run -- claude 'check the changed files'$/);
    // Where it went is where the next one goes, until they say otherwise.
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        repository: 'memnox runtime',
        task: 'run the tests',
      }),
    ).toMatchObject({ in: 'a new terminal in VS Code' });
  });

  it('says so when the editor named is not installed, rather than starting it elsewhere', async () => {
    const base = await depsAt();
    await workedOn(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveCommand: () => 'claude',
      resolveEditor: () => null,
    };
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      editor: 'Cursor',
      repository: 'memnox runtime',
      task: 'check the changed files',
    })) as { proposed: boolean; said: string };
    expect(answer.proposed).toBe(false);
    expect(answer.said).toContain('not installed');
  });

  it('types into the chat open in Claude desktop, never into a session elsewhere', async () => {
    const deps: SessionToolDeps = {
      ...(await depsAt()),
      resolveApp: (agent) =>
        agent === 'claude-code' ? '/Applications/Claude.app' : null,
      delivered: async () => ({ outcome: 'typed', at: NOW.toISOString() }),
    };
    expect(
      await callOperatorTool(deps, SEAMS, 'type_in_app', {
        agent: 'claude-code',
        message: 'discuss what Memnox is',
      }),
    ).toMatchObject({ app: 'Claude', typed: true });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/Applications/Claude.app',
      links: [],
      text: 'discuss what Memnox is',
    });
  });

  it('says a desktop app is missing and names the agents whose apps are here', async () => {
    const deps: SessionToolDeps = {
      ...(await depsAt()),
      resolveApp: (agent) => (agent === 'cursor' ? '/Applications/Cursor.app' : null),
    };
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'hermes',
        app: 'true',
        repository: 'anything',
        task: 'review my changes',
      }),
    ).toMatchObject({
      proposed: false,
      missing: 'the Hermes app',
      installed: ['cursor'],
    });
  });

  it('starts only the agents it knows the command for', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'rm -rf',
        repository: 'anything',
        task: 'x',
      }),
    ).toMatchObject({ proposed: false });
  });

  it('matches a spoken name to a repository, exact before partial', () => {
    const known = ['/a/memnox-cloud', '/a/memnox-client', '/a/memnox'];
    expect(repositoryNamed('Memnox Client', known)).toBe('/a/memnox-client');
    expect(repositoryNamed('memnox', known)).toBe('/a/memnox');
    expect(repositoryNamed('payments', known)).toBeNull();
  });

  it('still finds the repository when the recognizer mishears its name', () => {
    const known = ['/a/memnox-runtime', '/a/memnox-cloud', '/a/memnox-macos'];
    expect(repositoryNamed('my locks runtime', known)).toBe('/a/memnox-runtime');
    expect(repositoryNamed('mem knocks cloud', known)).toBe('/a/memnox-cloud');
    expect(repositoryNamed('memno macos', known)).toBe('/a/memnox-macos');
  });

  it('refuses an agent whose command is not installed, and names the ones that are', async () => {
    const deps: SessionToolDeps = {
      ...(await depsAt()),
      resolveCommand: (agent) => (agent === 'claude-code' ? 'claude' : null),
    };
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'codex',
        repository: 'anything',
        task: 'tell me the git changes',
      }),
    ).toMatchObject({ proposed: false, missing: 'codex', installed: ['claude-code'] });
  });
});

describe('handing work from one agent to another', () => {
  it('adds the files the other session changed to the instruction', async () => {
    const deps = await depsAt();
    const repo = await workedOn(deps);
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_instruction', {
      session: 'ses_codex',
      message: 'review what Claude just changed',
      about: 'ses_work',
    })) as { instruction: string; readBack: string };
    expect(answer.readBack).toBe('review what Claude just changed');
    const taken = await new SpokenInstructions(deps.home).take(
      answer.instruction,
      NOW.toISOString(),
    );
    expect(taken?.message).toBe(
      `review what Claude just changed The files to look at in ${repo} are: card.ts.`,
    );
  });
});

describe('walking through a change', () => {
  it('puts up one page per file the session changed, with its changed lines', async () => {
    const deps = await depsAt();
    await workedOn(deps);
    expect(
      await callOperatorTool(deps, SEAMS, 'walk_through', {
        session: 'ses_work',
        pages: [
          { path: 'card.ts', note: 'The card now stays flat.' },
          { path: 'nowhere.ts', note: 'Never changed.' },
        ],
      }),
    ).toMatchObject({ shown: true, pages: ['card.ts'] });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'walk' });
    expect(request?.pages?.[0]).toMatchObject({
      path: 'card.ts',
      note: 'The card now stays flat.',
    });
    expect(request?.pages?.[0]?.lines).toContain('+export const flat = true;');
    expect(basename(request?.pages?.[0]?.path ?? '')).toBe('card.ts');
  });
});

describe('remembering which session they meant', () => {
  it('notes the session it opened, so the next "it" is that one', async () => {
    const deps = await depsAt();
    await workedOn(deps);
    await callOperatorTool(deps, SEAMS, 'show', { session: 'ses_work', display: 'open' });
    expect(await new VoiceFocusStore(deps.home).read()).toMatchObject({
      sessionId: 'ses_work',
      why: 'opened',
    });
  });

  it('names a session by the agent its rows name, not a child recorded as an agent', async () => {
    const deps = await depsAt();
    await recorded(deps.home, [
      { ...edit('ses_cursor', '/r/a.ts', '2026-09-30T11:50:00.000Z'), agent: 'an agent' },
      { ...edit('ses_cursor', '/r/b.ts', '2026-09-30T11:51:00.000Z'), agent: 'cursor' },
    ]);
    const rows = (await callOperatorTool(deps, SEAMS, 'sessions', {})) as {
      session: string;
      agent: string;
    }[];
    expect(rows.find((each) => each.session === 'ses_cursor')?.agent).toBe('cursor');
  });
});

describe('showing every agent on the whole screen', () => {
  it('puts each agent up with what it reaches and its sessions, counted from the scan', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_live',
      'codex',
      '2026-09-30T11:59:00.000Z',
    );
    // Only the two fields the screen reads; the rest of a report is not what this is about.
    const report = {
      agents: [
        { id: 'agt_claude-code', kind: 'claude-code' },
        { id: 'agt_codex-cli', kind: 'codex-cli' },
      ],
      surfaces: [
        { agentId: 'agt_claude-code', kind: 'shell' },
        {
          agentId: 'agt_claude-code',
          kind: 'mcp',
          servers: [{ name: 'github' }, { name: 'linear' }, { name: 'slack' }],
        },
        { agentId: 'agt_codex-cli', kind: 'filesystem' },
      ],
      authenticated: [{ name: 'gh' }, { name: 'vercel' }, { name: 'gh' }],
    } as unknown as DiscoveryReport;
    const heard = {
      servers: [
        {
          name: 'github',
          tools: [
            { name: 'list_issues', effect: 'read' },
            { name: 'merge_pull_request', effect: 'write' },
          ],
        },
      ],
    } as unknown as EnvironmentSnapshot;
    expect(
      await showAgentsTool(
        deps,
        {},
        { scan: async () => report, heard: async () => heard, full: async () => null },
      ),
    ).toMatchObject({
      shown: true,
      agents: [
        {
          name: 'Claude Code',
          servers: 3,
          reaches: ['shell'],
          working: 0,
          mcp: [
            { name: 'github', tools: 2, changing: 1 },
            { name: 'linear' },
            { name: 'slack' },
          ],
          clis: ['gh', 'vercel'],
        },
        // No shell, so a CLI signed in on the Mac is not its reach.
        { servers: 0, reaches: ['filesystem'], working: 1, mcp: [], clis: [] },
      ],
    });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'agents' });
    expect(request?.agents?.map((each) => each.kind)).toEqual([
      'claude-code',
      'codex-cli',
    ]);
  });

  it('says so when the scan finds nothing, rather than an empty screen', async () => {
    const deps = await depsAt();
    const empty = { agents: [], surfaces: [] } as unknown as DiscoveryReport;
    expect(await showAgentsTool(deps, {}, { scan: async () => empty })).toMatchObject({
      shown: false,
    });
  });
});

describe('work from the workspace', () => {
  const TICKET = {
    title: 'Fix auth token refresh',
    excerpt: 'Tokens expire mid session; refresh them before the call fails.',
    system: 'linear',
    author: 'Ada',
    at: '2026-10-02T09:00:00.000Z',
    link: 'https://linear.app/acme/issue/ENG-12',
  };
  const SAID = {
    title: '@Memnox implement the task "Fix auth token refresh"',
    system: 'slack',
    author: 'Maya',
    at: '2026-10-02T10:00:00.000Z',
  };
  const WHOLE_TICKET = `${TICKET.excerpt} Acceptance: a refresh never logs the token, and a failed refresh signs the person out once.`;
  const BY_KEY = {
    title: 'ENG-12 must not log the token while it refreshes',
    system: 'slack',
    author: 'Priya',
    at: '2026-10-02T09:30:00.000Z',
  };
  const DOC = {
    title: 'Auth design: token refresh',
    system: 'document',
    at: '2026-09-01T08:00:00.000Z',
  };

  async function connected(): Promise<SessionToolDeps> {
    const base = await depsAt();
    await writeWorkspaceMemory(base.home, {
      hash: 'm1',
      withheld: 0,
      syncedAt: NOW.toISOString(),
      facts: [
        {
          id: 'f_auth',
          kind: 'decision',
          statement:
            'Auth token refresh stays inside the session client, never in callers.',
          subject: 'auth token',
          verifiedBy: 'ada@acme.test',
        },
      ],
    });
    return {
      ...base,
      resolveCommand: () => 'claude',
      // The ticket read whole, past the excerpt the search returned.
      source: async (link) =>
        link === TICKET.link
          ? { content: WHOLE_TICKET, cut: false, untrusted: false }
          : null,
      // Each search finds what names the ticket that way, as the workspace would.
      sources: async (query) => {
        if (query.system === 'document') return { sources: [DOC], total: 1, withheld: 0 };
        if (query.about === 'ENG-12') return { sources: [BY_KEY], total: 1, withheld: 0 };
        return { sources: [SAID, TICKET], total: 2, withheld: 1 };
      },
    };
  }

  it('reads Slack and tickets for the voice, and says when the workspace cannot be asked', async () => {
    const deps = await connected();
    expect(
      await callOperatorTool(deps, SEAMS, 'sources', { about: 'auth' }),
    ).toMatchObject({
      sources: [SAID, TICKET],
      total: 2,
      withheld: '1 more this Mac is not cleared to read',
    });
    const offline = { ...deps, sources: async () => null };
    expect(await callOperatorTool(offline, SEAMS, 'sources', {})).toMatchObject({
      reached: false,
    });
  });

  it('hands a new session the ticket, what was said and the decision it must keep to', async () => {
    const deps = await connected();
    await workedOn(deps, 'memnox-runtime');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox runtime',
      task: 'implement the fix auth token refresh ticket',
      work: 'Fix auth token refresh',
    })) as { start: string; readBack: string; found: { brief: string } };

    expect(proposed.readBack).toBe('implement the fix auth token refresh ticket');
    expect(proposed.found).toMatchObject({
      ticket: 'Fix auth token refresh',
      messages: 3,
      decisions: 1,
    });
    const [start] = await new SessionStarts(deps.home).waiting(NOW.toISOString());
    expect(start?.task).toContain(`read workspace brief ${proposed.found.brief}`);
    expect(start?.brief).toBe(proposed.found.brief);

    const brief = (await callTool(deps, SEAMS, 'work', {
      brief: proposed.found.brief,
    })) as {
      sources: unknown[];
      decisions: { statement: string; settled: string }[];
      keep: string;
    };
    // The ticket first and whole, then what named it by its words, its key or a document, oldest first.
    expect(brief.sources).toEqual([
      { ...TICKET, content: WHOLE_TICKET },
      DOC,
      BY_KEY,
      SAID,
    ]);
    expect(brief.decisions[0]?.statement).toContain('stays inside the session client');
    expect(brief.decisions[0]?.settled).toContain('confirmed by ada@acme.test');
    expect(brief.keep).toContain('stop before you change anything and ask your person');
    expect(brief.keep).toContain('the way this repository already writes code');
    expect(brief.keep).toContain('every point the ticket and the messages asked for');
  });

  it('works where their last session did when they named no repository, and says so', async () => {
    const deps = await connected();
    const repo = await workedOn(deps, 'memnox-runtime');
    await new SessionHosts(deps.home).note({
      sessionId: 'ses_last',
      agent: 'claude-code',
      pid: 1,
      cwd: repo,
      seenAt: NOW.toISOString(),
    });
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        task: 'implement the fix auth token refresh ticket',
        work: 'Fix auth token refresh',
      }),
    ).toMatchObject({
      proposed: true,
      repository: 'memnox-runtime',
      repositoryFrom: 'the repository your last session worked in',
    });
  });

  it('asks the workspace for whose tickets they are, by the name said', async () => {
    const asked: unknown[] = [];
    const deps = {
      ...(await connected()),
      sources: async (query: unknown) => {
        asked.push(query);
        return { sources: [TICKET], total: 1, withheld: 0 };
      },
    };
    await callOperatorTool(deps, SEAMS, 'sources', {
      assignee: 'Priya',
      system: 'linear',
    });
    expect(asked).toEqual([{ assignee: 'Priya', system: 'linear' }]);
  });

  it('never reads a brief by an id it did not make', async () => {
    const deps = await connected();
    expect(await callTool(deps, SEAMS, 'work', { brief: '../../account' })).toMatchObject(
      {
        said: expect.stringContaining('Pass brief'),
      },
    );
  });
});

describe('two agents on one piece of work', () => {
  it('tells the person once when two sessions write the same files at once', async () => {
    const deps = await depsAt();
    const started = '2026-09-30T11:50:00.000Z';
    await recorded(deps.home, [
      edit('ses_claude', '/r/src/checkout.ts', '2026-09-30T11:55:00.000Z'),
      {
        ...edit('ses_codex', '/r/src/checkout.ts', '2026-09-30T11:56:00.000Z'),
        agent: 'codex',
      },
      {
        ...edit('ses_codex', '/r/src/cart.ts', '2026-09-30T11:57:00.000Z'),
        agent: 'codex',
      },
      edit('ses_claude', '/r/src/cart.ts', '2026-09-30T11:58:00.000Z'),
    ]);
    const watcher = new NoticeWatcher(deps.home, started);

    const told = (await watcher.look(NOW.toISOString())).filter(
      (each) => each.notice === 'collision',
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.summary).toContain(
      'are working on the same files at once on this machine',
    );
    expect(told[0]?.summary).toContain('cart.ts, checkout.ts');
    expect(told[0]?.sessionId).toBeDefined();

    const again = await watcher.look('2026-09-30T12:00:10.000Z');
    expect(again.filter((each) => each.notice === 'collision')).toEqual([]);
  });

  it('tells the person when an agent was held off a file another machine has, once', async () => {
    const deps = await depsAt();
    const watcher = new NoticeWatcher(deps.home, '2026-09-30T11:50:00.000Z');
    const clash = {
      at: '2026-09-30T11:59:00.000Z',
      sessionId: 'ses_claude',
      agent: 'claude-code',
      what: '/r/src/billing/invoice.ts',
      said: 'Codex on studio is editing lines 10 to 40 of src/billing/invoice.ts.',
    };
    await new Clashes(deps.home).note(clash);
    await new Clashes(deps.home).note({ ...clash, at: '2026-09-30T11:59:30.000Z' });

    const told = (await watcher.look(NOW.toISOString())).filter(
      (each) => each.notice === 'collision',
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.summary).toContain('was held off invoice.ts');
    expect(told[0]?.summary).toContain('Codex on studio is editing');
    expect(
      (await watcher.look('2026-09-30T12:00:10.000Z')).filter(
        (each) => each.notice === 'collision',
      ),
    ).toEqual([]);
  });
});

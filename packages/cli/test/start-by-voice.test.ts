import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISPLAY,
  DisplayRequests,
  Milestones,
  NodeGit,
  NodeWorktree,
  RunTerminals,
  SessionHosts,
  STARTABLE_AGENT,
} from '@memnox/core';
import { noteAskedFrom } from '../src/daemon/asked-from';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { trustKeys } from '../src/session-tools/folder-trust';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

/**
 * Starting a session by voice as the Mac diary showed it going wrong: a chat app given a folder
 * nobody named, a correction that started the agent it corrected, a folder lost between
 * proposals, an agent stopped on its folder trust question, and a start show could not find.
 */

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

const SEAMS: RewindSeams = {
  build: (place) => new Milestones(new NodeGit(place), new NodeWorktree(place)),
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

/** A clock the test moves, since a correction comes a few seconds after what it corrects. */
function clock(): { now: () => Date; pass: (ms: number) => void } {
  let at = NOW;
  return { now: () => new Date(at), pass: (ms) => (at += ms) };
}

async function depsAt(now: () => Date = () => new Date(NOW)): Promise<SessionToolDeps> {
  const home = realpathSync(await mkdtemp(join(tmpdir(), 'memnox-start-voice-')));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
    resolveCommand: (agent) => STARTABLE_AGENT[agent],
    delivered: async () => ({ outcome: 'typed', at: now().toISOString() }),
  };
}

/** A repository under Documents, with a session that last worked there. */
async function repositoryAt(deps: SessionToolDeps, name: string): Promise<string> {
  const repo = join(deps.home, 'Documents', name);
  await mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  await new SessionHosts(deps.home).note({
    sessionId: `ses_${name}`,
    agent: 'claude-code',
    pid: process.pid,
    app: 'iTerm',
    cwd: repo,
    seenAt: new Date(NOW - 60_000).toISOString(),
  });
  return repo;
}

/** The run `memnox run` notes for its tab as it comes up, before the agent's own hook. */
async function runIn(deps: SessionToolDeps, repo: string, agent: string): Promise<void> {
  await new RunTerminals(deps.home).note({
    sessionId: 'ses_run',
    agent,
    pid: process.pid,
    tty: 'ttys009',
    app: 'Terminal',
    cwd: repo,
    startedAt: deps.now().toISOString(),
  });
}

describe('a chat in a desktop app', () => {
  it('opens Claude desktop on no folder, never one borrowed from the last session', async () => {
    const base = await depsAt();
    await repositoryAt(base, 'memnox-macos');
    const deps: SessionToolDeps = {
      ...base,
      resolveApp: () => '/Applications/Claude.app',
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'claude-code',
      app: 'true',
      task: 'check the score of Real Madrid and Roma',
      said: 'open Claude desktop and ask it to check the score of Real Madrid and Roma',
    })) as Record<string, unknown> & { start: string; said: string };
    expect(proposed).toMatchObject({ proposed: true, noFolder: true });
    expect(proposed).not.toHaveProperty('repository');
    expect(proposed).not.toHaveProperty('repositoryFrom');
    expect(proposed.said).toContain('never name a repository');

    const started = await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    });
    expect(started).toMatchObject({ started: true, app: 'Claude', noFolder: true });
    const [request] = await new DisplayRequests(deps.home).open(deps.now().toISOString());
    expect(request).toMatchObject({
      display: 'app',
      appPath: '/Applications/Claude.app',
      links: [],
      text: 'check the score of Real Madrid and Roma',
      via: 'new-chat',
    });
    expect(request?.cwd).toBeUndefined();
  });

  it('asks the Mac to send what Cursor prefilled, and says sent only when the Mac saw it go', async () => {
    const said = async (outcome: 'typed' | 'verified'): Promise<unknown> => {
      const base = await depsAt();
      await repositoryAt(base, 'labvanced');
      const deps: SessionToolDeps = {
        ...base,
        resolveApp: () => '/Applications/Cursor.app',
        delivered: async () => ({ outcome, at: base.now().toISOString() }),
      };
      const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'cursor',
        app: 'true',
        repository: 'labvanced',
        task: 'check the last commit',
      })) as { start: string };
      const started = (await callOperatorTool(deps, SEAMS, 'start_session', {
        start: proposed.start,
      })) as { said: string };
      const [request] = await new DisplayRequests(deps.home).open(
        deps.now().toISOString(),
      );
      expect(request).toMatchObject({ display: 'app', via: 'send-prefilled' });
      // The words ride in the prompt link alone, so a Mac that knows nothing of sending types nothing twice.
      expect(request?.text).toBeUndefined();
      return started.said;
    };
    expect(await said('verified')).toContain('Sent to Cursor');
    expect(await said('typed')).toContain('press Return there');
  });
});

describe('the agent and the folder they named', () => {
  it('never takes a name that is no editor for the first editor installed', async () => {
    const base = await depsAt();
    await repositoryAt(base, 'labvanced');
    const deps: SessionToolDeps = {
      ...base,
      resolveEditor: (editor) =>
        editor === 'vscode' ? '/Applications/Visual Studio Code.app' : null,
    };
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      editor: 'Gar serve',
      repository: 'labvanced',
      task: 'check the last commit',
    })) as { proposed: boolean; said: string };
    expect(answer.proposed).toBe(false);
    expect(answer.said).toContain('agent cursor');
    expect(await new DisplayRequests(deps.home).open(deps.now().toISOString())).toEqual(
      [],
    );
  });

  it('takes an agent by its product name, so "Cursor" opens Cursor', async () => {
    const base = await depsAt();
    await repositoryAt(base, 'labvanced');
    const deps: SessionToolDeps = {
      ...base,
      resolveApp: () => '/Applications/Cursor.app',
    };
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'Cursor',
        app: 'true',
        repository: 'labvanced',
        task: 'check the last commit',
      }),
    ).toMatchObject({ proposed: true, in: 'the Cursor app', repository: 'labvanced' });
  });

  it('starts the corrected agent in the folder already named, and never the one it corrected', async () => {
    const time = clock();
    const base = await depsAt(time.now);
    const labvanced = await repositoryAt(base, 'labvanced');
    await repositoryAt(base, 'memnox-runtime');
    const deps: SessionToolDeps = {
      ...base,
      resolveApp: () => '/Applications/Cursor.app',
      resolveEditor: (editor) =>
        editor === 'vscode' ? '/Applications/Visual Studio Code.app' : null,
    };
    const first = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      editor: 'VS Code',
      repository: 'labvanced',
      task: 'check the last commit',
    })) as { start: string };

    // "No, start Cursor": the folder was not said again.
    time.pass(5_000);
    const corrected = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'cursor',
      app: 'true',
      task: 'check the last commit',
    })) as { start: string; repository: string; repositoryFrom?: string };
    expect(corrected).toMatchObject({ repository: 'labvanced', in: 'the Cursor app' });
    expect(corrected.repositoryFrom).toBeUndefined();
    expect(
      await callOperatorTool(deps, SEAMS, 'start_session', { start: first.start }),
    ).toMatchObject({ started: false });

    await callOperatorTool(deps, SEAMS, 'start_session', { start: corrected.start });
    const [request] = await new DisplayRequests(deps.home).open(deps.now().toISOString());
    expect(request).toMatchObject({ display: 'app', cwd: labvanced });
    expect(request?.links?.[0]).toBe(`cursor://file${encodeURI(labvanced)}/`);
  });

  it('starts nothing earlier when the correction names an agent it cannot start', async () => {
    const time = clock();
    const deps = await depsAt(time.now);
    await repositoryAt(deps, 'labvanced');
    const first = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'labvanced',
      task: 'check the last commit',
    })) as { start: string };
    time.pass(5_000);
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_start', {
        agent: 'Carson',
        task: 'check the last commit',
      }),
    ).toMatchObject({ proposed: false });
    expect(
      await callOperatorTool(deps, SEAMS, 'start_session', { start: first.start }),
    ).toMatchObject({ started: false });
  });

  it('reads back a start heard as one word, or as only a piece of a repository name', async () => {
    const deps = await depsAt();
    await repositoryAt(deps, 'memnox-ios');
    const piece = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      repository: 'iOS',
    })) as { repositoryFrom?: string; said: string };
    expect(piece.repositoryFrom).toContain('memnox-ios');
    expect(piece.said).toContain('Read it back once');

    const oneWord = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      repository: 'memnox ios',
      said: 'iOS',
    })) as { repositoryFrom?: string; said: string };
    expect(oneWord.repositoryFrom).toBeUndefined();
    expect(oneWord.said).toContain('Read it back once');
  });
});

describe('the folder trust question an agent asks before it starts', () => {
  it('answers Codex trusting the folder they asked for, and the task goes on', async () => {
    const base = await depsAt();
    const repo = await repositoryAt(base, 'studiolabs');
    const pressed: { text?: string; tty?: string }[] = [];
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (id) => {
        const request = await new DisplayRequests(base.home).read(id);
        if (request?.display === DISPLAY.PRESS)
          pressed.push({ text: request.text, tty: request.tty });
        return { outcome: 'typed', at: base.now().toISOString() };
      },
      startSeen: async () => (pressed.length > 0 ? 'ses_codex' : null),
      seen: async () => ({
        app: 'Terminal',
        text: 'Folder access\nTrust this folder?\n› 1. Trust and continue\n  2. Back',
      }),
    };
    await runIn(deps, repo, 'codex');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      app: 'false',
      repository: 'studiolabs',
      task: 'check the git status',
    })) as { start: string };
    const started = await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    });
    expect(started).toMatchObject({
      started: true,
      confirmed: true,
      trustedFolder: true,
      session: 'ses_codex',
    });
    expect(pressed).toEqual([{ text: 'enter', tty: 'ttys009' }]);
  });

  it('leaves a choice that grants more than the folder to the person', async () => {
    const base = await depsAt();
    const repo = await repositoryAt(base, 'studiolabs');
    let pressed = 0;
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (id) => {
        const request = await new DisplayRequests(base.home).read(id);
        if (request?.display === DISPLAY.PRESS) pressed += 1;
        return { outcome: 'typed', at: base.now().toISOString() };
      },
      startSeen: async () => null,
      seen: async () => ({
        app: 'Terminal',
        text: 'Do you trust this folder?\n› 1. Yes, allow Codex to work in this folder without asking for approval\n  2. No, ask me to approve edits and commands',
      }),
    };
    await runIn(deps, repo, 'codex');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      app: 'false',
      repository: 'studiolabs',
      task: 'check the git status',
    })) as { start: string };
    const started = (await callOperatorTool(deps, SEAMS, 'start_session', {
      start: proposed.start,
    })) as { screen?: string; said: string };
    expect(started.screen).toContain('without asking for approval');
    expect(started.said).toContain('answer_agent');
    expect(pressed).toBe(0);
  });

  it('answers Claude Code unseen only when the folder brings nothing of its own to accept', async () => {
    const base = await depsAt();
    const repo = await repositoryAt(base, 'labvanced');
    const pressed: string[] = [];
    const deps: SessionToolDeps = {
      ...base,
      delivered: async (id) => {
        const request = await new DisplayRequests(base.home).read(id);
        if (request?.display === DISPLAY.PRESS) pressed.push(request.text ?? '');
        return { outcome: 'typed', at: base.now().toISOString() };
      },
      startSeen: async () => (pressed.length > 0 ? 'ses_claude' : null),
      // A terminal inside VS Code is not read by script, so the look sees nothing.
      seen: async () => null,
    };
    await runIn(deps, repo, 'claude-code');
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'claude-code',
      app: 'false',
      repository: 'labvanced',
      task: 'check the last commit',
    })) as { start: string };
    expect(
      await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start }),
    ).toMatchObject({ session: 'ses_claude', trustedFolder: true });
    expect(pressed).toEqual(['down enter']);
  });

  it('reads the yes from the screen, and finds none where there is no trust question', () => {
    expect(
      trustKeys(
        'Accessing workspace:\nIs this a project you created or one you trust?\n❯ No, exit\n  Yes, I trust this folder',
      ),
    ).toEqual(['down', 'enter']);
    expect(
      trustKeys(
        'Do you trust the contents of this directory?\n1. Yes, continue\n2. No, quit',
      ),
    ).toEqual(['1']);
    expect(trustKeys('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBeNull();
    expect(
      trustKeys(
        'Do you trust the files in this folder?\nThis folder pre-approves 3 tool permissions\n❯ No, exit\n  Yes, I trust this folder',
      ),
    ).toBeNull();
  });
});

describe('showing a session the voice just started', () => {
  it('brings up its tab by the id of its start or of the request that opened it', async () => {
    const base = await depsAt();
    const repo = await repositoryAt(base, 'studiolabs');
    const deps: SessionToolDeps = {
      ...base,
      startSeen: async () => null,
      seen: async () => null,
    };
    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      agent: 'codex',
      app: 'false',
      repository: 'studiolabs',
      task: 'check the git status',
    })) as { start: string };
    await runIn(deps, repo, 'codex');
    await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    const launch = (
      await new DisplayRequests(deps.home).open(deps.now().toISOString())
    ).find((each) => each.display === DISPLAY.LAUNCH);
    for (const id of [proposed.start, launch?.id ?? '']) {
      await callOperatorTool(deps, SEAMS, 'show', {
        agent: 'codex',
        session: id,
        display: 'open',
      });
      const shown = (
        await new WaitingFeed(deps.home).everything(deps.now().toISOString())
      )
        .filter((each) => each.display === DISPLAY.FOCUS)
        .find((each) => each.sessionId === id);
      expect(shown?.host).toMatchObject({ tty: 'ttys009', cwd: repo });
    }
  });
});

describe('a start asked through a phone', () => {
  it('starts at once with no read back, since the yes is the Face ID the phone asks for', async () => {
    const deps = await depsAt();
    await repositoryAt(deps, 'memnox-runtime');
    const moment = deps.now().toISOString();
    await noteAskedFrom(deps.home, 'dev_phone', moment);

    const proposed = (await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox-runtime',
      task: 'fix the failing test',
    })) as Record<string, unknown> & { start: string; said: string };
    expect(proposed).toMatchObject({ proposed: true });
    expect(proposed.said).toContain('Face ID');
    expect(proposed.said).toContain('start_session with this id now');

    await callOperatorTool(deps, SEAMS, 'start_session', { start: proposed.start });
    const [launch] = await new DisplayRequests(deps.home).open(moment);
    expect(launch).toMatchObject({ display: 'launch' });
  });

  it('starts again as before once the person asks at the Mac', async () => {
    const deps = await depsAt();
    await repositoryAt(deps, 'memnox-runtime');
    await noteAskedFrom(deps.home, 'dev_phone', deps.now().toISOString());
    await noteAskedFrom(deps.home, undefined, deps.now().toISOString());

    const proposed = await callOperatorTool(deps, SEAMS, 'propose_start', {
      repository: 'memnox-runtime',
      task: 'fix the failing test',
    });
    expect(proposed).toMatchObject({ proposed: true });
  });
});

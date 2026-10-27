import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentQuestions,
  decodeResponse,
  SessionWatches,
  VoiceFocusStore,
  type DaemonResponse,
} from '@memnox/core';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { VoiceSurface } from '../src/daemon/voice-surface';
import { BRAIN_CHUNK, type Brain } from '../src/operator/brain';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const NOW = new Date();

class Heard {
  destroyed = false;
  said: DaemonResponse[] = [];
  write(line: string): boolean {
    const response = decodeResponse(line.trim());
    if (response !== null) this.said.push(response);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function keptBrain(prompts: string[]): Brain {
  return {
    name: 'claude',
    async *ask(said: string) {
      prompts.push(said);
      yield {
        kind: BRAIN_CHUNK.TEXT,
        text: 'Claude Code is asking which database to use.',
      };
      yield { kind: BRAIN_CHUNK.DONE };
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };
}

async function asked(home: string): Promise<string> {
  const question = await new AgentQuestions(home).ask({
    sessionId: 'ses_1',
    agent: 'claude-code',
    toolUseId: 'toolu_1',
    questions: [
      {
        question: 'Which database should I use?',
        options: [{ label: 'Postgres' }, { label: 'SQLite' }],
        multiSelect: false,
      },
    ],
    at: NOW.toISOString(),
  });
  return question.id;
}

function depsAt(home: string): SessionToolDeps {
  return {
    home,
    cwd: home,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => {
      throw new Error('not used');
    },
  } as unknown as SessionToolDeps; // only home and now are read by these tools
}

const SEAMS = {} as RewindSeams; // neither tool here rewinds anything

describe('a question an agent asks its person', () => {
  it('reaches the voice as news it reads out, with the question and its choices', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-asking-'));
    const id = await asked(home);
    const [event] = await new WaitingFeed(home).current(NOW.toISOString());
    expect(event).toMatchObject({ kind: 'notice', notice: 'question', subject: id });

    const prompts: string[] = [];
    const surface = new VoiceSurface({
      home,
      now: () => NOW.toISOString(),
      log: () => undefined,
      brain: () => keptBrain(prompts),
    });
    await surface.respond(new Heard(), {
      id: 1,
      method: 'brief',
      briefing: 'notice',
      subject: id,
    });
    surface.close();
    expect(prompts[0]).toContain('"Which database should I use?"');
    expect(prompts[0]).toContain('"Postgres", "SQLite"');
    expect(prompts[0]).toContain(`Question id: ${id}`);
  });

  it('passes the spoken answer on, with no read back, and says when it is already gone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-asking-'));
    const id = await asked(home);
    const deps = depsAt(home);
    expect(
      await callOperatorTool(deps, SEAMS, 'answer_question', {
        question: id,
        answer: 'sqlite',
      }),
    ).toMatchObject({
      answered: true,
      passedOn: { 'Which database should I use?': 'SQLite' },
    });
    await new AgentQuestions(home).close(id);
    expect(
      await callOperatorTool(deps, SEAMS, 'answer_question', {
        question: id,
        answer: 'Postgres',
      }),
    ).toMatchObject({ answered: false });
  });

  it('watches a session started a moment ago, before it has an id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-asking-'));
    await new VoiceFocusStore(home).set({
      repository: '/code/memnox-runtime',
      agent: 'codex',
      why: 'started',
      at: new Date(NOW.getTime() - 20_000).toISOString(),
    });
    const set = await callOperatorTool(depsAt(home), SEAMS, 'watch_for', {
      for: 'finished',
    });
    expect(set).toMatchObject({ watching: true, waitingForStart: true });
    const [watch] = await new SessionWatches(home).open(NOW.toISOString());
    expect(watch).toMatchObject({
      sessionId: '',
      awaiting: { repository: '/code/memnox-runtime' },
    });
    const bound = await new SessionWatches(home).bind(watch!, 'ses_new');
    expect(bound.sessionId).toBe('ses_new');
    expect(bound.awaiting).toBeUndefined();
  });
});

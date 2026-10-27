import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentQuestions } from '@memnox/core';
import { answerAgentQuestion } from '../src/agent-question';

const QUESTIONS = [
  {
    question: 'Which database should I use?',
    header: 'Database',
    options: [
      { label: 'Postgres', description: 'what production runs' },
      { label: 'SQLite' },
    ],
    multiSelect: false,
  },
];

function picker(answers?: Record<string, string>): unknown {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: 'toolu_1',
    session_id: 'host-session',
    tool_input: { questions: QUESTIONS, ...(answers === undefined ? {} : { answers }) },
  };
}

async function homeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-question-'));
}

function context(home: string): {
  home: string;
  agent: string;
  runSession: string | undefined;
  now: () => Date;
} {
  return { home, agent: 'claude-code', runSession: 'ses_1', now: () => new Date() };
}

describe("an agent's question answered out loud", () => {
  it('holds the picker, and fills in the spoken answer so it never has to open', async () => {
    const home = await homeDir();
    const store = new AgentQuestions(home);
    const reply = answerAgentQuestion(picker(), context(home), {
      voiceThere: async () => true,
      waitMs: 5_000,
      // Answered while the hook waits, the way the voice answers it from another process.
      sleep: async () => {
        const [open] = await store.open(new Date().toISOString());
        if (open !== undefined)
          await store.answer(open.id, 1, 'postgres.', new Date().toISOString());
      },
    });
    const parsed = JSON.parse((await reply) ?? '{}') as {
      hookSpecificOutput: {
        permissionDecision: string;
        updatedInput: { answers: unknown };
      };
    };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(parsed.hookSpecificOutput.updatedInput.answers).toEqual({
      'Which database should I use?': 'Postgres',
    });
    expect(await store.open(new Date().toISOString())).toEqual([]);
  });

  it('lets the picker open as ever when nobody answers in time', async () => {
    const home = await homeDir();
    const reply = await answerAgentQuestion(picker(), context(home), {
      voiceThere: async () => true,
      waitMs: 0,
      sleep: async () => undefined,
    });
    expect(reply).toBeNull();
    expect(await new AgentQuestions(home).open(new Date().toISOString())).toEqual([]);
  });

  it('waits for nobody when the voice is not listening', async () => {
    const home = await homeDir();
    const reply = await answerAgentQuestion(picker(), context(home), {
      voiceThere: async () => false,
    });
    expect(reply).toBeNull();
  });

  it('leaves alone a picker the agent already answered itself', async () => {
    const home = await homeDir();
    const reply = await answerAgentQuestion(
      picker({ 'Which database should I use?': 'SQLite' }),
      context(home),
      { voiceThere: async () => true, waitMs: 0 },
    );
    expect(reply).toBeNull();
  });

  it('keeps an answer that names no choice as the person said it', async () => {
    const home = await homeDir();
    const store = new AgentQuestions(home);
    const asked = await store.ask({
      sessionId: 'ses_1',
      agent: 'claude-code',
      toolUseId: 'toolu_2',
      questions: QUESTIONS,
      at: new Date().toISOString(),
    });
    const answered = await store.answer(
      asked.id,
      1,
      'whatever the tests use',
      new Date().toISOString(),
    );
    expect(answered?.answers).toEqual({
      'Which database should I use?': 'whatever the tests use',
    });
    expect(
      await store.answer(asked.id, 2, 'Postgres', new Date().toISOString()),
    ).toBeNull();
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_QUESTION_MOST_MS,
  AGENT_QUESTION_WAIT_MS,
  AgentQuestions,
  DAEMON_EVENT,
  NOTICE_KIND,
  decodeResponse,
  type AgentQuestion,
  type DaemonEvent,
} from '@memnox/core';
import { sendWaiting } from '../src/daemon/origin-routing';
import type { Peer } from '../src/daemon/socket-write';
import { questionBrief } from '../src/operator/voice-prompts';

/* An agent asked three questions in one picker. The notch showed the first, and after the
   first answer the card and the voice stayed on it, or the whole set ran out at forty five
   seconds and fell back to the terminal. Each step now moves the card and the voice on,
   and each answer gives the next its own time. */

const ASKED_AT = '2026-10-23T10:00:00.000Z';

const QUESTIONS = [
  {
    question: 'Which database?',
    options: [{ label: 'Postgres' }, { label: 'SQLite' }],
    multiSelect: false,
  },
  {
    question: 'Which features?',
    options: [{ label: 'Auth' }, { label: 'Billing' }],
    multiSelect: true,
  },
  {
    question: 'Ship it today?',
    options: [{ label: 'Yes' }, { label: 'No' }],
    multiSelect: false,
  },
];

class Mac implements Peer {
  destroyed = false;
  told: string[] = [];
  write(line: string): boolean {
    const event = decodeResponse(line.trim())?.event;
    if (event !== undefined) {
      this.told.push(`${event.kind} ${Object.keys(event.answers ?? {}).length}`);
    }
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function questionEvent(answers: Record<string, string>): DaemonEvent {
  return {
    kind: DAEMON_EVENT.NOTICE,
    notice: NOTICE_KIND.QUESTION,
    subject: 'aqn_1',
    agent: 'claude-code',
    summary: 'Claude Code is asking you: Which database?',
    at: ASKED_AT,
    questions: QUESTIONS,
    answers,
  };
}

function pass(subscribers: Map<Peer, Set<string>>, waiting: DaemonEvent[]): void {
  sendWaiting(subscribers, waiting, {
    claimed: new Set(),
    now: ASKED_AT,
    phoneOf: () => undefined,
    originOf: () => undefined,
    stamp: (event) => event,
  });
}

async function asked(): Promise<{ store: AgentQuestions; question: AgentQuestion }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-steps-'));
  const store = new AgentQuestions(home);
  const question = await store.ask({
    sessionId: 'ses_1',
    agent: 'claude-code',
    toolUseId: 'tu_1',
    questions: QUESTIONS,
    at: ASKED_AT,
  });
  return { store, question };
}

const later = (ms: number): string => new Date(Date.parse(ASKED_AT) + ms).toISOString();

describe('a picker of several questions, answered step by step', () => {
  it('gives each next question its own wait when a step is answered', async () => {
    const { store, question } = await asked();
    expect(question.expiresAt).toBe(later(AGENT_QUESTION_WAIT_MS));
    const first = await store.answer(question.id, 1, 'Postgres', later(40_000));
    expect(first?.expiresAt).toBe(later(40_000 + AGENT_QUESTION_WAIT_MS));
    // Past the first forty five seconds and still answerable, since the first answer moved it on.
    const second = await store.answer(question.id, 2, 'Auth, Billing', later(70_000));
    expect(second?.answers).toEqual({
      'Which database?': 'Postgres',
      'Which features?': 'Auth, Billing',
    });
  });

  it('never holds a set longer than the longest, so the picker still opens for somebody gone', async () => {
    const { store, question } = await asked();
    // A step answered every forty seconds, each inside its window, until close to the ceiling.
    let latest: AgentQuestion | null = null;
    for (let at = 40_000; at < AGENT_QUESTION_MOST_MS; at += 40_000) {
      latest = await store.answer(question.id, 1, 'Postgres', later(at));
    }
    expect(latest?.expiresAt).toBe(later(AGENT_QUESTION_MOST_MS));
  });

  it('tells the notch again each time a step is answered, and never says it settled', () => {
    const mac = new Mac();
    const subscribers = new Map<Peer, Set<string>>([[mac, new Set()]]);
    pass(subscribers, [questionEvent({})]);
    pass(subscribers, [questionEvent({})]);
    pass(subscribers, [questionEvent({ 'Which database?': 'Postgres' })]);
    pass(subscribers, [questionEvent({ 'Which database?': 'Postgres' })]);
    expect(mac.told).toEqual(['notice 0', 'notice 1']);
    pass(subscribers, []);
    expect(mac.told).toEqual(['notice 0', 'notice 1', 'settled 0']);
  });

  it('briefs the next open question and never asks one twice', () => {
    const brief = questionBrief(
      {
        id: 'aqn_1',
        sessionId: 'ses_1',
        agent: 'claude-code',
        questions: QUESTIONS,
        askedAt: ASKED_AT,
        expiresAt: later(AGENT_QUESTION_WAIT_MS),
        answers: { 'Which database?': 'Postgres' },
      },
      'Claude Code',
    );
    expect(brief).toContain(
      'Question 1: "Which database?". Already answered: "Postgres".',
    );
    expect(brief).toContain('say only the next one, question 2');
  });
});

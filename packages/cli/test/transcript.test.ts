import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionHosts } from '@memnox/core';
import {
  conversationIn,
  focusIn,
  lastAnswerIn,
  latestAskIn,
  sessionTranscript,
  turnOverIn,
} from '../src/daemon/transcript';
import { latestPersonAt } from '../src/daemon/spoken-to';

const line = (value: unknown): string => JSON.stringify(value);

describe('the conversation in a live session window', () => {
  it('shows what was asked, what the agent said and ran, and never its thinking or a helper', () => {
    const raw = [
      line({
        type: 'user',
        timestamp: 't1',
        message: {
          content: '<system-reminder>ignore</system-reminder>\nadd a cancel button',
        },
      }),
      line({
        type: 'assistant',
        timestamp: 't2',
        message: { content: [{ type: 'thinking', thinking: 'private' }] },
      }),
      line({
        type: 'assistant',
        timestamp: 't3',
        message: {
          content: [
            { type: 'text', text: 'I will add it to the cart page.' },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/r/src/Cart.tsx' } },
          ],
        },
      }),
      line({
        type: 'user',
        timestamp: 't4',
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      }),
      line({
        type: 'assistant',
        isSidechain: true,
        timestamp: 't5',
        message: { content: [{ type: 'text', text: 'a helper talking' }] },
      }),
      '{"type":"assistant","message":{"con',
    ].join('\n');
    expect(conversationIn(raw)).toEqual([
      { at: 't1', who: 'person', text: 'add a cancel button' },
      { at: 't3', who: 'agent', text: 'I will add it to the cart page.' },
      { at: 't3', who: 'tool', text: 'Edit: Cart.tsx' },
    ]);
  });
});

describe('what the person asked last', () => {
  it('is their own latest words, never a helper report the agent marks as not theirs', () => {
    const raw = [
      line({ type: 'user', message: { content: 'make the modal draggable' } }),
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'On it.' }] },
      }),
      line({
        type: 'user',
        isMeta: true,
        origin: { kind: 'peer' },
        message: {
          content:
            'Another Claude session sent a message:\n<agent-message from="a1">\n[Subagent hand-back] The text below is the final report of a subagent.',
        },
      }),
    ];
    expect(latestAskIn(raw.join('\n'))).toBe('make the modal draggable');
    expect(latestAskIn(line({ type: 'assistant', message: { content: [] } }))).toBeNull();
  });
});

describe('what a session answered last', () => {
  it('is the words after its last tool call, whole, and resets when the person asks again', () => {
    const said = (text: string): unknown => ({ type: 'text', text });
    const raw = [
      line({ type: 'user', message: { content: 'check the git history' } }),
      line({
        type: 'assistant',
        message: {
          content: [said('Let me look.'), { type: 'tool_use', name: 'Bash', input: {} }],
        },
      }),
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'x' }] },
      }),
      line({
        type: 'assistant',
        message: { content: [said('I read the last 40 commits on main.')] },
      }),
      line({ type: 'assistant', message: { content: [said('Two are from today.')] } }),
    ];
    expect(lastAnswerIn(raw.join('\n'))).toBe(
      'I read the last 40 commits on main.\n\nTwo are from today.',
    );
    const askedAgain = [...raw, line({ type: 'user', message: { content: 'and now?' } })];
    expect(lastAnswerIn(askedAgain.join('\n'))).toBeNull();
  });

  it('is found under memnox run through the id the agent gave its own transcript', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-transcript-'));
    const project = join(home, '.claude', 'projects', '-work-client');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, '9ddff478-4759-4ec5.jsonl'), '');
    expect(await sessionTranscript(home, 'ses_1eb61120-4c7')).toBeNull();
    await new SessionHosts(home).note({
      sessionId: 'ses_1eb61120-4c7',
      agent: 'claude-code',
      pid: 1,
      agentSession: '9ddff478-4759-4ec5',
      seenAt: '2026-10-02T08:17:02.000Z',
    });
    expect(await sessionTranscript(home, 'ses_1eb61120-4c7')).toBe(
      join(project, '9ddff478-4759-4ec5.jsonl'),
    );
  });
});

describe('a turn its transcript shows is over', () => {
  const asked = line({ type: 'user', message: { content: 'fix the flaky test' } });
  const working = line({
    type: 'assistant',
    message: {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'Bash', input: {} }],
    },
  });
  const result = line({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
  });

  it('is still going while the agent runs a tool or has just been asked', () => {
    expect(turnOverIn([asked].join('\n'))).toBe(false);
    expect(turnOverIn([asked, working, result].join('\n'))).toBe(false);
  });

  it('is over when the person stopped it, an API error ended it, or the reply ended', () => {
    const stopped = line({
      type: 'user',
      message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    });
    const failed = line({
      type: 'assistant',
      isApiErrorMessage: true,
      message: { content: [{ type: 'text', text: 'API Error: Connection refused' }] },
    });
    const ended = line({
      type: 'assistant',
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    });
    expect(turnOverIn([asked, working, stopped].join('\n'))).toBe(true);
    expect(turnOverIn([asked, failed].join('\n'))).toBe(true);
    expect(turnOverIn([asked, working, result, ended].join('\n'))).toBe(true);
  });

  it('opens again when the person asks something new', () => {
    const ended = line({
      type: 'assistant',
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    });
    expect(turnOverIn([asked, ended, asked].join('\n'))).toBe(false);
  });
});

/* A card titled by the first message read "reuse component in app like input" for a session
   long past it. Claude Code keeps its own title for the session current, which says what is
   happening there now. */
describe('what a session is about now', () => {
  it('is the agent’s newest title, not its first and not the first message', () => {
    const raw = [
      line({ type: 'user', message: { content: 'reuse component in app like input' } }),
      line({ type: 'ai-title', aiTitle: 'Input component reuse', sessionId: 's' }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
      line({
        type: 'ai-title',
        aiTitle: 'Shared form inputs across the app',
        sessionId: 's',
      }),
    ].join('\n');
    expect(focusIn(raw)).toBe('Shared form inputs across the app');
  });

  it('falls back to the name it was given, said as words', () => {
    const raw = line({
      type: 'agent-name',
      agentName: 'memnox-launch-film-script',
      sessionId: 's',
    });
    expect(focusIn(raw)).toBe('memnox launch film script');
  });

  it('is nothing where the agent keeps no title, and never a reply that quotes one', () => {
    const quoted = line({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: '{"type":"ai-title","aiTitle":"fake"}' }],
      },
    });
    expect(focusIn(quoted)).toBeNull();
  });
});

describe('when the person last wrote to a session', () => {
  it("is the time of their newest line, never the agent's", () => {
    expect(
      latestPersonAt([
        { at: '2026-10-02T11:00:00.000Z', who: 'person', text: 'fix it' },
        { at: '2026-10-02T11:05:00.000Z', who: 'agent', text: 'Done.' },
      ]),
    ).toBe('2026-10-02T11:00:00.000Z');
    expect(latestPersonAt([{ at: 't', who: 'agent', text: 'Hello.' }])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { DaemonAskChunk } from '@memnox/core';
import { BRAIN_CHUNK, type Brain, type BrainChunk } from '../src/operator/brain';
import { AddressLimit, addressForms } from '../src/daemon/address-limit';
import { BrainTurns } from '../src/daemon/brain-turns';
import { SpokenFilter } from '../src/daemon/spoken-filter';
import { streamTurn, withoutHolds } from '../src/daemon/stream-turn';
import { actedNote } from '../src/daemon/voice-ask';
import { isAgentProgram } from '../src/session-tools/agent-foreground';
import { waitingRoute } from '../src/session-tools/instruct-tools';

function spoken(pieces: readonly (string | null)[]): string {
  const filter = new SpokenFilter();
  let out = '';
  for (const piece of pieces) {
    if (piece === null) filter.tool();
    else out += filter.text(piece);
  }
  return out + filter.end();
}

describe('what of the brain is said aloud', () => {
  it('never says a system reminder the model echoed, however it was split', () => {
    expect(
      spoken([
        '<system',
        '-reminder>',
        '\n<total_tokens',
        '>15000000',
        '</total_tokens',
        '>\n</system',
        '-reminder>',
        '\n\nYour',
        ' last session was checking git.',
      ]),
    ).toBe('\n\nYour last session was checking git.');
  });

  it('keeps a lone angle bracket that starts no reminder', () => {
    expect(spoken(['Three ', '<', ' five.'])).toBe('Three < five.');
    expect(spoken(['It ends in <'])).toBe('It ends in <');
  });

  it('drops the sentence said again after a tool, as in the voice log', () => {
    expect(
      spoken([
        'My',
        ' apologies;',
        ' the instruction is on your clipboard instead. Would',
        ' you like me to open that session?',
        null,
        'My',
        ' ap',
        'ologies;',
        ' the instruction is on your',
        ' clipboard instead. Would you like me to open that session?',
      ]),
    ).toBe(
      'My apologies; the instruction is on your clipboard instead. Would you like me to open that session?',
    );
  });

  it('says what comes after a tool once it differs from what was said', () => {
    expect(
      spoken([
        "I'll close all the sessions.",
        null,
        'I',
        "'ll need you to close the VS Code one.",
      ]),
    ).toBe("I'll close all the sessions.I'll need you to close the VS Code one.");
  });

  it('streams the turn without the repeat, and records only what was said', async () => {
    const chunks: BrainChunk[] = [
      { kind: BRAIN_CHUNK.TEXT, text: 'Sorry, it is on your clipboard.' },
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__end_conversation' },
      { kind: BRAIN_CHUNK.TEXT, text: 'Sorry, it is on your clipboard.' },
      { kind: BRAIN_CHUNK.DONE },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const sent: DaemonAskChunk[] = [];
    const turn = await streamTurn(new BrainTurns(() => brain, 60_000), 'yes', (chunk) =>
      sent.push(chunk),
    );
    expect(turn.answered).toBe('Sorry, it is on your clipboard.');
    expect(sent.filter((chunk) => chunk.kind === BRAIN_CHUNK.TEXT)).toHaveLength(1);
  });

  it('keeps a hold on a whole request from the Mac, end and all, and passes the rest', () => {
    const sent: DaemonAskChunk[] = [];
    const send = withoutHolds((chunk) => sent.push(chunk));
    send({ kind: BRAIN_CHUNK.TEXT, text: 'Opening Hermes.' });
    send({ kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__keep_listening' });
    send({ kind: BRAIN_CHUNK.DONE });
    expect(sent).toEqual([{ kind: BRAIN_CHUNK.TEXT, text: 'Opening Hermes.' }]);
  });
});

describe('addressing the person', () => {
  it('takes their name out once it was said lately, however the name is split', () => {
    const filter = new SpokenFilter([', Moïse', 'Moïse, ']);
    const out = ['My apologies,', ' Mo', 'ï', 'se. Most', ' of these are in VS Code.']
      .map((piece) => filter.text(piece))
      .join('');
    expect(out + filter.end()).toBe('My apologies. Most of these are in VS Code.');
    const opening = new SpokenFilter([', sir', 'sir, ']);
    expect(opening.text('Very well, sir.') + opening.end()).toBe('Very well.');
  });

  it('starts the sentence with a capital when the name that opened it was taken out', () => {
    const filter = new SpokenFilter([', Moïse', 'Moïse, ']);
    const pieces = [
      'Moïse',
      ', the',
      ' commit session is waiting. Moïse, ',
      'it is',
      ' done.',
    ];
    const said = pieces.map((piece) => filter.text(piece)).join('') + filter.end();
    expect(said).toBe('The commit session is waiting. It is done.');
  });

  it('leaves the case alone when the name it took out was mid sentence', () => {
    const filter = new SpokenFilter([', Moïse', 'Moïse, ']);
    const said = filter.text('Very well, Moïse, the tab stays open.') + filter.end();
    expect(said).toBe('Very well, the tab stays open.');
  });

  it('lets the title through every five minutes and the name only every half hour', () => {
    const limit = new AddressLimit('/nowhere');
    const forms = addressForms('sir', 'Moïse');
    expect(limit.unsaid(forms, '2026-10-02T22:49:00.000Z')).toEqual([]);
    limit.noteSaid('Good evening, Moïse.', forms, '2026-10-02T22:49:00.000Z');
    limit.noteSaid('Very well, sir.', forms, '2026-10-02T22:49:40.000Z');
    expect(limit.unsaid(forms, '2026-10-02T22:50:00.000Z')).toEqual([
      ', sir',
      'sir, ',
      ', Moïse',
      'Moïse, ',
    ]);
    expect(limit.unsaid(forms, '2026-10-02T22:55:00.000Z')).toEqual([
      ', Moïse',
      'Moïse, ',
    ]);
    expect(limit.unsaid(forms, '2026-10-02T23:20:00.000Z')).toEqual([]);
  });

  it('says neither right after the Mac answered their call', () => {
    const limit = new AddressLimit('/nowhere');
    const forms = addressForms('sir', 'Moïse');
    limit.noteCalled(forms, '2026-10-03T23:23:36.000Z');
    expect(limit.unsaid(forms, '2026-10-03T23:23:50.000Z')).toHaveLength(4);
  });

  it('treats a name chosen as the title as a name', () => {
    expect(addressForms('Moïse', 'Moïse')).toEqual([
      { words: 'Moïse', gapMs: 30 * 60_000 },
    ]);
  });

  it('keeps a name the reply is about rather than speaking to, as in the voice log', () => {
    const filter = new SpokenFilter([', Moise', 'Moise, ']);
    const said = [
      'I checked your Linear tickets assigned to Mo',
      'ise, and nothing matches. Tickets for Ann',
      ', Moise and Bob are closed.',
    ]
      .map((piece) => filter.text(piece))
      .join('');
    expect(said + filter.end()).toBe(
      'I checked your Linear tickets assigned to Moise, and nothing matches. Tickets for Ann, Moise and Bob are closed.',
    );
  });

  it('still takes the name out where it closes the reply or opens a sentence', () => {
    const closing = new SpokenFilter([', Moise', 'Moise, ']);
    expect(closing.text('It is done, Moise') + closing.end()).toBe('It is done');
    const asked = new SpokenFilter([', Moise', 'Moise, ']);
    expect(asked.text('Shall I send it, Moise') + asked.text('?') + asked.end()).toBe(
      'Shall I send it?',
    );
    const opening = new SpokenFilter([', Moise', 'Moise, ']);
    expect(opening.text('Done. Moise, the draft went to Ann.') + opening.end()).toBe(
      'Done. The draft went to Ann.',
    );
  });

  it('says a name that only starts like the phrase as it is', () => {
    const filter = new SpokenFilter([', Moïse']);
    expect(
      filter.text('Moments ago, Mo') + filter.text('nday came.') + filter.end(),
    ).toBe('Moments ago, Monday came.');
  });
});

describe('a turn the brain ends after speaking', () => {
  it('never says a second wording of it after end_conversation, as in the voice log', async () => {
    const chunks: BrainChunk[] = [
      { kind: BRAIN_CHUNK.TEXT, text: 'I see. So only two agents were onboarded.' },
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__end_conversation' },
      {
        kind: BRAIN_CHUNK.TEXT,
        text: 'I understand. So only two of the three were onboarded.',
      },
      { kind: BRAIN_CHUNK.DONE },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const sent: DaemonAskChunk[] = [];
    const turn = await streamTurn(new BrainTurns(() => brain, 60_000), 'yes', (chunk) =>
      sent.push(chunk),
    );
    expect(turn.answered).toBe('I see. So only two agents were onboarded.');
    expect(sent.map((chunk) => chunk.kind)).toEqual(['text', 'tool', 'done']);
  });

  it('keeps listening after a reply that asks something, even when the brain ended it', async () => {
    const chunks: BrainChunk[] = [
      { kind: BRAIN_CHUNK.TEXT, text: "I'm here. What can I do for you?" },
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__end_conversation' },
      { kind: BRAIN_CHUNK.DONE },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const sent: DaemonAskChunk[] = [];
    await streamTurn(new BrainTurns(() => brain, 60_000), 'oh, you?', (chunk) =>
      sent.push(chunk),
    );
    expect(sent.map((chunk) => chunk.kind)).toEqual(['text', 'done']);
  });

  it('keeps listening after an answer the brain ended, so a follow up is not cut off', async () => {
    const chunks: BrainChunk[] = [
      {
        kind: BRAIN_CHUNK.TEXT,
        text: 'There are no decisions in your workspace yet, so every action is decided as it comes up.',
      },
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__end_conversation' },
      { kind: BRAIN_CHUNK.DONE },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const sent: DaemonAskChunk[] = [];
    await streamTurn(
      new BrainTurns(() => brain, 60_000),
      'summarise the decisions',
      (chunk) => sent.push(chunk),
    );
    expect(sent.map((chunk) => chunk.kind)).toEqual(['text', 'done']);
  });

  it('still says a sign off written after ending, when nothing was said before it', async () => {
    const chunks: BrainChunk[] = [
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__end_conversation' },
      { kind: BRAIN_CHUNK.TEXT, text: 'Very well.' },
      { kind: BRAIN_CHUNK.DONE },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const turn = await streamTurn(
      new BrainTurns(() => brain, 60_000),
      'ok',
      () => undefined,
    );
    expect(turn.answered).toBe('Very well.');
  });
});

describe('how an instruction reaches a session waiting on the person', () => {
  const agentInFront = (): boolean => true;
  const host = { sessionId: 's', agent: 'claude-code', pid: 1, seenAt: '' };

  it('types into an agent in an editor terminal, as in a Terminal tab', () => {
    expect(
      waitingRoute({ ...host, app: 'Visual Studio Code', tty: 'ttys013' }, agentInFront),
    ).toBe('typed');
    expect(waitingRoute({ ...host, app: 'iTerm2', tty: 'ttys004' }, agentInFront)).toBe(
      'typed',
    );
  });

  it('prefills only the chat panel, and never a terminal with a bare shell in front', () => {
    expect(waitingRoute({ ...host, app: 'Visual Studio Code' }, agentInFront)).toBe(
      'prefilled',
    );
    expect(
      waitingRoute({ ...host, app: 'Visual Studio Code', tty: 'ttys013' }, () => false),
    ).toBe('later');
  });

  it('hands any other terminal app to the Mac, and leaves a session with no app to its pane', () => {
    expect(waitingRoute({ ...host, app: 'Ghostty', tty: 'ttys021' }, agentInFront)).toBe(
      'typed',
    );
    expect(waitingRoute({ ...host, tty: 'ttys021' }, agentInFront)).toBe('later');
    expect(waitingRoute({ ...host, app: 'Ghostty', tty: 'ttys021' }, () => false)).toBe(
      'later',
    );
  });

  it("types into an editor's agent panel even when its process inherited a terminal", () => {
    expect(
      waitingRoute(
        { ...host, app: 'Visual Studio Code', tty: 'ttys013', panel: true },
        agentInFront,
      ),
    ).toBe('prefilled');
  });
});

describe('which program in a terminal is the agent', () => {
  it('knows a native install named for its version, and never a shell', () => {
    expect(isAgentProgram('/Users/m/.local/share/claude/versions/2.1.3')).toBe(true);
    expect(isAgentProgram('claude')).toBe(true);
    expect(isAgentProgram('/opt/homebrew/bin/node')).toBe(true);
    expect(isAgentProgram('-zsh')).toBe(false);
    expect(isAgentProgram('/bin/zsh')).toBe(false);
  });
});

describe('a reply cut off after it acted', () => {
  it('says what it did, so the words that follow are never acted on twice', async () => {
    const chunks: BrainChunk[] = [
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__sessions' },
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__type_in_app' },
      { kind: BRAIN_CHUNK.CANCELLED },
    ];
    const brain: Brain = {
      name: 'claude',
      async *ask() {
        yield* chunks;
      },
      close: () => undefined,
      cancel: () => undefined,
      warm: async () => undefined,
    };
    const turn = await streamTurn(
      new BrainTurns(() => brain, 60_000),
      'type it',
      () => undefined,
    );
    expect(turn.ended).toBe(false);
    expect(turn.acted).toEqual(['type_in_app']);
    expect(actedNote(turn.acted)).toContain('reached for type_in_app');
    // A call made while they were still speaking may have been held back, so its own result decides.
    expect(actedNote(turn.acted)).toContain('when it says nothing was done');
  });
});

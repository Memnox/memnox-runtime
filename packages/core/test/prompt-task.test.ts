import { describe, expect, it } from 'vitest';
import { isInjectedOrigin, isInjectedPrompt } from '../src/session/injected-prompt';
import {
  intentOfPrompt,
  statementOfPrompt,
  taskFromPrompt,
  typedAsks,
} from '../src/session/prompt-task';

describe('an ask read as an investigation', () => {
  it.each([
    'investigate why yesterday’s payments failed',
    'Why did the checkout error rate go up?',
    'look into the staging failure',
    'find out what caused the outage, but do not change anything',
    'fix nothing, just look at the logs and do not change anything',
    'read-only: tell me what is wrong with the webhook',
  ])('%s', (prompt) => {
    expect(intentOfPrompt(prompt)).toBe('investigate');
  });

  it.each([
    'investigate and fix the payment retry',
    'why is this slow? refactor it',
    'add a test for the retry',
    'fix the bug in payments.ts',
  ])('not %s', (prompt) => {
    expect(intentOfPrompt(prompt)).toBeUndefined();
  });
});

describe('the task a prompt declares', () => {
  const moment = { sessionId: 's1', now: '2026-09-26T10:00:00.000Z' };

  it('keeps the first line, clipped', () => {
    expect(statementOfPrompt('fix the bug\nmore detail')).toBe('fix the bug');
    expect(statementOfPrompt('x'.repeat(300)).length).toBe(200);
  });

  it('takes the line the person wrote, past a stray backtick and a pasted log', () => {
    const prompt = [
      '`',
      '2026-10-01T15:44:21Z  not listening for my name',
      '2026-10-01T15:44:21Z  speech model ready',
      '` Fix this actually to load seamlessly and correct in all these use cases.',
    ].join('\n');
    expect(statementOfPrompt(prompt)).toBe(
      'Fix this actually to load seamlessly and correct in all these use cases.',
    );
    expect(
      statementOfPrompt('when you finished this session the voice came up and told me `'),
    ).toBe('when you finished this session the voice came up and told me');
    expect(statementOfPrompt('[Image #1]\nwhy is the card wrong')).toBe(
      'why is the card wrong',
    );
  });

  it('never replaces a task a person declared, and replaces one read from an earlier prompt', () => {
    const declared = {
      id: 't',
      sessionId: 's1',
      statement: 'x',
      scope: {},
      declaredAt: '',
    };
    expect(taskFromPrompt('investigate it', declared, moment)).toBeNull();
    const fromPrompt = taskFromPrompt('investigate it', null, moment);
    expect(fromPrompt?.intent).toBe('investigate');
    expect(taskFromPrompt('now fix it', fromPrompt, moment)?.intent).toBeUndefined();
  });

  it('keeps the first prompt as the mission and a follow up as the latest ask', () => {
    const first = taskFromPrompt('review the current git history', null, moment);
    expect(first?.latestAsk).toBeUndefined();
    const followUp = taskFromPrompt('go ahead', first, moment);
    expect(followUp?.statement).toBe('review the current git history');
    expect(followUp?.latestAsk).toBe('go ahead');
    expect(followUp?.declaredAt).toBe(first?.declaredAt);
    expect(taskFromPrompt('and check the tags too', followUp, moment)?.latestAsk).toBe(
      'and check the tags too',
    );
  });
});

describe('a prompt the person never typed', () => {
  const handBack =
    '<agent-message from="a1">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\n  I traced it.';

  it.each([
    handBack,
    '[Subagent hand-back] The text below is the final report of a subagent.',
    'Another Claude session sent a message:\nhello',
    '<task-notification>\n<task-id>b1</task-id>',
    '<command-name>/clear</command-name>',
    '<local-command-stdout>done</local-command-stdout>',
    '<system-reminder>be brief</system-reminder>\n[Subagent hand-back] The report follows.',
    '[Memnox, not the person] They just finished signing in.',
    '[Request interrupted by user for tool use]',
  ])('is no statement: %s', (prompt) => {
    expect(isInjectedPrompt(prompt)).toBe(true);
    expect(statementOfPrompt(prompt)).toBe('');
  });

  it('leaves what the person typed, a paste included, as theirs', () => {
    expect(isInjectedPrompt('fix the login bug')).toBe(false);
    expect(
      isInjectedPrompt('<pasted_content>log</pasted_content>\nwhy does this fail'),
    ).toBe(false);
    expect(isInjectedPrompt('[Image #1] make it look like this')).toBe(false);
    expect(
      isInjectedPrompt('<system-reminder>be brief</system-reminder>\nship the fix'),
    ).toBe(false);
    expect(
      statementOfPrompt('<system-reminder>be brief</system-reminder>\nship the fix'),
    ).toBe('ship the fix');
  });

  it('reads a peer or a task origin as not the person', () => {
    expect(isInjectedOrigin({ kind: 'peer' })).toBe(true);
    expect(isInjectedOrigin({ kind: 'task-notification' })).toBe(true);
    expect(isInjectedOrigin({ kind: 'human', handback: true })).toBe(true);
    expect(isInjectedOrigin({ kind: 'human' })).toBe(false);
    expect(isInjectedOrigin(undefined)).toBe(false);
  });

  it('never becomes the task or the latest ask, and a task one set is replaced by the next real prompt', () => {
    const moment = { sessionId: 's1', now: '2026-11-01T10:00:00.000Z' };
    expect(taskFromPrompt(handBack, null, moment)).toBeNull();
    const first = taskFromPrompt('add a cancel button', null, moment);
    expect(first).not.toBeNull();
    expect(taskFromPrompt(handBack, first, moment)).toBeNull();
    const polluted = {
      ...first!,
      statement: '[Subagent hand-back] The text below is a report.',
    };
    expect(typedAsks(polluted)).toEqual({});
    const healed = taskFromPrompt('now make it red', polluted, moment);
    expect(healed?.statement).toBe('now make it red');
    expect(typedAsks(healed)).toEqual({
      task: 'now make it red',
      lastAsk: 'now make it red',
    });
    expect(typedAsks(null)).toEqual({});
  });
});

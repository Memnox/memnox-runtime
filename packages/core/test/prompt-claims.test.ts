import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROMPT_CLAIMS_ENV,
  promptClaims,
  promptClaimsEnabled,
  promptedIn,
  withPromptClaims,
} from '../src/session/prompt-claims';
import { SessionTasks, taskFor } from '../src/session/session-task';

/**
 * A prompt names its task only when doubt is impossible: the reference alone,
 * or an ask that opens on it. Examples, quotes, pasted material, histories and
 * lists name nothing, and the switch is off until somebody turns it on.
 */

const values = (prompt: string): string[] =>
  promptClaims(prompt).map((claim) => claim.value);

describe('what a prompt names as its task', () => {
  it('reads the reference alone, and an ask that opens on it', () => {
    expect(values('PAY-42')).toEqual(['PAY-42']);
    expect(values('fix pay-42')).toEqual(['PAY-42']);
    expect(values('Please implement ticket ENG-7: add Apple Pay')).toEqual(['ENG-7']);
    expect(values('work on #12')).toEqual(['#12']);
    expect(values('review https://linear.app/acme/issue/ENG-7/apple-pay')).toEqual([
      'https://linear.app/acme/issue/ENG-7/apple-pay',
    ]);
  });

  it('names nothing when the reference is only mentioned along the way', () => {
    expect(values('the checkout breaks the same way it did in PAY-12')).toEqual([]);
    expect(values('like we did for PAY-12, add retries to checkout')).toEqual([]);
    expect(values('add retries, see PAY-42')).toEqual([]);
  });

  it('names nothing quoted, in code, in a quoted reply or in a pasted log', () => {
    expect(values('fix "PAY-42"')).toEqual([]);
    expect(values('fix `PAY-42`')).toEqual([]);
    expect(values('```\nPAY-42\n```')).toEqual([]);
    expect(values('> fix PAY-42\nwhat do you think?')).toEqual([]);
    expect(values('Error: PAY-42 failed to load')).toEqual([]);
    expect(
      values(
        [
          'fix this',
          ...Array.from({ length: 9 }, (_, at) => `line ${at} PAY-${at}`),
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('names nothing when two references could be the task', () => {
    expect(values('fix PAY-42 and PAY-43')).toEqual([]);
    expect(values('fix PAY-42 after #12')).toEqual([]);
  });

  it('names no standard, version or link that is not a tracker issue', () => {
    expect(values('fix UTF-8')).toEqual([]);
    expect(values('fix SHA-256')).toEqual([]);
    expect(values('review https://example.com/docs/PAY-42')).toEqual([]);
  });

  it('keeps each claim once and only the latest few', () => {
    const kept = withPromptClaims(promptClaims('PAY-1').concat(promptClaims('PAY-2')), [
      ...promptClaims('PAY-2'),
      ...promptClaims('PAY-3'),
      ...promptClaims('PAY-4'),
    ]);
    expect(kept.map((claim) => claim.value)).toEqual(['PAY-2', 'PAY-3', 'PAY-4']);
  });
});

describe('the switch', () => {
  const was = process.env[PROMPT_CLAIMS_ENV];
  afterEach(() => {
    if (was === undefined) delete process.env[PROMPT_CLAIMS_ENV];
    else process.env[PROMPT_CLAIMS_ENV] = was;
  });

  it('is off until somebody turns it on, and then reads only the session own task', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-prompt-'));
    await new SessionTasks(home).declare({
      ...taskFor(
        { sessionId: 'ses_1', statement: 'fix PAY-42', scope: {} },
        '2026-11-12T00:00:00.000Z',
      ),
      promptClaims: promptClaims('fix PAY-42'),
    });

    delete process.env[PROMPT_CLAIMS_ENV];
    expect(promptClaimsEnabled()).toBe(false);
    expect(await promptedIn(home, 'ses_1')).toEqual([]);

    process.env[PROMPT_CLAIMS_ENV] = '1';
    expect((await promptedIn(home, 'ses_1')).map((claim) => claim.value)).toEqual([
      'PAY-42',
    ]);
    expect(await promptedIn(home, 'ses_2')).toEqual([]);
  });

  it('sends only the claim, never a word of the prompt', () => {
    const claims = promptClaims('fix PAY-42 before the secret launch on Friday');
    expect(claims.map((claim) => claim.value)).toEqual(['PAY-42']);
    expect(Object.keys(claims[0] ?? {}).sort()).toEqual(['form', 'source', 'value']);
    expect(JSON.stringify(claims)).not.toContain('secret');
  });
});

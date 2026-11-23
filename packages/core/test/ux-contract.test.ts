import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ALLOW_LABEL,
  ALWAYS_DENY_LABEL,
  HOLD_ANSWER_LABEL,
  HOLD_ANSWER_ORDER,
  HOLD_OUTCOME_WORD,
  INSTALL_LINE,
  TRY_PROMPT,
  SESSION_REASON_LABEL,
  SESSION_STATUS_LABEL,
  SESSION_STATUS_ORDER,
} from '../src/index';

/**
 * The copy contract the console, the Mac app and the phone each keep a verbatim copy of. The
 * runtime's own words must say exactly what it says, or the terminal drifts from the apps.
 */

interface Contract {
  answers: {
    order: string[];
    labels: Record<string, string>;
    outcomes: Record<string, string>;
    always: string;
    never: string;
  };
  sessionStatus: {
    order: string[];
    labels: Record<string, string>;
    reasons: Record<string, string>;
  };
  pages: {
    id: string;
    tabs?: { id: string; label: string }[];
    views?: { id: string; label: string }[];
    sections?: { id: string; label: string }[];
  }[];
  onboarding: { id: string; title: string; platforms?: string[] }[];
  careful: {
    order: string[];
    recommended: string;
    levels: Record<string, { label: string; line: string; mode: string; pack?: string }>;
  };
  modes: Record<string, string>;
  install: string;
  tryPrompt: string;
}

/** Words a person who never ran a terminal would not know, kept out of every label a page shows. */
const PLUMBING_WORDS = [
  'profile',
  'job',
  'MCP',
  'hook',
  'daemon',
  'runtime',
  'verdict',
  'enforce',
];

function contract(): Contract {
  const path = join(__dirname, '..', '..', '..', 'docs', 'ux', 'contract.json');
  // The file is ours and checked here, so its shape is the interface above.
  return JSON.parse(readFileSync(path, 'utf8')) as Contract;
}

describe('the words every surface shares', () => {
  it('answers a held call in the contract words, in the contract order', () => {
    const { answers } = contract();
    expect([...HOLD_ANSWER_ORDER]).toEqual(answers.order);
    expect({ ...HOLD_ANSWER_LABEL }).toEqual(answers.labels);
    expect({ ...HOLD_OUTCOME_WORD }).toEqual(answers.outcomes);
    expect(ALWAYS_ALLOW_LABEL).toBe(answers.always);
    expect(ALWAYS_DENY_LABEL).toBe(answers.never);
  });

  it('puts Deny last, so the safe answer is never where a yes is expected', () => {
    expect(contract().answers.order.at(-1)).toBe('deny');
  });

  it('names a session status and its reason the way the apps do', () => {
    const { sessionStatus } = contract();
    expect([...SESSION_STATUS_ORDER]).toEqual(sessionStatus.order);
    expect({ ...SESSION_STATUS_LABEL }).toEqual(sessionStatus.labels);
    expect({ ...SESSION_REASON_LABEL }).toEqual(sessionStatus.reasons);
  });

  it('gives every page one id', () => {
    const ids = contract().pages.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives a newcomer the same install line and the same first prompt everywhere', () => {
    expect(INSTALL_LINE).toBe(contract().install);
    expect(TRY_PROMPT).toBe(contract().tryPrompt);
  });

  it('offers three levels of care, each one sentence, with a shipped pack behind each that enforces', () => {
    const { careful } = contract();
    expect(careful.order).toHaveLength(3);
    expect(careful.order).toContain(careful.recommended);
    for (const id of careful.order) {
      const level = careful.levels[id];
      expect(level?.line.endsWith('.')).toBe(true);
      if (level?.mode === 'enforce') {
        const pack = join(
          __dirname,
          '..',
          '..',
          '..',
          'assets',
          'packs',
          `${level.pack}.toml`,
        );
        expect(existsSync(pack)).toBe(true);
      }
    }
  });

  it('names the two modes in plain words', () => {
    expect(Object.keys(contract().modes).sort()).toEqual(['enforce', 'observe']);
  });

  it('keeps plumbing words out of every page, tab, view and section label', () => {
    const labels = contract().pages.flatMap((page) =>
      [...(page.tabs ?? []), ...(page.views ?? []), ...(page.sections ?? [])].map((each) => each.label),
    );
    for (const label of labels)
      for (const word of PLUMBING_WORDS)
        expect(label.toLowerCase()).not.toContain(word.toLowerCase());
  });

  it('opens onboarding on what Memnox is for and ends it set', () => {
    const steps = contract().onboarding;
    expect(steps.at(-1)?.id).toBe('done');
    expect(steps.some((step) => step.id === 'careful')).toBe(true);
  });
});

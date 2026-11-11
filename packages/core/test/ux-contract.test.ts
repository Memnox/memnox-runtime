import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ALLOW_LABEL,
  ALWAYS_DENY_LABEL,
  HOLD_ANSWER_LABEL,
  HOLD_ANSWER_ORDER,
  HOLD_OUTCOME_WORD,
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
  pages: { id: string }[];
}

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
});

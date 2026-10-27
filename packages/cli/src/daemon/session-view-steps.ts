import { isAbsolute, normalize } from 'node:path';
import {
  DECISION_EFFECT,
  DELIVERY,
  DELIVERY_OPERATION,
  type ReplayStep,
  type SessionViewStep,
} from '@memnox/core';

/**
 * One ledger row as a line in the live window's list of steps, said the way a person reads it.
 */

/** As long a command line as a window row shows before it is cut. */
const MOST_STEP_CHARS = 90;

export function stepOf(step: ReplayStep): SessionViewStep {
  const target = step.target === undefined ? '' : ` ${shortTarget(step.target)}`;
  const text =
    step.operation === DELIVERY_OPERATION
      ? deliveredAs(step.target)
      : `${verbOf(step.operation) ?? step.summary}${target}`;
  return {
    at: step.at,
    surface: step.surface ?? 'action',
    text:
      text.length <= MOST_STEP_CHARS ? text : `${text.slice(0, MOST_STEP_CHARS - 1)}…`,
    ...(step.failed === true ? { failed: true } : {}),
    ...(step.effect === DECISION_EFFECT.DENY ? { refused: true } : {}),
  };
}

/** The ledger's operations as a person reads them down a list. */
const VERBS: Record<string, string> = {
  'file.edit': 'Edited',
  'file.read': 'Read',
  'filesystem.read': 'Read',
  'filesystem.write': 'Wrote in',
  'filesystem.delete': 'Deleted',
  'shell.exec': 'Ran',
  'http.request': 'Fetched',
  'http.connect': 'Connected to',
  'git.commit': 'Committed',
  'git.push': 'Pushed',
  'git.pull': 'Pulled',
  'git.checkout': 'Switched to',
  'session.summary': 'Finished its turn',
};

/** What became of the person's own words to the session, said as they would say it rather than as the ledger's row. */
const DELIVERED: Record<string, string> = {
  [DELIVERY.VERIFIED]: 'Your message went in',
  [DELIVERY.TYPED]: 'Your message was typed in',
  [DELIVERY.WAITING]: 'Your message waits for its next prompt',
  [DELIVERY.CLIPBOARD]: 'Your message was left on the clipboard',
  [DELIVERY.NOT_ALLOWED]: 'Your message was left on the clipboard',
  [DELIVERY.FAILED]: 'Your message did not go in',
};

export function deliveredAs(outcome: string | undefined): string {
  return (
    (outcome === undefined ? undefined : DELIVERED[outcome]) ?? 'You sent it a message'
  );
}

function verbOf(operation: string | undefined): string | undefined {
  if (operation === undefined) return undefined;
  return VERBS[operation] ?? operation.replace(/[._]/g, ' ');
}

/** A path by its last two parts, which is how a file is recognised at a glance. */
function shortTarget(target: string): string {
  if (!isAbsolute(target) && !target.startsWith('../')) return target;
  return normalize(target)
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .slice(-2)
    .join('/');
}

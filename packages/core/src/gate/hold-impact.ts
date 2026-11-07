import { TOOL_CLASS, type ToolClass } from '../discovery/classify';
import { redactSecrets } from '../domain/redact';
import { REVERSIBILITY, reversibilityOf } from '../session/reversibility';
import { TESTS_STANDING, type WorkEvidence } from '../session/work-evidence';
import type { HoldRequest } from './hold';

/**
 * What a held action could affect, undo and has verified, each with how it is known: recorded,
 * inferred and only ever said as "may", or unknown. Written once, so every surface says the same.
 */

export const CLAIM_BASIS = {
  RECORDED: 'recorded',
  EXTRACTED: 'extracted',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
} as const;

export type ClaimBasis = (typeof CLAIM_BASIS)[keyof typeof CLAIM_BASIS];

export interface HoldClaim {
  text: string;
  basis: ClaimBasis;
  /** Where it came from, for the advanced view. */
  source: string;
}

export interface HoldImpact {
  affected: HoldClaim;
  undo: HoldClaim;
  verified: HoldClaim[];
}

const TOOL_CLASSES: readonly string[] = Object.values(TOOL_CLASS);

/** The namespace an operation belongs to, which says which surface a milestone covers. */
function surfaceOf(operation: string): string {
  return operation.split('.')[0] ?? '';
}

function affectedOf(target: string | undefined): HoldClaim {
  if (target === undefined || target.trim() === '') {
    return {
      text: 'Not established what this would affect.',
      basis: CLAIM_BASIS.UNKNOWN,
      source: 'nothing in the request names a target',
    };
  }
  return {
    text: `It would affect ${redactSecrets(target.trim())}.`,
    basis: CLAIM_BASIS.RECORDED,
    source: 'the action as the agent asked for it',
  };
}

function undoOf(operation: string, toolClass: string | undefined): HoldClaim {
  if (toolClass === undefined || !TOOL_CLASSES.includes(toolClass)) {
    return {
      text: 'Not established whether this can be undone.',
      basis: CLAIM_BASIS.UNKNOWN,
      source: 'the action was not classified',
    };
  }
  const reversibility = reversibilityOf(
    operation,
    toolClass as ToolClass,
    surfaceOf(operation),
  );
  const source = `read from the kind of action (${toolClass}), not checked against what it touches`;
  if (reversibility === REVERSIBILITY.IRREVERSIBLE) {
    return {
      text: 'This may not be undoable once it runs.',
      basis: CLAIM_BASIS.INFERRED,
      source,
    };
  }
  if (reversibility === REVERSIBILITY.SNAPSHOT) {
    return {
      text: 'A Memnox milestone may be able to put this back. Memnox has not verified it.',
      basis: CLAIM_BASIS.INFERRED,
      source,
    };
  }
  return {
    text: 'Not established whether this can be undone: undoing it would need a second action nobody has recorded.',
    basis: CLAIM_BASIS.UNKNOWN,
    source,
  };
}

function testsOf(work: WorkEvidence | undefined): HoldClaim {
  const source = 'the test commands run in this session';
  if (work === undefined || work.tests === TESTS_STANDING.NONE) {
    return {
      text: 'No test results are available yet.',
      basis: CLAIM_BASIS.UNKNOWN,
      source,
    };
  }
  const command =
    work.testCommand === undefined ? '' : ` (${redactSecrets(work.testCommand)})`;
  if (work.tests === TESTS_STANDING.PASSED) {
    return {
      text: `The tests last passed${command}.`,
      basis: CLAIM_BASIS.RECORDED,
      source,
    };
  }
  if (work.tests === TESTS_STANDING.FAILED) {
    return {
      text: `The tests last failed${command}.`,
      basis: CLAIM_BASIS.RECORDED,
      source,
    };
  }
  return {
    text: `The tests passed${command}, then files changed, so they no longer cover this work.`,
    basis: CLAIM_BASIS.RECORDED,
    source,
  };
}

/** The three parts of the default explanation, each with how it is known. */
export function holdImpact(
  request: Pick<HoldRequest, 'operation' | 'target' | 'class'>,
  work?: WorkEvidence,
): HoldImpact {
  return {
    affected: affectedOf(request.target),
    undo: undoOf(request.operation, request.class),
    verified: [
      {
        text: 'The request was stopped and recorded before it ran.',
        basis: CLAIM_BASIS.RECORDED,
        source: 'this hold',
      },
      testsOf(work),
    ],
  };
}

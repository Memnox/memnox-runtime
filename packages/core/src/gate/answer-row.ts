import { DECISION_EFFECT } from '../constants/decision.constants';
import { ENFORCEMENT_MODE } from '../constants/enforcement.constants';
import { TOOL_CLASS, type ToolClass } from '../discovery/classify';
import { digest } from '../domain/digest';
import { redactSecrets } from '../domain/redact';
import {
  ACTOR_TYPE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  type MemnoxEvent,
} from '../event/event';
import { newEventId } from '../event/seam-row';
import { describeHeldCall, HOLD_ANSWER, type HoldAnswer, type HoldRequest } from './hold';

/**
 * A held call answered away from its own terminal, written into the agent's session as the
 * person's own row, so `replay` and `why` say who let it through and in what words. The
 * words are masked, because a person reading out a token is still reading out a token.
 */

export interface AnswerRowInput {
  request: HoldRequest;
  answer: HoldAnswer;
  /** Who, and through what: `person (voice)`, `person (Touch ID)`. */
  by: string;
  /** What the person said, when it was said out loud. */
  said?: string;
  at: string;
}

const LETS_THROUGH: readonly HoldAnswer[] = [HOLD_ANSWER.ONCE, HOLD_ANSWER.SESSION];

const CLASSES: readonly string[] = Object.values(TOOL_CLASS);

export function answerRow(input: AnswerRowInput): MemnoxEvent {
  const { request, answer, by, at } = input;
  const allowed = LETS_THROUGH.includes(answer);
  const words =
    input.said === undefined || input.said.trim() === ''
      ? ''
      : `, saying "${redactSecrets(input.said.trim())}"`;
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at,
    sessionId: request.sessionId,
    agent: request.agent,
    actorType: ACTOR_TYPE.HUMAN,
    principal: by,
    surface: EVENT_SURFACE.QUESTION,
    operation: request.operation,
    ...(request.target === undefined ? {} : { target: request.target }),
    class: classOf(request.class),
    effect: allowed ? DECISION_EFFECT.ALLOW : DECISION_EFFECT.DENY,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: `${by} answered "${answer}" to ${request.agent} wanting to ${describeHeldCall(request)}${words}`,
    // A digest of what was named, never its content, as every other row.
    argsDigest: digest(request.target ?? request.operation),
    ...(allowed ? { authorizedBy: by } : {}),
  };
}

function classOf(named: string | undefined): ToolClass {
  // Checked against the class list on the line above, so the cast names one of them.
  return named !== undefined && CLASSES.includes(named)
    ? (named as ToolClass)
    : TOOL_CLASS.UNKNOWN;
}

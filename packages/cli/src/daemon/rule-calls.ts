import { DAEMON_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { namedList, proposeSpokenRule } from '../protect/spoken-rule';
import { runClaudeOnce, type LocalRun } from '../operator/rule-brain';
import type { CloudCall } from '../sync/rule-draft-cloud';

/**
 * RULE, which a phone or the Mac sends with what the person said: the draft read back and either
 * its open questions or the proposal to confirm. The confirm is the usual one, signed as any rule.
 * The person's own model on this machine drafts what the grammar cannot, so the sentence stays here.
 */

export function isRuleMethod(method: string): boolean {
  return method === DAEMON_METHOD.RULE;
}

/** The cloud and the local model a test puts in place of the real ones. */
interface AnswerRuleDeps {
  cloud?: CloudCall;
  local?: LocalRun;
}

export async function answerRule(
  home: string,
  request: DaemonRequest,
  now: string,
  { cloud, local }: AnswerRuleDeps = {},
): Promise<DaemonResponse> {
  const said = request.said?.trim() ?? '';
  if (said === '')
    return { id: request.id, ok: false, error: 'rule needs what was said' };
  const answer = await proposeSpokenRule(said, namedList(request.approved), {
    home,
    env: process.env,
    at: now,
    ...(cloud === undefined ? {} : { cloud }),
    ...(local === undefined ? { local: runClaudeOnce } : { local }),
  });
  if ('refused' in answer)
    return {
      id: request.id,
      ok: false,
      error: answer.refused,
      reason: answer.refused,
      ...(answer.upgrade === true ? { upgrade: true } : {}),
    };
  return {
    id: request.id,
    ok: true,
    rule: answer,
    ...(answer.proposed === undefined ? {} : { proposed: answer.proposed }),
  };
}

import { DAEMON_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { namedList, proposeSpokenRule } from '../protect/spoken-rule';
import type { CloudCall } from '../sync/rule-draft-cloud';

/**
 * RULE, which a phone or the Mac sends with what the person said: the draft read back and either
 * its open questions or the proposal to confirm. The confirm is the usual one, signed as any rule.
 */

export function isRuleMethod(method: string): boolean {
  return method === DAEMON_METHOD.RULE;
}

export async function answerRule(
  home: string,
  request: DaemonRequest,
  now: string,
  cloud?: CloudCall,
): Promise<DaemonResponse> {
  const said = request.said?.trim() ?? '';
  if (said === '')
    return { id: request.id, ok: false, error: 'rule needs what was said' };
  const answer = await proposeSpokenRule(said, namedList(request.approved), {
    home,
    env: process.env,
    at: now,
    ...(cloud === undefined ? {} : { cloud }),
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

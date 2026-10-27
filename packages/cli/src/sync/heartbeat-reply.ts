import {
  approvalRouteOf,
  HOLD_ANSWER,
  isEnforcementMode,
  loadOrCreateConfig,
  readAccount,
  saveConfig,
  writeAccount,
  type Account,
  type EnforcementMode,
  type HoldAnswer,
  type PendingApprovals,
} from '@memnox/core';

import { recordAnswer } from '../daemon/record-answer';

/**
 * What a heartbeat's reply asks of this machine: a mode, where questions go, and answers to
 * the calls it holds. Each is applied on a change only, and none may ever fail the beat.
 */

const ANSWERS: readonly string[] = Object.values(HOLD_ANSWER);

export interface HeartbeatAnswer {
  id: string;
  answer: string;
  by?: string;
  /** What the person said with a no, which the agent is told beside the rule's way forward. */
  reason?: string;
}

/**
 * Moving this machine along the ramp when the control plane says to, in either direction.
 * Applied on a change only, so a deliberate edit to `config.toml` is not reverted a minute later.
 */
export async function applyMode(input: {
  home: string;
  account: Account;
  running: EnforcementMode;
  told: string | undefined;
}): Promise<void> {
  const { home, account, running, told } = input;
  // A word from a newer control plane is not a mode the gate here can read.
  if (told === undefined || !isEnforcementMode(told)) return;
  if (told === account.cloudMode) return;

  try {
    // The account first, so a failed config write is not retried every minute.
    await writeAccount(home, { ...account, cloudMode: told });
    if (told === running) return;
    const config = await loadOrCreateConfig(home);
    await saveConfig(home, { ...config, mode: told });
  } catch {
    // Silent, because a machine that cannot be graduated must still beat.
  }
}

/**
 * Where questions go, when the workspace sets it. Set here or there, whichever changed
 * last: applied on a change only, so an edit to `config.toml` holds until the workspace
 * says something different. Read afresh, since `applyMode` may have just written the account.
 */
export async function applyApprovalRoute(
  home: string,
  told: string | undefined,
): Promise<void> {
  const route = told === undefined ? null : approvalRouteOf(told);
  if (route === null) return;
  try {
    const account = await readAccount(home);
    if (account === null || route === account.cloudApprovals) return;
    await writeAccount(home, { ...account, cloudApprovals: route });
    const config = await loadOrCreateConfig(home);
    if (config.approvals !== route)
      await saveConfig(home, { ...config, approvals: route });
  } catch {
    // Silent, for the reason a mode is: a machine that cannot be told must still beat.
  }
}

/**
 * Written into the file the seam is already polling, so a remote answer and a second
 * terminal arrive by the same route, and into the ledger as the person's own row, so `why`
 * says who let it through. An id this machine did not raise is dropped.
 */
export async function applyAnswers(
  home: string,
  approvals: PendingApprovals,
  answers: readonly HeartbeatAnswer[],
  at: string,
): Promise<void> {
  for (const answer of answers) {
    if (!ANSWERS.includes(answer.answer)) continue;
    // Checked against HOLD_ANSWER on the line above.
    const said = answer.answer as HoldAnswer;
    const by = `${answer.by ?? 'somebody'} (the workspace)`;
    // A field from the wire, so anything but a string is no reason at all.
    const reason = typeof answer.reason === 'string' ? answer.reason : undefined;
    const outcome = await approvals.answer(answer.id, said, by, at, reason);
    if (outcome !== null && 'answered' in outcome) {
      await recordAnswer(home, {
        request: outcome.answered.request,
        answer: said,
        by,
        at,
      });
    }
  }
}

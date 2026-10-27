import { answerRow, type AnswerRowInput } from '@memnox/core';
import { withEvents } from '../event-store';

/**
 * The person's answer, written into the agent's session. After the answer rather than
 * before it, and never able to undo it: an agent already released is not held again because
 * the ledger could not be opened.
 */
export async function recordAnswer(home: string, input: AnswerRowInput): Promise<void> {
  try {
    await withEvents(home, (store) => store.append(answerRow(input)));
  } catch {
    // The answer stands; only its row is missing, which `memnox doctor` reports as a ledger fault.
  }
}

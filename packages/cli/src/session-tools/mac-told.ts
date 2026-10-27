import type { DisplayDelivery } from '@memnox/core';

/** The Mac said the step only the person can take, so anything the brain adds says it twice. */
const MAC_TOLD =
  'The Mac has already said out loud what went wrong and what they need to do. Write nothing at all this turn: every word you add repeats what they just heard.';

/** What the brain is told for a delivery that failed, unless the Mac already told the person. */
export function unlessMacTold(delivery: DisplayDelivery, said: string): string {
  return delivery.told === true ? MAC_TOLD : said;
}

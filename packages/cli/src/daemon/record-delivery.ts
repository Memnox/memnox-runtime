import { deliveryRow, type DeliveryRowInput } from '@memnox/core';
import { withEvents } from '../event-store';

/**
 * What became of the person's instruction, written into the agent's session after the Mac
 * reported it, so the black box shows whether it landed and how that was known.
 */
export async function recordDelivery(
  home: string,
  input: DeliveryRowInput,
): Promise<void> {
  try {
    await withEvents(home, (store) => store.append(deliveryRow(input)));
  } catch {
    // The delivery stands; only its row is missing, which `memnox doctor` reports as a ledger fault.
  }
}

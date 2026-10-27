/** The team's own sensitive data patterns a pulled bundle carries, kept only where they load. */
import { validatePolicyDocument, type DataPattern } from '@memnox/core';

/**
 * Each of the team's patterns the gate's own validator takes, one at a time, so a single
 * regex this runtime cannot compile drops itself rather than the whole rule set.
 */
export function loadablePatterns(
  published: readonly DataPattern[] | undefined,
): DataPattern[] {
  if (published === undefined) return [];
  return published.flatMap((entry) => {
    try {
      return (
        validatePolicyDocument({ version: 1, policies: [], classifications: [entry] })
          .classifications ?? []
      );
    } catch {
      // Refused by the validator: the rest of the bundle still applies without it.
      return [];
    }
  });
}

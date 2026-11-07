import { PROPOSAL_ANSWER, PROPOSAL_KIND, type ProposedChange } from '@memnox/core';
import { putBackupBack } from '../backup/backup-restore';

/** A signed restore carried out from its staged copy. Null where the proposal is not one, so the caller carries on. */
export async function applyBackupProposal(
  home: string,
  change: ProposedChange,
  now: Date,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string } | null> {
  if (change.kind !== PROPOSAL_KIND.BACKUP_RESTORE) return null;
  const put = await putBackupBack(home, change.staged, now);
  return 'refused' in put
    ? { ok: false, error: put.refused }
    : { ok: true, outcome: `${PROPOSAL_ANSWER.CONFIRMED}: ${put.outcome}` };
}

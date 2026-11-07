import {
  BACKUP_METHOD,
  sealBackup,
  SHORTEST_PASSPHRASE,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { backupEntries } from '../backup/backup-set';
import { proposeRestore, summaryOf } from '../backup/backup-restore';

/**
 * The backup methods, on the local socket only: a backup is the whole setup, so it never leaves by
 * the relay. Making one changes nothing; putting one back widens, so it waits on a signature.
 */

const BACKUP_METHODS: readonly string[] = Object.values(BACKUP_METHOD);

export function isBackupMethod(method: string): boolean {
  return BACKUP_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function backupAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  return { id: request.id, ...answered };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const passphrase = request.backupPassphrase;
  if (passphrase === undefined || passphrase.length < SHORTEST_PASSPHRASE)
    return refused(`A backup passphrase is at least ${SHORTEST_PASSPHRASE} characters.`);
  if (request.method === BACKUP_METHOD.BACKUP_RESTORE) {
    if (request.backupArchive === undefined)
      return refused('Send the backup to put back.');
    const restore = await proposeRestore(home, request.backupArchive, passphrase, now);
    if ('refused' in restore) return refused(restore.refused);
    return { ok: true, proposed: restore.proposed, backupSummary: restore.summary };
  }
  const entries = await backupEntries(home, request.backupLedger === true);
  if ('refused' in entries) return refused(entries.refused);
  const contents = { createdAt: now.toISOString(), entries };
  return {
    ok: true,
    backupArchive: await sealBackup(contents, passphrase),
    backupSummary: summaryOf(contents),
  };
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

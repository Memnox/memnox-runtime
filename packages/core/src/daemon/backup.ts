/**
 * Backing up what a person set up on this machine and restoring it: rules, hubs, skills, projects
 * and memory, sealed under a passphrase, and never a secret. Both are the local socket's alone.
 */

export const BACKUP_METHOD = {
  /** Seals the setup under a passphrase and hands the archive back as text. */
  BACKUP_CREATE: 'backup-create',
  /** Opens an archive and proposes putting it back, which holds once the person signs it. */
  BACKUP_RESTORE: 'backup-restore',
} as const;

/** What an archive holds, so a screen says it before anything is restored. */
export interface BackupSummary {
  createdAt: string;
  /** Under the Memnox home, by path. */
  files: string[];
  /** The ledger rides along; it is only ever restored where there is none. */
  ledger: boolean;
}

export interface BackupRequestFields {
  /** On CREATE and RESTORE. Never stored, never logged. */
  backupPassphrase?: string;
  /** On RESTORE: the archive as CREATE handed it back. */
  backupArchive?: string;
  /** On CREATE: carry the ledger too. */
  backupLedger?: boolean;
}

export interface BackupResponseFields {
  /** On CREATE. */
  backupArchive?: string;
  /** On CREATE and RESTORE: what the archive holds. */
  backupSummary?: BackupSummary;
}

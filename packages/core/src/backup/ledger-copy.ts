import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { databasePathFor } from '../event/sqlite-store';

/**
 * The ledger copied whole through SQLite's own backup, since it runs in WAL and its file alone
 * may not yet hold the latest rows. False where there is no ledger to copy.
 */
export async function copyLedgerTo(home: string, destination: string): Promise<boolean> {
  const source = databasePathFor(home);
  if (!existsSync(source)) return false;
  const db = new Database(source, { fileMustExist: true });
  try {
    await db.backup(destination);
    return true;
  } finally {
    db.close();
  }
}

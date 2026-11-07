import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  copyLedgerTo,
  DATABASE_FILE,
  DECIDED_RULES_FILE,
  hubPathFor,
  MEMNOX_HOME,
  POLICY_REGISTRY_FILE,
  PROJECTS_DIR,
  SKILLS_HUB_FILE,
  WORKSPACE_MEMORY_FILE,
  type BackupEntry,
} from '@memnox/core';
import { machinePolicyPath } from '../protect/machine-rules';

/**
 * What a backup carries, named one by one so nothing else is ever in it: the rules, the hubs, the
 * skills, the projects and the memory. Keys, devices, accounts and the OS store's secrets never are.
 */

/** The Skills Hub's personal folder under the Memnox home. */
const SKILLS_FOLDER = 'skills';

/** A bound on one backup, so a folder somebody filled by hand never takes the daemon with it. */
const MOST_BACKUP_FILES = 5_000;

/** The files and folders under the Memnox home a backup may hold, and nothing else. */
export function backupAllowed(home: string): { files: string[]; dirs: string[] } {
  return {
    files: [
      basename(machinePolicyPath(home)),
      POLICY_REGISTRY_FILE,
      basename(hubPathFor(home)),
      SKILLS_HUB_FILE,
      WORKSPACE_MEMORY_FILE,
      DECIDED_RULES_FILE,
      DATABASE_FILE,
    ],
    dirs: [SKILLS_FOLDER, PROJECTS_DIR],
  };
}

/** Every file the backup holds, the ledger only when asked, each by its path under the Memnox home. */
export async function backupEntries(
  home: string,
  ledger: boolean,
): Promise<BackupEntry[] | { refused: string }> {
  const root = join(home, MEMNOX_HOME);
  const allowed = backupAllowed(home);
  const paths = allowed.files.filter(
    (file) => file !== DATABASE_FILE && existsSync(join(root, file)),
  );
  for (const dir of allowed.dirs) paths.push(...(await filesIn(root, dir)));
  if (paths.length > MOST_BACKUP_FILES)
    return { refused: `There are more than ${MOST_BACKUP_FILES} files to back up.` };
  const entries = await Promise.all(
    paths.map(async (path) => ({
      path,
      data: (await readFile(join(root, path))).toString('base64'),
    })),
  );
  if (!ledger) return entries;
  const copied = await ledgerEntry(home);
  return copied === null ? entries : [...entries, copied];
}

/** Every regular file in one folder, by its path under the Memnox home; links are never followed. */
async function filesIn(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(join(root, dir), {
    recursive: true,
    withFileTypes: true,
  }).catch(
    // No folder yet holds nothing to back up.
    () => [],
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

async function ledgerEntry(home: string): Promise<BackupEntry | null> {
  const dir = await mkdtemp(join(tmpdir(), 'memnox-ledger-'));
  try {
    const copy = join(dir, DATABASE_FILE);
    if (!(await copyLedgerTo(home, copy))) return null;
    return { path: DATABASE_FILE, data: (await readFile(copy)).toString('base64') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DATABASE_FILE,
  isBackupPath,
  MEMNOX_HOME,
  minutesToMs,
  openBackup,
  PROPOSAL_KIND,
  Proposals,
  readHub,
  readSkillsHub,
  TOOL_CLASS,
  type BackupContents,
  type BackupSummary,
} from '@memnox/core';
import { CONFIG_RULE, recordConfigChanges, RESTORES_DIR } from '../keeper/config-events';
import { syncHub } from '../mcp/hub-writer';
import { describeCount } from '../plural';
import { syncSkills } from '../skills/skills-writer';
import { backupAllowed } from './backup-set';

/**
 * Putting a backup back. The archive is opened and checked, then staged under the Memnox home by its
 * digest and proposed; only once the person signs is anything written, and only if the staged copy
 * is still byte for byte what was proposed. A ledger already here is never written over.
 */

/** Who the card names as having proposed it: the backup, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-backup';
const PROPOSAL_TTL_MS = minutesToMs(5);
const OWNER_ONLY_FILE = 0o600;
const OPERATION = 'backup.restored';

function stagedPathFor(home: string, digest: string): string {
  return join(home, MEMNOX_HOME, RESTORES_DIR, `${digest}.json`);
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The archive opened, staged and proposed, or why it will not be. */
export async function proposeRestore(
  home: string,
  archive: string,
  passphrase: string,
  now: Date,
): Promise<{ proposed: string; summary: BackupSummary } | { refused: string }> {
  const contents = await openBackup(archive, passphrase);
  if ('refused' in contents) return contents;
  const outside = strayPaths(home, contents);
  if (outside.length > 0)
    return {
      refused: `The backup holds what a backup never does: ${outside.join(', ')}.`,
    };
  const text = JSON.stringify(contents);
  const staged = sha256(text);
  const path = stagedPathFor(home, staged);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, text, { mode: OWNER_ONLY_FILE });
  const summary = summaryOf(contents);
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.BACKUP_RESTORE, staged, ...summary },
    rationale: `Put back the backup made ${summary.createdAt}: ${describeCount(summary.files.length, 'file')} of rules, hubs, skills, projects and memory`,
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { proposed: proposal.id, summary };
}

export function summaryOf(contents: BackupContents): BackupSummary {
  return {
    createdAt: contents.createdAt,
    files: contents.entries
      .map((entry) => entry.path)
      .filter((path) => path !== DATABASE_FILE),
    ledger: contents.entries.some((entry) => entry.path === DATABASE_FILE),
  };
}

function strayPaths(home: string, contents: BackupContents): string[] {
  const allowed = backupAllowed(home);
  return contents.entries
    .map((entry) => entry.path)
    .filter((path) => !isBackupPath(path, allowed));
}

/** The signed restore carried out from the staged copy, which must still be what was proposed. */
export async function putBackupBack(
  home: string,
  staged: string,
  now: Date,
): Promise<{ outcome: string } | { refused: string }> {
  const path = stagedPathFor(home, staged);
  const text = await readFile(path, 'utf8').catch((): string | null => null);
  if (text === null || sha256(text) !== staged)
    return {
      refused:
        'The staged backup changed or is gone since it was proposed, so nothing was put back.',
    };
  // Cast is safe: the bytes are exactly those staged after the archive was opened and checked.
  const contents = JSON.parse(text) as BackupContents;
  if (strayPaths(home, contents).length > 0)
    return {
      refused:
        'The staged backup holds what a backup never does, so nothing was put back.',
    };
  const written = await writeEntries(home, contents);
  await rm(path, { force: true });
  await recordRestored(home, written, { createdAt: contents.createdAt, now });
  await syncHub(home, await readHub(home));
  await syncSkills(home, await readSkillsHub(home), now);
  const ledger = contents.entries.some((entry) => entry.path === DATABASE_FILE);
  const kept =
    ledger && !written.includes(DATABASE_FILE)
      ? ', and the ledger here kept as it was'
      : '';
  return {
    outcome: `${describeCount(written.length, 'file')} put back${kept}`,
  };
}

/** One `config` row per file put back, naming it, so `why` answers what replaced it and when. */
async function recordRestored(
  home: string,
  written: readonly string[],
  { createdAt, now }: { createdAt: string; now: Date },
): Promise<void> {
  await recordConfigChanges(
    home,
    written.map((file) => ({
      operation: OPERATION,
      file: join(home, MEMNOX_HOME, file),
      summary: `${file} put back from the backup made ${createdAt}`,
      class: TOOL_CLASS.WRITE,
      rule: CONFIG_RULE.BACKUP,
    })),
    now,
  );
}

/** Every file written over what is here, except a ledger, which is only ever written where there is none. */
async function writeEntries(home: string, contents: BackupContents): Promise<string[]> {
  const root = join(home, MEMNOX_HOME);
  const written: string[] = [];
  for (const entry of contents.entries) {
    const path = join(root, entry.path);
    if (entry.path === DATABASE_FILE && existsSync(path)) continue;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.from(entry.data, 'base64'), { mode: OWNER_ONLY_FILE });
    written.push(entry.path);
  }
  return written;
}

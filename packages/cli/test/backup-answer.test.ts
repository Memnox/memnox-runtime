import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  databasePathFor,
  emptyHub,
  HUB_TRANSPORT,
  MEMNOX_HOME,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  proposalCapability,
  readHub,
  remoteCapabilityFor,
  SqliteEventStore,
  TOOL_CLASS,
  withServer,
  writeHub,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { backupAnswer, isBackupMethod } from '../src/daemon/backup-answer';
import { confirmAnswer } from '../src/daemon/confirm';
import { CONFIG_RULE, recordConfigChanges } from '../src/keeper/config-events';
import { isScreenMethod } from '../src/daemon/home-status';

/**
 * A backup made on one machine and put back on another: rules, hub, skills and projects carried,
 * keys and accounts never, nothing written before the person signs, and a ledger never written over.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const PASSPHRASE = ['a', 'long', 'enough', 'phrase'].join(' ');

interface Machine {
  home: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  confirm(subject: string | undefined): Promise<{ ok: boolean; said: string }>;
}

async function machine(): Promise<Machine> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-backup-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  let id = 0;
  return {
    home,
    ask: (request) => {
      id += 1;
      return backupAnswer(
        home,
        { id, method: DAEMON_METHOD.BACKUP_CREATE, ...request } as DaemonRequest,
        NOW,
      );
    },
    confirm: (subject) => confirmed(home, subject, privateKey),
  };
}

async function confirmed(
  home: string,
  subject: string | undefined,
  key: KeyObject,
): Promise<{ ok: boolean; said: string }> {
  if (subject === undefined) throw new Error('nothing was proposed');
  const message = confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED);
  const result = await confirmAnswer(home, {
    subject,
    answer: PROPOSAL_ANSWER.CONFIRMED,
    signature: sign('sha256', Buffer.from(message), key).toString('base64'),
    at: NOW.toISOString(),
  });
  return result.ok
    ? { ok: true, said: result.outcome }
    : { ok: false, said: result.error };
}

/** A machine set up the way a person leaves one: rules, a server, a skill, a project, and a ledger. */
async function setUp(at: Machine): Promise<void> {
  const root = join(at.home, MEMNOX_HOME);
  await writeFile(join(root, 'machine.policies.toml'), 'version = 1\n');
  await writeHub(
    at.home,
    withServer(emptyHub(), {
      name: 'github',
      transport: HUB_TRANSPORT.HTTP,
      url: 'https://api.githubcopilot.com/mcp/',
      env: {},
      secrets: { GITHUB_TOKEN: 'github-token' },
    }),
  );
  await mkdir(join(root, 'skills', 'review', '1.0.0'), { recursive: true });
  await writeFile(join(root, 'skills', 'review', '1.0.0', 'SKILL.md'), '# Review\n');
  await mkdir(join(root, 'projects', 'prj_0123456789ab'), { recursive: true });
  await writeFile(join(root, 'projects', 'prj_0123456789ab', 'project.json'), '{}');
  await writeFile(join(root, 'account.json'), '{"token":"never in a backup"}');
  await recordConfigChanges(
    at.home,
    [
      {
        operation: 'from.only',
        summary: 'a row only the machine backed up holds',
        class: TOOL_CLASS.READ,
        rule: CONFIG_RULE.KEPT,
      },
    ],
    NOW,
  );
}

async function operations(home: string): Promise<string[]> {
  const ledger = SqliteEventStore.forHome(home);
  try {
    return (await ledger.query({ withConfig: true })).map((row) => row.operation);
  } finally {
    ledger.close();
  }
}

describe('the backup methods', () => {
  it('are the local socket alone, and a restore only the Mac signs', () => {
    expect(isBackupMethod('backup-create')).toBe(true);
    expect(isScreenMethod('backup-restore')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.BACKUP_CREATE)).toBeNull();
    expect(remoteCapabilityFor(DAEMON_METHOD.BACKUP_RESTORE)).toBeNull();
    expect(
      proposalCapability({
        kind: PROPOSAL_KIND.BACKUP_RESTORE,
        staged: 'x',
        files: [],
        ledger: false,
        createdAt: NOW.toISOString(),
      }),
    ).toBeNull();
  });

  it('refuses a short passphrase', async () => {
    const at = await machine();
    expect((await at.ask({ backupPassphrase: 'short' })).ok).toBe(false);
  });

  it('carries rules, hub, skills and projects, the ledger when asked, and never a key or an account', async () => {
    const at = await machine();
    await setUp(at);
    const made = await at.ask({ backupPassphrase: PASSPHRASE, backupLedger: true });
    expect(made.ok).toBe(true);
    expect(made.backupSummary).toEqual({
      createdAt: NOW.toISOString(),
      files: [
        'machine.policies.toml',
        'mcp-hub.json',
        'skills/review/1.0.0/SKILL.md',
        'projects/prj_0123456789ab/project.json',
      ],
      ledger: true,
    });
    expect(made.backupArchive).not.toContain('github');
  });

  it('puts a backup back only once signed, and only as it was staged', async () => {
    const from = await machine();
    await setUp(from);
    const made = await from.ask({ backupPassphrase: PASSPHRASE, backupLedger: true });
    const to = await machine();

    const wrong = await to.ask({
      method: DAEMON_METHOD.BACKUP_RESTORE,
      backupArchive: made.backupArchive,
      backupPassphrase: `${PASSPHRASE} again`,
    });
    expect(wrong.ok).toBe(false);

    const proposed = await to.ask({
      method: DAEMON_METHOD.BACKUP_RESTORE,
      backupArchive: made.backupArchive,
      backupPassphrase: PASSPHRASE,
    });
    expect(proposed.proposed).toMatch(/^prp_/);
    expect((await readHub(to.home)).servers).toEqual([]);

    const put = await to.confirm(proposed.proposed);
    expect(put).toEqual({
      ok: true,
      said: `${PROPOSAL_ANSWER.CONFIRMED}: 5 files put back`,
    });
    expect((await readHub(to.home)).servers.map((each) => each.name)).toEqual(['github']);
    expect(existsSync(databasePathFor(to.home))).toBe(true);
    expect(existsSync(join(to.home, MEMNOX_HOME, 'account.json'))).toBe(false);
    expect(await readdir(join(to.home, MEMNOX_HOME, 'restores'))).toEqual([]);
  });

  it('keeps the ledger here and refuses a staged copy changed after it was proposed', async () => {
    const from = await machine();
    await setUp(from);
    const made = await from.ask({ backupPassphrase: PASSPHRASE, backupLedger: true });
    const to = await machine();
    new SqliteEventStore(databasePathFor(to.home)).close();

    const kept = await to.ask({
      method: DAEMON_METHOD.BACKUP_RESTORE,
      backupArchive: made.backupArchive,
      backupPassphrase: PASSPHRASE,
    });
    expect((await to.confirm(kept.proposed)).said).toContain(
      'the ledger here kept as it was',
    );
    // The other machine's own row never arrives here: this ledger was added to, never replaced.
    expect(await operations(to.home)).not.toContain('from.only');
    expect(await operations(to.home)).toContain('backup.restored');

    const again = await to.ask({
      method: DAEMON_METHOD.BACKUP_RESTORE,
      backupArchive: made.backupArchive,
      backupPassphrase: PASSPHRASE,
    });
    const restores = join(to.home, MEMNOX_HOME, 'restores');
    const [staged] = await readdir(restores);
    await writeFile(join(restores, staged ?? ''), '{"createdAt":"x","entries":[]}');
    expect(await to.confirm(again.proposed)).toMatchObject({ ok: false });
  });
});

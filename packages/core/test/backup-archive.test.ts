import { describe, expect, it } from 'vitest';
import { isBackupPath, openBackup, sealBackup, type BackupContents } from '../src/index';

/** A backup sealed under a passphrase opens only with it, and only as it was made. */

const CONTENTS: BackupContents = {
  createdAt: '2026-10-30T12:00:00.000Z',
  entries: [
    { path: 'mcp-hub.json', data: Buffer.from('{"servers":[]}').toString('base64') },
  ],
};

const PASSPHRASE = ['correct', 'horse', 'battery'].join(' ');

describe('a sealed backup', () => {
  it('opens with its passphrase to exactly what went in, and never carries it in the clear', async () => {
    const archive = await sealBackup(CONTENTS, PASSPHRASE);
    expect(archive).not.toContain('servers');
    expect(await openBackup(archive, PASSPHRASE)).toEqual(CONTENTS);
  });

  it('refuses the wrong passphrase, a changed archive, and one that is not ours', async () => {
    const archive = await sealBackup(CONTENTS, PASSPHRASE);
    expect(await openBackup(archive, `${PASSPHRASE}!`)).toHaveProperty('refused');
    const envelope = JSON.parse(archive) as Record<string, unknown>;
    const changedHeader = JSON.stringify({
      ...envelope,
      iv: Buffer.alloc(12).toString('base64'),
    });
    expect(await openBackup(changedHeader, PASSPHRASE)).toHaveProperty('refused');
    expect(await openBackup('{"format":"zip"}', PASSPHRASE)).toEqual({
      refused: 'That is not a Memnox backup.',
    });
  });

  it('takes no cost parameters but its own, so an archive cannot stall the daemon', async () => {
    const envelope = JSON.parse(await sealBackup(CONTENTS, PASSPHRASE)) as {
      kdf: Record<string, unknown>;
    };
    const costly = JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, N: 2 ** 24 } });
    expect(await openBackup(costly, PASSPHRASE)).toEqual({
      refused: 'That is not a Memnox backup.',
    });
  });
});

describe('a path a backup may hold', () => {
  const allowed = { files: ['mcp-hub.json'], dirs: ['skills'] };

  it('is a named file or a file inside a named folder, and never climbs out', () => {
    expect(isBackupPath('mcp-hub.json', allowed)).toBe(true);
    expect(isBackupPath('skills/review/1.0.0/SKILL.md', allowed)).toBe(true);
    expect(isBackupPath('voice/confirm-key.json', allowed)).toBe(false);
    expect(isBackupPath('skills/../voice/confirm-key.json', allowed)).toBe(false);
    expect(isBackupPath('/etc/passwd', allowed)).toBe(false);
    expect(isBackupPath('account.json', allowed)).toBe(false);
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  EXIT,
  PERSONAL_SYNC_STATE,
  writeAccount,
  type DaemonRequest,
  type DaemonResponse,
  type PersonalSyncStatus,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerSyncCommand } from '../src/commands/sync.command';
import type { DaemonDial } from '../src/remote/daemon-dial';
import { plainStyle } from '../src/style';

/** `memnox sync pair` shows the fingerprint and raises the daemon's own proposal, never moving the key itself. */

const FINGERPRINT = '12345 67890 12345 67890 12345 67890';

function status(fields: Partial<PersonalSyncStatus>): PersonalSyncStatus {
  return {
    state: PERSONAL_SYNC_STATE.READY,
    said: 'Synced.',
    kinds: [],
    conflicts: 0,
    skipped: [],
    openedElsewhere: [],
    waiting: [],
    ...fields,
  };
}

class ScriptedDaemon implements DaemonDial {
  readonly asked: DaemonRequest[] = [];
  constructor(private readonly standing: PersonalSyncStatus | null) {}

  ask(request: DaemonRequest): Promise<DaemonResponse | null> {
    this.asked.push(request);
    if (this.standing === null) return Promise.resolve(null);
    const proposing =
      request.method === DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER ||
      request.method === DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT;
    return Promise.resolve({
      id: request.id,
      ok: true,
      personalSync: this.standing,
      ...(proposing ? { proposed: 'prp_key' } : {}),
    });
  }

  follow(): () => void {
    return () => undefined;
  }
}

async function pairCommand(
  daemon: ScriptedDaemon,
  args: string[],
  home = '/nowhere',
): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerSyncCommand(
    program,
    new CliContext(out, plainStyle),
    () => home,
    () => daemon,
  );
  await program.parseAsync(['sync', 'pair', ...args], { from: 'user' });
  return out;
}

function said(out: RecordedOutput): string {
  return [...out.lines, ...out.notes].join('\n');
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('memnox sync pair', () => {
  it('lists the machines waiting for the key, each with its fingerprint', async () => {
    const daemon = new ScriptedDaemon(
      status({
        keyId: 'key_1',
        waiting: [{ machineId: 'm-desktop', fingerprint: FINGERPRINT, sealed: false }],
      }),
    );
    const out = await pairCommand(daemon, []);
    expect(said(out)).toContain('m-desktop');
    expect(said(out)).toContain(FINGERPRINT);
    expect(daemon.asked.map((each) => each.method)).toEqual([
      DAEMON_METHOD.PERSONAL_SYNC_NOW,
    ]);
  });

  it('raises the offer the daemon raises, once the person typed the fingerprint both show', async () => {
    const daemon = new ScriptedDaemon(
      status({
        keyId: 'key_1',
        waiting: [{ machineId: 'm-desktop', fingerprint: FINGERPRINT, sealed: false }],
      }),
    );
    const out = await pairCommand(daemon, ['m-desktop', '--fingerprint', FINGERPRINT]);
    const offer = daemon.asked.find(
      (each) => each.method === DAEMON_METHOD.PERSONAL_SYNC_KEY_OFFER,
    );
    expect(offer?.syncMachineId).toBe('m-desktop');
    expect(offer?.syncFingerprint).toBe(FINGERPRINT);
    expect(said(out)).toContain('prp_key');
    expect(said(out)).toContain('Sign it in the Memnox app');
    expect(process.exitCode).toBe(EXIT.OK);
  });

  it('shows the fingerprint of a key that arrived, and asks for it before accepting', async () => {
    const daemon = new ScriptedDaemon(
      status({ state: PERSONAL_SYNC_STATE.KEY_ARRIVED, arrivedFingerprint: FINGERPRINT }),
    );
    const shown = await pairCommand(daemon, []);
    expect(said(shown)).toContain(FINGERPRINT);
    expect(
      daemon.asked.some((each) => each.method === DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT),
    ).toBe(false);
    await pairCommand(daemon, ['--fingerprint', FINGERPRINT]);
    expect(
      daemon.asked.find((each) => each.method === DAEMON_METHOD.PERSONAL_SYNC_KEY_ACCEPT)
        ?.syncFingerprint,
    ).toBe(FINGERPRINT);
  });

  it('names this machine while it waits, for the one holding the key to pick', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-sync-pair-'));
    await writeAccount(home, {
      version: 1,
      baseUrl: 'https://cloud.example',
      workspaceId: 'ws_1',
      machineId: 'm-new',
      token: 'token',
      privateKey: 'unused',
      enrolledAt: '2026-10-30T12:00:00.000Z',
    });
    const daemon = new ScriptedDaemon(
      status({
        state: PERSONAL_SYNC_STATE.WAITING_FOR_KEY,
        said: 'Waiting for the key.',
      }),
    );
    const out = await pairCommand(daemon, [], home);
    expect(said(out)).toContain('memnox sync pair m-new');
  });

  it('fails plainly when no daemon answers', async () => {
    await pairCommand(new ScriptedDaemon(null), []);
    expect(process.exitCode).toBe(EXIT.FAILED);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_HOOK_TRUST } from '@memnox/core';
import {
  codexStandingLately,
  hookFilesOf,
  needsYouOf,
  pendingActions,
  pendingFactsOf,
  readChanged,
  recordChanged,
} from '../src/needs-you';

/* What only the person can do once setup is done. Each of these was found on a real machine
   by somebody asking: Codex skipping hooks nobody approved, a terminal older than its PATH,
   agents still running without the hook they were just given. */

const NOTHING = {
  codex: { trust: CODEX_HOOK_TRUST.TRUSTED },
  staleTerminal: false,
  changed: [],
};

describe('what setup says needs the person', () => {
  it('says nothing at all where nothing does', () => {
    expect(pendingActions(NOTHING)).toEqual([]);
  });

  it('names the Codex hooks to approve, and where', () => {
    const actions = pendingActions({
      ...NOTHING,
      codex: { trust: CODEX_HOOK_TRUST.UNTRUSTED, untrusted: ['PreToolUse', 'Stop'] },
    });

    expect(actions).toEqual([
      'Approve the Memnox hooks in Codex: open /hooks and trust PreToolUse, Stop.',
    ]);
  });

  it('tells a plugin host to restart and a hook host to start new sessions', () => {
    const actions = pendingActions({
      ...NOTHING,
      changed: ['Hermes', 'Claude Code', 'Codex'],
    });

    expect(actions).toEqual([
      'Restart Hermes, which loads the Memnox plugin only when it starts.',
      'Start new sessions in Claude Code and Codex, since sessions already open run without the new hook.',
    ]);
  });

  it('says to open a new terminal where this one is older than its PATH', () => {
    expect(pendingActions({ ...NOTHING, staleTerminal: true })).toEqual([
      'Open a new terminal, since this one started before the interceptors were on PATH.',
    ]);
  });
});

describe('what this run changed', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-pending-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('names only the agents whose hook file the run wrote or changed', async () => {
    await mkdir(join(home, '.cursor'));
    await writeFile(join(home, '.cursor', 'hooks.json'), '{"same":1}', 'utf8');
    await mkdir(join(home, '.codex'));
    const before = await hookFilesOf(home);
    await writeFile(join(home, '.codex', 'hooks.json'), '{"new":1}', 'utf8');

    const facts = await pendingFactsOf(home, home, before, {
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
    });

    expect(facts.changed).toEqual(['Codex']);
    expect(facts.staleTerminal).toBe(false);
  });
});

describe('what the home keeps saying until it is done', () => {
  /* The Mac app runs setup with no terminal, so nobody saw its last screen. The home says the
     same thing, and an item goes away on its own once the agent shows it picked the change up. */
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-needs-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('keeps what an earlier run left, and moves an agent changed again to this run', async () => {
    await recordChanged(home, ['OpenClaw', 'Codex'], '2026-10-17T01:00:00.000Z');
    await recordChanged(home, ['Codex'], '2026-10-17T02:00:00.000Z');

    expect(await readChanged(home)).toEqual([
      { agent: 'openclaw', name: 'OpenClaw', since: '2026-10-17T01:00:00.000Z' },
      { agent: 'codex-cli', name: 'Codex', since: '2026-10-17T02:00:00.000Z' },
    ]);
  });

  it('clears an agent once the ledger hears from it after the change, and not before', () => {
    const changed = [
      { agent: 'openclaw', name: 'OpenClaw', since: '2026-10-17T01:00:00.000Z' },
    ];

    expect(needsYouOf(changed, [], { trust: CODEX_HOOK_TRUST.TRUSTED })).toEqual([
      'Restart OpenClaw, which loads the Memnox plugin only when it starts.',
    ]);
    expect(
      needsYouOf(changed, [{ agent: 'openclaw', at: '2026-10-17T00:59:00.000Z' }], {
        trust: CODEX_HOOK_TRUST.TRUSTED,
      }),
    ).toHaveLength(1);
    expect(
      needsYouOf(changed, [{ agent: 'openclaw', at: '2026-10-17T01:05:00.000Z' }], {
        trust: CODEX_HOOK_TRUST.TRUSTED,
      }),
    ).toEqual([]);
  });

  it('answers at once from what Codex last said, and asks it again only once that is old', async () => {
    let asked = 0;
    const ask = async (): Promise<{ trust: 'untrusted'; untrusted: string[] }> => {
      asked += 1;
      return { trust: CODEX_HOOK_TRUST.UNTRUSTED, untrusted: ['Stop'] };
    };
    const start = 10_000_000;

    codexStandingLately(home, start, ask);
    await new Promise((done) => setTimeout(done, 0));
    expect(codexStandingLately(home, start + 1000, ask)).toEqual({
      trust: CODEX_HOOK_TRUST.UNTRUSTED,
      untrusted: ['Stop'],
    });
    expect(asked).toBe(1);
    codexStandingLately(home, start + 10 * 60_000, ask);
    expect(asked).toBe(2);
  });
});

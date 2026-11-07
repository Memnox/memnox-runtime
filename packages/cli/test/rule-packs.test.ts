import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  PROPOSAL_KIND,
  Proposals,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  rulesOfPack,
} from '@memnox/core';
import { policiesAnswer } from '../src/daemon/policies-answer';
import { shippedRulePacks } from '../src/studio/rule-packs';

/** The packs Memnox ships load as rule files, are listed for onboarding, and import as signed proposals. */

const NOW = new Date('2026-10-30T12:00:00.000Z');

describe('the shipped rule packs', () => {
  it('are the three onboarding offers, each loading whole', async () => {
    const packs = await shippedRulePacks();

    expect(packs.map((pack) => pack.id)).toEqual([
      'no-outward-writes',
      'read-only-agents',
      'safe-defaults',
    ]);
    for (const pack of packs) {
      const read = rulesOfPack(pack.toml);
      expect('rules' in read ? read.rules.length : read.problems).toBe(pack.ruleCount);
      expect(pack.name).not.toBe(pack.id);
      expect(pack.description).not.toBe('');
    }
  });

  it('are listed on the daemon, readable from a phone, and import as one proposal per rule', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-packs-'));
    const listed = await policiesAnswer(
      home,
      { id: 1, method: DAEMON_METHOD.RULE_PACKS },
      { now: NOW, env: {} },
    );
    const safe = (listed.rulePacks ?? []).find((pack) => pack.id === 'safe-defaults');
    if (safe === undefined) throw new Error('safe defaults is not listed');

    const imported = await policiesAnswer(
      home,
      { id: 2, method: DAEMON_METHOD.RULE_PACK_IMPORT, rulePack: safe.toml },
      { now: NOW, env: {} },
    );

    expect(imported.packProposed).toHaveLength(safe.ruleCount);
    const first = await new Proposals(home).read(imported.packProposed?.[0] ?? '');
    expect(first?.change.kind).toBe(PROPOSAL_KIND.RULES);
    expect(remoteCapabilityFor(DAEMON_METHOD.RULE_PACKS)).toBe(REMOTE_CAPABILITY.SEE);
  });
});

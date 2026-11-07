import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentBindingsPathFor,
  agentIdFor,
  boundRoleOf,
  profilesDirFor,
  defaultProfileIdFor,
  isDefaultProfileId,
  sessionRoleOf,
} from '../src/index';

/**
 * A profile is the job, apart from the harness: the default one a detected agent answers to keeps
 * its ledger key untouched, and a role on a profile only fills the gap a person left.
 */

describe('agent profiles', () => {
  it('give a detected agent a default profile without touching its ledger key', () => {
    expect(defaultProfileIdFor('cursor')).toBe('default-cursor');
    expect(isDefaultProfileId('default-cursor')).toBe(true);
    expect(isDefaultProfileId('reviewer')).toBe(false);
    expect(agentIdFor('cursor')).toBe('agt_cursor');
  });

  it('let --role and MEMNOX_AGENT_ROLE win over the role of a bound profile', () => {
    expect(sessionRoleOf({ flag: 'deployer', inherited: 'ops', profile: 'coder' })).toBe(
      'deployer',
    );
    expect(sessionRoleOf({ inherited: 'ops', profile: 'coder' })).toBe('ops');
    expect(sessionRoleOf({ profile: 'coder' })).toBe('coder');
    expect(sessionRoleOf({ flag: ' ', profile: 'coder' })).toBe('coder');
    expect(sessionRoleOf({})).toBeUndefined();
  });
});

describe('the role of a bound profile, read off disk', () => {
  const homeWith = (bindings: unknown, profile?: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'memnox-bound-role-'));
    mkdirSync(join(dir, '.memnox', 'agents'), { recursive: true });
    mkdirSync(join(dir, '.memnox', 'profiles'), { recursive: true });
    writeFileSync(agentBindingsPathFor(dir), JSON.stringify(bindings));
    if (profile !== undefined) {
      writeFileSync(join(profilesDirFor(dir), 'release.json'), JSON.stringify(profile));
    }
    return dir;
  };
  const bound = { agt_codex: { profileId: 'release', boundAt: '2026-11-07' } };

  it('is the role the bound profile states', async () => {
    const dir = homeWith(bound, { id: 'release', role: 'deployer' });
    expect(await boundRoleOf(dir, 'agt_codex')).toBe('deployer');
    expect(await boundRoleOf(dir, 'agt_cursor')).toBeUndefined();
  });

  it('is nothing for a missing profile, a role that is not one, or a binding naming a path', async () => {
    expect(await boundRoleOf(homeWith(bound), 'agt_codex')).toBeUndefined();
    expect(
      await boundRoleOf(homeWith(bound, { role: 'deploy er; rm' }), 'agt_codex'),
    ).toBeUndefined();
    const escaping = { agt_codex: { profileId: '../../etc/role', boundAt: 'x' } };
    expect(await boundRoleOf(homeWith(escaping), 'agt_codex')).toBeUndefined();
    expect(
      await boundRoleOf(mkdtempSync(join(tmpdir(), 'memnox-none-')), 'agt_codex'),
    ).toBeUndefined();
  });
});

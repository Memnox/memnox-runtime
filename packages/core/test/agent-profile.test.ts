import { describe, expect, it } from 'vitest';
import {
  agentIdFor,
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

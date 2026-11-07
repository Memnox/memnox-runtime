import { describe, expect, it } from 'vitest';
import { agentKindsListed, projectAdmits } from '../src/index';

/**
 * A project's agents list takes profile ids beside kinds: a profile stands for the agents bound to
 * it, and an empty list still means every agent seen working in the project.
 */

const BINDINGS = {
  agt_cursor: { profileId: 'reviewer', boundAt: '2026-11-07T00:00:00.000Z' },
  'agt_codex-cli': { profileId: 'reviewer', boundAt: '2026-11-07T00:00:00.000Z' },
};

describe('a project agents list', () => {
  it('reads a profile as the agents bound to it, and a default profile as its kind', () => {
    expect(agentKindsListed(['reviewer', 'claude-code'], BINDINGS)).toEqual([
      'cursor',
      'codex-cli',
      'claude-code',
    ]);
    expect(agentKindsListed(['default-gemini-cli'], {})).toEqual(['gemini-cli']);
  });

  it('lets a session in by its kind or its profile, and everybody in when the list is empty', () => {
    expect(projectAdmits([], { agentKind: 'cursor', profileId: 'default-cursor' })).toBe(
      true,
    );
    expect(
      projectAdmits(['reviewer'], { agentKind: 'cursor', profileId: 'reviewer' }),
    ).toBe(true);
    expect(
      projectAdmits(['claude-code'], { agentKind: 'cursor', profileId: 'coder' }),
    ).toBe(false);
  });
});

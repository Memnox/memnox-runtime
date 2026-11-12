import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_LEVEL,
  CONNECTION_KIND,
  CONNECTION_STATUS,
  ENFORCEMENT_SEAM,
  levelsOf,
  MEDIATION,
  noLevels,
  PROOF,
  profileLevelsOf,
  type AgentProof,
  type SeamProof,
} from '../src/index';

/**
 * A level is computed from what holds an agent and what was proved, never claimed: only a seam
 * that refused a planted test reads enforced, and an agent that only asks never reads stronger.
 */

const HOOKED = { kind: CONNECTION_KIND.RUNTIME_HOOK, mediation: MEDIATION.INTERPOSED };
const ADVISORY = { kind: CONNECTION_KIND.MCP, mediation: MEDIATION.ADVISORY };
const OBSERVED = { kind: CONNECTION_KIND.OBSERVED, mediation: MEDIATION.OBSERVED };

const PROVED: AgentProof = {
  agentId: 'agt_claude-code',
  kind: 'claude-code',
  installed: ['mcp', 'shell', 'filesystem'],
  tested: ['mcp', 'shell'],
  demonstrated: ['mcp', 'shell'],
};

const SEAMS: SeamProof[] = [
  { seam: 'mcp', state: PROOF.ENFORCED, detail: 'refused' },
  { seam: 'shell', state: PROOF.NOT_ENFORCED, detail: 'went through' },
];

/** The proof ran against the path installed now. */
const CURRENT = { proofDigest: 'path-a', currentDigest: 'path-a' };

describe('capability levels', () => {
  it('read a proof run against another path as no proof, so nothing reads enforced', () => {
    for (const stale of [
      { proofDigest: 'path-a', currentDigest: 'path-b' },
      { proofDigest: 'path-a' },
      { currentDigest: 'path-a' },
      {},
    ]) {
      const levels = levelsOf({
        connection: HOOKED,
        proof: PROVED,
        seams: SEAMS,
        ...stale,
        seen: true,
      });
      expect(Object.values(levels.enforcement)).not.toContain(CAPABILITY_LEVEL.ENFORCED);
      // What the hook itself holds is still checked, and what it does not is only seen.
      expect(levels.enforcement[ENFORCEMENT_SEAM.MCP]).toBe(CAPABILITY_LEVEL.MEDIATED);
      expect(levels.enforcement[ENFORCEMENT_SEAM.FILES]).toBe(CAPABILITY_LEVEL.MEDIATED);
      expect(levels.enforcement[ENFORCEMENT_SEAM.SHELL]).toBe(CAPABILITY_LEVEL.OBSERVED);
      expect(levels.approval).toBe(CAPABILITY_LEVEL.MEDIATED);
    }
  });

  it('read enforced only where a tested seam refused, and held elsewhere as checked', () => {
    const levels = levelsOf({
      connection: HOOKED,
      proof: PROVED,
      seams: SEAMS,
      ...CURRENT,
      seen: true,
    });
    expect(levels.enforcement[ENFORCEMENT_SEAM.MCP]).toBe(CAPABILITY_LEVEL.ENFORCED);
    expect(levels.enforcement[ENFORCEMENT_SEAM.SHELL]).toBe(CAPABILITY_LEVEL.MEDIATED);
    expect(levels.enforcement[ENFORCEMENT_SEAM.FILES]).toBe(CAPABILITY_LEVEL.MEDIATED);
    expect(levels.enforcement[ENFORCEMENT_SEAM.NETWORK]).toBe(CAPABILITY_LEVEL.OBSERVED);
    expect(levels.tools).toBe(CAPABILITY_LEVEL.ENFORCED);
    expect(levels.approval).toBe(CAPABILITY_LEVEL.ENFORCED);
    expect(levels.context).toBe(CAPABILITY_LEVEL.MEDIATED);
  });

  it('never read an advisory connection as enforced, whatever a proof says', () => {
    const levels = levelsOf({
      connection: ADVISORY,
      proof: PROVED,
      seams: SEAMS,
      seen: true,
    });
    const every = [
      levels.context,
      levels.instructions,
      levels.tools,
      levels.activity,
      levels.coordination,
      levels.approval,
      ...Object.values(levels.enforcement),
    ];
    expect(every.every((each) => each === CAPABILITY_LEVEL.ADVISORY)).toBe(true);
  });

  it('read an agent with nothing in front of it as seen, or outside Memnox with no record', () => {
    expect(levelsOf({ connection: OBSERVED, seen: true }).activity).toBe(
      CAPABILITY_LEVEL.OBSERVED,
    );
    expect(levelsOf({ connection: OBSERVED, seen: false })).toEqual(noLevels());
  });

  it('show a profile the weakest of its connections that are not gone', () => {
    const strong = levelsOf({
      connection: HOOKED,
      proof: PROVED,
      seams: SEAMS,
      ...CURRENT,
      seen: true,
    });
    const weak = levelsOf({ connection: ADVISORY, seen: true });
    const profile = profileLevelsOf([
      { status: CONNECTION_STATUS.LIVE, levels: strong },
      { status: CONNECTION_STATUS.IDLE, levels: weak },
      { status: CONNECTION_STATUS.GONE, levels: noLevels() },
    ]);
    expect(profile.enforcement[ENFORCEMENT_SEAM.MCP]).toBe(CAPABILITY_LEVEL.ADVISORY);
    expect(profileLevelsOf([])).toEqual(noLevels());
  });
});

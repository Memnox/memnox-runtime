import { describe, expect, it } from 'vitest';

import {
  HELD_BY,
  PROOF,
  SEAM_STATE,
  SURFACE_KIND,
  agentProofOf,
  seamConfigDigestOf,
  seamTestsOf,
  type SeamCoverage,
  type SeamProof,
} from '../src/index';

/**
 * A proof is evidence a computer reports about itself, so each word claims only what it
 * shows: installed is something in place, tested is a seam asked to refuse, demonstrated
 * is a refusal on the route this agent's own calls take.
 */

const held = (surface: SeamCoverage['surface'], heldBy = HELD_BY.SEAM): SeamCoverage => ({
  surface,
  state: SEAM_STATE.HELD,
  heldBy,
  detail: 'held',
});

const SEAMS: SeamProof[] = [
  { seam: SURFACE_KIND.MCP, state: PROOF.ENFORCED, detail: 'refused' },
  { seam: SURFACE_KIND.SHELL, state: PROOF.NOT_ENFORCED, detail: 'went through' },
  { seam: SURFACE_KIND.GIT, state: PROOF.UNPROVEN, detail: 'hook present' },
  { seam: SURFACE_KIND.FILESYSTEM, state: PROOF.UNPROVEN, detail: 'profile written' },
];

const AGENT = { id: 'claude-code:~', kind: 'claude-code' };

describe("one agent's proof", () => {
  it('demonstrates only a surface a seam refused on the agent route', () => {
    const proof = agentProofOf(
      AGENT,
      [held(SURFACE_KIND.MCP), held(SURFACE_KIND.SHELL), held(SURFACE_KIND.GIT)],
      SEAMS,
    );
    expect(proof.installed).toEqual(['mcp', 'shell', 'git']);
    // Git was only seen to be present, so it was never tested.
    expect(proof.tested).toEqual(['mcp', 'shell']);
    // Shell was tested and let the action through, so it is tested and not demonstrated.
    expect(proof.demonstrated).toEqual(['mcp']);
  });

  it('never counts a seam proof for a surface the agent own hook holds', () => {
    const proof = agentProofOf(AGENT, [held(SURFACE_KIND.MCP, HELD_BY.OWN_HOOK)], SEAMS);
    expect(proof.installed).toEqual(['mcp']);
    expect(proof.tested).toEqual([]);
    expect(proof.demonstrated).toEqual([]);
  });

  it('counts nothing for a surface that is open, whatever its seam did', () => {
    const proof = agentProofOf(
      AGENT,
      [{ surface: SURFACE_KIND.MCP, state: SEAM_STATE.OPEN, detail: 'not wrapped' }],
      SEAMS,
    );
    expect(proof).toMatchObject({ installed: [], tested: [], demonstrated: [] });
  });

  it('says what each seam was asked to do', () => {
    const [mcp, , git] = seamTestsOf(SEAMS);
    expect(mcp?.test).toContain('forbidden tools/call');
    expect(git?.test).toBe('only that the pre-push hook is present');
  });
});

describe('the digest of the enforcement path', () => {
  const agents = [
    { id: 'b', coverage: [held(SURFACE_KIND.SHELL), held(SURFACE_KIND.MCP)] },
    { id: 'a', coverage: [held(SURFACE_KIND.MCP)] },
  ];

  it('is the same however the agents and surfaces were listed', () => {
    const shuffled = [
      { id: 'a', coverage: [held(SURFACE_KIND.MCP)] },
      { id: 'b', coverage: [held(SURFACE_KIND.MCP), held(SURFACE_KIND.SHELL)] },
    ];
    expect(seamConfigDigestOf(shuffled)).toBe(seamConfigDigestOf(agents));
  });

  it('changes when an agent route changes, which ends any proof taken before', () => {
    const unwrapped = [
      { id: 'b', coverage: [held(SURFACE_KIND.SHELL), held(SURFACE_KIND.MCP)] },
      {
        id: 'a',
        coverage: [{ surface: SURFACE_KIND.MCP, state: SEAM_STATE.OPEN, detail: 'unwrapped' }],
      },
    ];
    expect(seamConfigDigestOf(unwrapped)).not.toBe(seamConfigDigestOf(agents));
    const hookInstead = [
      { id: 'b', coverage: [held(SURFACE_KIND.SHELL), held(SURFACE_KIND.MCP)] },
      { id: 'a', coverage: [held(SURFACE_KIND.MCP, HELD_BY.OWN_HOOK)] },
    ];
    expect(seamConfigDigestOf(hookInstead)).not.toBe(seamConfigDigestOf(agents));
  });
});

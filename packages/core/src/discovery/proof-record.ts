import { createHash } from 'node:crypto';

import { HELD_BY, SEAM_STATE, type SeamCoverage } from './coverage';
import { SURFACE_KIND, type SurfaceKind } from './discovery.constants';
import { PROOF, type SeamProof } from './enforcement';

/**
 * What `memnox doctor --prove` found, kept as evidence this computer reports about itself.
 * It is never an independent verification: the machine ran the tests and wrote the answer.
 * Three words are kept apart, because each claims less than the next:
 *
 * - installed: something is in place in front of the surface for this agent;
 * - tested: the seam in front of it was asked to refuse an action, whatever came back;
 * - demonstrated: it refused, and the test went the way this agent's own calls go.
 */

export const PROOF_RECORD_VERSION = 1;

/** The test each seam is given, in words, and whether it travels the route an agent's call takes. */
export const SEAM_TEST: Readonly<Record<string, { test: string; agentPath: boolean }>> = {
  [SURFACE_KIND.MCP]: {
    test: 'a forbidden tools/call sent through the MCP proxy started from PATH',
    agentPath: true,
  },
  [SURFACE_KIND.SHELL]: {
    test: 'git push --force through the git this shell finds first on PATH',
    agentPath: true,
  },
  [SURFACE_KIND.GIT]: { test: 'only that the pre-push hook is present', agentPath: false },
  [SURFACE_KIND.FILESYSTEM]: {
    test: 'only that the kernel profile is written',
    agentPath: false,
  },
  [SURFACE_KIND.NETWORK]: {
    test: 'only that the proxy variables are set',
    agentPath: false,
  },
};

export interface SeamTestResult extends SeamProof {
  /** What was attempted, so a reader knows what a pass does and does not show. */
  test: string;
}

export interface AgentProof {
  agentId: string;
  kind: string;
  installed: SurfaceKind[];
  tested: SurfaceKind[];
  demonstrated: SurfaceKind[];
}

export interface ProofRecord {
  version: typeof PROOF_RECORD_VERSION;
  /** Absent on a machine not enrolled with a workspace. */
  machineId?: string;
  runtimeVersion: string;
  bundleHashApplied?: string;
  modeApplied: string;
  /** ISO time the tests ran. */
  provedAt: string;
  /** The enforcement path the tests ran against; a different digest later means a different path. */
  seamConfigDigest: string;
  seams: SeamTestResult[];
  agents: AgentProof[];
}

/** Each seam's result with the test it was given. */
export function seamTestsOf(proofs: readonly SeamProof[]): SeamTestResult[] {
  return proofs.map((proof) => ({
    ...proof,
    test: SEAM_TEST[proof.seam]?.test ?? 'no test is defined for this seam',
  }));
}

/** One agent's surfaces sorted by how much a proof shows about them, never more than it shows. */
export function agentProofOf(
  agent: { id: string; kind: string },
  coverage: readonly SeamCoverage[],
  seams: readonly SeamProof[],
): AgentProof {
  const held = coverage.filter((each) => each.state === SEAM_STATE.HELD);
  const resultOf = (surface: SurfaceKind): SeamProof | undefined =>
    seams.find((seam) => seam.seam === surface);
  const tested = held.filter((each) => {
    const state = resultOf(each.surface)?.state;
    return (
      each.heldBy !== HELD_BY.OWN_HOOK &&
      (state === PROOF.ENFORCED || state === PROOF.NOT_ENFORCED)
    );
  });
  const demonstrated = tested.filter(
    (each) =>
      resultOf(each.surface)?.state === PROOF.ENFORCED &&
      SEAM_TEST[each.surface]?.agentPath === true,
  );
  return {
    agentId: agent.id,
    kind: agent.kind,
    installed: held.map((each) => each.surface),
    tested: tested.map((each) => each.surface),
    demonstrated: demonstrated.map((each) => each.surface),
  };
}

/**
 * A digest of every agent's enforcement path: what holds each of its surfaces, read with
 * the facts no process's own environment changes. Wrapping or unwrapping a config, adding
 * or removing a hook, taking the interceptors off the login PATH or emptying the rules all
 * change it, and so end the proof.
 */
export function seamConfigDigestOf(
  agents: readonly { id: string; coverage: readonly SeamCoverage[] }[],
): string {
  const canonical = [...agents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((agent) => ({
      id: agent.id,
      coverage: [...agent.coverage]
        .map((each) => [each.surface, each.state, each.heldBy ?? ''])
        .sort((a, b) => a.join().localeCompare(b.join())),
    }));
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

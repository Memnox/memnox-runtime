import { join } from 'node:path';

import {
  agentProofOf,
  bundleHashOn,
  coverageFor,
  MEMNOX_HOME,
  PROOF_RECORD_VERSION,
  readAccount,
  readJsonFile,
  seamConfigDigestOf,
  seamTestsOf,
  writeJsonFile,
  type ProofRecord,
  type SeamCoverage,
  type SeamProof,
} from '@memnox/core';

import { CLI_VERSION } from '../defaults';
import { defaultScanSeams, scanMachine } from '../machine-scan';
import { runningMode } from '../sync/running-mode';
import { processIndependent, readCoverageFacts } from './coverage-facts';
import type { ProbeContext } from './enforcement';

/**
 * The last proof this computer ran, kept so the heartbeat can carry it. It is what the
 * machine reports about itself, and every reader is told so.
 */

const PROOF_FILE = 'proof.json';

/** Long enough that a scan is not repeated every minute, short enough that a rewiring is noticed within the hour. */
const DIGEST_EVERY_MS = 15 * 60 * 1000;

export function proofPath(home: string): string {
  return join(home, MEMNOX_HOME, PROOF_FILE);
}

/** Each agent on this machine with what holds each of its surfaces, read the same way every time. */
async function agentsCoverage(
  context: ProbeContext,
): Promise<{ id: string; kind: string; coverage: SeamCoverage[] }[]> {
  const { report } = await scanMachine(defaultScanSeams(context.dir), {
    probe: false,
    save: false,
  });
  return Promise.all(
    report.agents.map(async (agent) => {
      const facts = processIndependent(
        await readCoverageFacts({ ...context, agent: agent.kind }),
      );
      return {
        id: agent.id,
        kind: agent.kind,
        coverage: coverageFor(agent.kind, agent.id, report.surfaces, facts),
      };
    }),
  );
}

/** Runs the seam tests, joins them to every agent's coverage, and keeps the record. */
export async function proveAndRecord(
  context: ProbeContext,
  probe: (context: ProbeContext) => Promise<SeamProof[]>,
  now: () => number = Date.now,
): Promise<ProofRecord> {
  const proofs = await probe(context);
  const agents = await agentsCoverage(context);
  const account = await readAccount(context.home);
  const bundleHash = await bundleHashOn(context.home);
  const record: ProofRecord = {
    version: PROOF_RECORD_VERSION,
    ...(account === null ? {} : { machineId: account.machineId }),
    runtimeVersion: CLI_VERSION,
    ...(bundleHash === undefined ? {} : { bundleHashApplied: bundleHash }),
    modeApplied: await runningMode(context.home),
    provedAt: new Date(now()).toISOString(),
    seamConfigDigest: seamConfigDigestOf(agents),
    seams: seamTestsOf(proofs),
    agents: agents.map((agent) => agentProofOf(agent, agent.coverage, proofs)),
  };
  await writeJsonFile(proofPath(context.home), record);
  return record;
}

/** The last record kept, or null where no proof has run here, or it is not one this runtime wrote. */
export async function readProofRecord(home: string): Promise<ProofRecord | null> {
  const record = await readJsonFile<ProofRecord>(proofPath(home));
  return record !== null && record.version === PROOF_RECORD_VERSION ? record : null;
}

let held: { at: number; digest: string } | undefined;

/**
 * The enforcement path as it stands now, in the digest a proof keeps, so a heartbeat can
 * say whether the path the proof ran against is still the one in place.
 */
export async function currentSeamDigest(
  context: ProbeContext,
  now: () => number = Date.now,
): Promise<string> {
  const at = now();
  if (held !== undefined && at - held.at < DIGEST_EVERY_MS) return held.digest;
  const digest = seamConfigDigestOf(await agentsCoverage(context));
  held = { at, digest };
  return digest;
}

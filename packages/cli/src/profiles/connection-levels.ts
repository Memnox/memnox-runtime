import {
  levelsOf,
  type AgentConnection,
  type AgentView,
  type ProofRecord,
} from '@memnox/core';
import { currentSeamDigest, readProofRecord } from '../verify/proof-file';

/** The enforcement path installed now, in the digest a proof keeps. */
export type SeamDigestRead = () => Promise<string>;

/**
 * Each connection with how sure Memnox is of every capability through it, from the last proof
 * this machine ran and the ledger rows the agent left. Nothing the agent says is read.
 */
export async function withLevels(
  home: string,
  connections: readonly AgentConnection[],
  views: ReadonlyMap<string, AgentView>,
  seamDigest: SeamDigestRead = () =>
    currentSeamDigest({ home, dir: home, env: process.env }),
): Promise<AgentConnection[]> {
  const record = await readProofRecord(home);
  // Only worth a scan where there is a proof to hold against it.
  const currentDigest = record === null ? undefined : await seamDigest();
  return connections.map((connection) => ({
    ...connection,
    levels: levelsOf({
      connection,
      ...proofOf(record, connection.agentId),
      ...(currentDigest === undefined ? {} : { currentDigest }),
      seen: seenIn(
        connection.agentId === undefined ? undefined : views.get(connection.agentId),
      ),
    }),
  }));
}

function proofOf(
  record: ProofRecord | null,
  agentId: string | undefined,
): Pick<Parameters<typeof levelsOf>[0], 'proof' | 'seams' | 'proofDigest'> {
  if (record === null || agentId === undefined) return {};
  const proof = record.agents.find((each) => each.agentId === agentId);
  return proof === undefined
    ? {}
    : { proof, seams: record.seams, proofDigest: record.seamConfigDigest };
}

/** Anything of its in the ledger lately is something Memnox at least saw. */
function seenIn(view: AgentView | undefined): boolean {
  return view !== undefined && (view.recent.length > 0 || view.today.actions > 0);
}

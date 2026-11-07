import {
  levelsOf,
  type AgentConnection,
  type AgentView,
  type ProofRecord,
} from '@memnox/core';
import { readProofRecord } from '../verify/proof-file';

/**
 * Each connection with how sure Memnox is of every capability through it, from the last proof
 * this machine ran and the ledger rows the agent left. Nothing the agent says is read.
 */
export async function withLevels(
  home: string,
  connections: readonly AgentConnection[],
  views: ReadonlyMap<string, AgentView>,
): Promise<AgentConnection[]> {
  const record = await readProofRecord(home);
  return connections.map((connection) => ({
    ...connection,
    levels: levelsOf({
      connection,
      ...proofOf(record, connection.agentId),
      seen: seenIn(
        connection.agentId === undefined ? undefined : views.get(connection.agentId),
      ),
    }),
  }));
}

function proofOf(
  record: ProofRecord | null,
  agentId: string | undefined,
): Pick<Parameters<typeof levelsOf>[0], 'proof' | 'seams'> {
  if (record === null || agentId === undefined) return {};
  const proof = record.agents.find((each) => each.agentId === agentId);
  return proof === undefined ? {} : { proof, seams: record.seams };
}

/** Anything of its in the ledger lately is something Memnox at least saw. */
function seenIn(view: AgentView | undefined): boolean {
  return view !== undefined && (view.recent.length > 0 || view.today.actions > 0);
}

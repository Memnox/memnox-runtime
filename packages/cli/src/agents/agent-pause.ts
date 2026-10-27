import { join } from 'node:path';
import {
  AGENT_ID_PREFIX,
  MEMNOX_HOME,
  NodeSnapshotStore,
  noteWorkspaceCondition,
  pauseAgentHere,
  resolveAgentName,
  resumeAgentHere,
  workspaceFreezeIds,
  type AgentNameMatch,
} from '@memnox/core';
import {
  declareAgentFreeze,
  liftAgentFreeze,
  WORKSPACE_TOLD,
  type CloudCall,
  type ToldWorkspace,
} from '../sync/agent-pause-cloud';
import { readNames } from './names';

/**
 * Pausing one agent and letting it carry on, for the voice and for `memnox agents pause`. This
 * machine is written first and alone decides: the workspace is told after, and a workspace that
 * cannot be reached never undoes a pause the person already heard take effect.
 */

export interface PauseSeams {
  home: string;
  now: () => Date;
  /** The control plane, swapped in a test so nothing reaches a network. */
  call?: CloudCall;
}

/** The agent a spoken or typed name means, read against what is on this machine and what it is called. */
export async function agentNamed(home: string, said: string): Promise<AgentNameMatch> {
  const [present, names] = await Promise.all([presentKinds(home), namesByKind(home)]);
  return resolveAgentName({ said, present, names });
}

async function presentKinds(home: string): Promise<string[]> {
  try {
    const snapshot = await new NodeSnapshotStore(join(home, MEMNOX_HOME)).latest();
    return snapshot === null ? [] : snapshot.agents.map((agent) => agent.kind);
  } catch {
    // No scan yet is an ordinary machine, and every product is still nameable.
    return [];
  }
}

/** What the person named each agent, keyed by kind rather than by fleet id. */
async function namesByKind(home: string): Promise<Record<string, string>> {
  const byId = await readNames(home);
  const byKind: Record<string, string> = {};
  for (const [id, name] of Object.entries(byId)) {
    byKind[id.startsWith(AGENT_ID_PREFIX) ? id.slice(AGENT_ID_PREFIX.length) : id] = name;
  }
  return byKind;
}

export interface Paused {
  kind: string;
  /** False when it was already paused here, which is left as it was. */
  fresh: boolean;
  /** When it lifts itself if nobody resumes it. */
  until: string;
  workspace: ToldWorkspace;
}

/** Pauses one agent here at once, then tells the workspace. */
export async function pauseAgent(
  seams: PauseSeams,
  kind: string,
  said?: string,
): Promise<Paused> {
  const now = seams.now().toISOString();
  const { overlay, fresh } = await pauseAgentHere(seams.home, {
    kind,
    now,
    ...(said === undefined ? {} : { said }),
  });
  if (!fresh && overlay.workspaceConditionId !== undefined) {
    const kept = {
      outcome: WORKSPACE_TOLD.TOLD,
      conditionId: overlay.workspaceConditionId,
    };
    return { kind, fresh, until: overlay.validUntil, workspace: kept };
  }
  const workspace = await declareAgentFreeze(
    seams.home,
    { kind, why: overlay.reason, validUntil: overlay.validUntil },
    seams.call,
  );
  if (workspace.conditionId !== undefined)
    await noteWorkspaceCondition(seams.home, overlay.id, workspace.conditionId);
  return { kind, fresh, until: overlay.validUntil, workspace };
}

interface Resumed {
  kind: string;
  /** How many pauses on it were lifted here. */
  liftedHere: number;
  /** One answer per workspace freeze this machine knew of, in the order they were lifted. */
  workspace: ToldWorkspace[];
}

/** Lifts the pause here and every workspace freeze on it this machine knows of. */
export async function resumeAgent(seams: PauseSeams, kind: string): Promise<Resumed> {
  const now = seams.now().toISOString();
  // Read before the local lift, since a pulled freeze is what keeps it stopped after this one ends.
  const pulled = await workspaceFreezeIds(seams.home, kind);
  const lifted = await resumeAgentHere(seams.home, kind, now);
  const ids = new Set([
    ...lifted.flatMap((overlay) =>
      overlay.workspaceConditionId === undefined ? [] : [overlay.workspaceConditionId],
    ),
    ...pulled,
  ]);
  const workspace: ToldWorkspace[] = [];
  for (const id of ids) workspace.push(await liftAgentFreeze(seams.home, id, seams.call));
  return { kind, liftedHere: lifted.length, workspace };
}

/** Whether every workspace freeze on it lifted, so a resume is only called done when it is. */
export function stillHeldByWorkspace(resumed: Resumed): boolean {
  return resumed.workspace.some(
    (answer) =>
      answer.outcome === WORKSPACE_TOLD.REFUSED ||
      answer.outcome === WORKSPACE_TOLD.UNREACHABLE,
  );
}

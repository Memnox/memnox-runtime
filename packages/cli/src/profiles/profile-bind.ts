import { isDefaultProfileId } from '@memnox/core';
import { bindProfile, readBindings, unbindProfile } from '../agents/connections';
import { agentTyped, readConnections, type ConnectionDeps } from './profile-connections';
import { profileNamed, type StoredProfile } from './profile-store';

/**
 * A person binding a kept profile to an agent found here, or taking it off. The agent keeps its
 * ledger key; only the job it works under changes, so a paired phone may not bind a profile with a role.
 */

interface BindInput {
  profile?: string;
  agent?: string;
  /** A paired phone, whose bind of a role would change which rules match without a signature. */
  remote: boolean;
}

export async function bindAgentProfile(
  home: string,
  input: BindInput,
  deps: ConnectionDeps,
): Promise<{ bound: string } | { refused: string }> {
  if (input.profile === undefined || input.agent === undefined)
    return { refused: 'Name the profile and the agent to bind it to.' };
  if (isDefaultProfileId(input.profile))
    return { refused: 'A default profile is what an agent has with nothing bound.' };
  const profile = await profileNamed(home, input.profile);
  if (profile === undefined) return { refused: `No profile is called ${input.profile}.` };
  if (input.remote && profile.role !== undefined)
    return { refused: `${profile.name} carries a role, so bind it on this computer.` };
  const agent = agentTyped(await readConnections(home, deps), input.agent);
  if (agent === null) return { refused: `No agent here goes by "${input.agent}".` };
  await bindProfile(home, agent.id, {
    profileId: profile.id,
    boundAt: deps.now.toISOString(),
  });
  return { bound: agent.id };
}

export async function unbindAgentProfile(
  home: string,
  typed: string | undefined,
  deps: ConnectionDeps,
): Promise<{ unbound: string } | { refused: string }> {
  if (typed === undefined) return { refused: 'Name the agent.' };
  const agent = agentTyped(await readConnections(home, deps), typed);
  const agentId = agent === null ? typed : agent.id;
  if (!(await unbindProfile(home, agentId)))
    return { refused: `${typed} has no profile bound, so it works under its default.` };
  return { unbound: agentId };
}

/** A forgotten profile leaves no agent bound to nothing: each goes back to its default. */
export async function unbindEveryAgentOf(home: string, profileId: string): Promise<void> {
  const bindings = await readBindings(home);
  for (const [agentId, binding] of Object.entries(bindings)) {
    if (binding.profileId === profileId) await unbindProfile(home, agentId);
  }
}

/** The kept profile a person bound to this agent, or none while it works under its default. */
export async function boundProfileOf(
  home: string,
  agentId: string,
): Promise<StoredProfile | undefined> {
  const binding = (await readBindings(home))[agentId];
  return binding === undefined ? undefined : profileNamed(home, binding.profileId);
}

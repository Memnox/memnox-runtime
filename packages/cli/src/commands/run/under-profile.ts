import { agentIdFor, ENV_AGENT_ROLE, sessionRoleOf } from '@memnox/core';
import { boundProfileOf } from '../../profiles/profile-bind';
import type { RunOptions } from './prepare';

/** What a run takes from the profile its agent works under: the role, and the work to join. */

export function workOf(options: RunOptions): { work?: string } {
  return options.work === undefined ? {} : { work: options.work };
}

/** A bound profile's role fills in only where neither --role nor the environment named one. */
export async function roleFromProfile(
  home: string,
  agent: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const bound = await boundProfileOf(home, agentIdFor(agent));
  const role = sessionRoleOf({ inherited: env[ENV_AGENT_ROLE], profile: bound?.role });
  if (role !== undefined) env[ENV_AGENT_ROLE] = role;
}

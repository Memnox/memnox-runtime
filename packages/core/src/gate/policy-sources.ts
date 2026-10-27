import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { MEMNOX_HOME, POLICY_REGISTRY_FILE } from '../config/config';
import { orgPolicyPathFor } from '../policy/org-bundle';
import { readPolicyRegistry } from './policy-file';

/**
 * Where a seam finds its rules with no daemon and no network: the environment first, then
 * the registry on disk, since an agent launched from a desktop icon inherits no shell.
 */

/**
 * Policy files evaluated in-process, comma separated, which is what sees the arguments.
 */
export const ENV_POLICIES = 'MEMNOX_POLICIES';
/** Name the local rules match on `agents:`. */
export const ENV_AGENT_NAME = 'MEMNOX_AGENT_NAME';
/**
 * The job an agent was enrolled under, matched by a
 * rule's `roles:`, which tells a workforce apart.
 */
export const ENV_AGENT_ROLE = 'MEMNOX_AGENT_ROLE';
/**
 * The person the agent works for, matched by a rule's `principals:`, since an agent that
 * holds a shared credential must still not do what its person may not.
 */
export const ENV_PRINCIPAL = 'MEMNOX_PRINCIPAL';

export const POLICY_PATH_SEPARATOR = ',';

/**
 * The files named in the environment, or the ones this machine registered when it names none.
 * The workspace's rules are kept either way, so naming other files never sets the team's aside.
 */
export async function readPolicyFiles(
  configured: string | undefined,
  home: string,
): Promise<string[]> {
  if (configured === undefined || configured.trim().length === 0) {
    return readPolicyRegistry(join(home, MEMNOX_HOME, POLICY_REGISTRY_FILE));
  }
  const named = configured
    .split(POLICY_PATH_SEPARATOR)
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  const org = orgPolicyPathFor(home);
  return named.includes(org) || !existsSync(org) ? named : [...named, org];
}

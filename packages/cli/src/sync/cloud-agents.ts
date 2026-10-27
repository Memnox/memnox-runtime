import { readAccount } from '@memnox/core';

import { callCloud, CloudUnreachable } from './client';

/**
 * The agents a team runs in the cloud, read from the control plane, so the voice can say what
 * one is doing when it is on no machine here. Read with this machine's own credential.
 */

/** Said instead of a list, so the voice tells the person why it cannot answer rather than guessing. */
interface CloudAgentsUnavailable {
  unavailable: string;
}

/** The control plane's answer is passed through untouched: the voice reads it, nothing here decides on it. */
export async function readCloudAgents(
  home: string,
): Promise<unknown | CloudAgentsUnavailable> {
  const account = await readAccount(home);
  if (account === null) {
    return { unavailable: 'this machine is not connected to a team' };
  }
  try {
    const answer = await callCloud<unknown>({
      baseUrl: account.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(account.workspaceId)}/cloud-agents`,
      token: account.token,
    });
    if (answer.status !== 200 || answer.body === undefined) {
      return { unavailable: `the team's control plane answered ${answer.status}` };
    }
    return answer.body;
  } catch (err) {
    if (err instanceof CloudUnreachable) return { unavailable: err.message };
    throw err;
  }
}

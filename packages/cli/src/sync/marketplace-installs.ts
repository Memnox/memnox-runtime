import { HTTP, readAccount } from '@memnox/core';
import { callCloud, sameControlPlane } from './client';

/**
 * Telling the workspace's marketplace that one of its versions was installed here, which is how
 * Memnox Cloud counts installs. Best effort: the install already happened, and a count that does
 * not arrive is said in the log and never undoes it or fails it.
 */

/** What was installed, from where, and how to say it went wrong. */
interface InstallCount {
  listingId: string;
  version: string;
  /** The index it was read from, so the credential only ever goes to this workspace's own plane. */
  source: string;
  send?: typeof callCloud;
  log: (message: string) => void;
}

/** True when the marketplace counted it; false for every reason it did not, each logged. */
export async function countMarketplaceInstall(
  home: string,
  count: InstallCount,
): Promise<boolean> {
  const account = await readAccount(home);
  // Signed out, or reading another plane's marketplace: the machine's credential is not sent there.
  if (account === null || !sameControlPlane(count.source, account.baseUrl)) return false;
  const path = `/v1/workspaces/${encodeURIComponent(account.workspaceId)}/marketplace/listings/${encodeURIComponent(count.listingId)}/versions/${encodeURIComponent(count.version)}/installs`;
  try {
    const answer = await (count.send ?? callCloud)<unknown>({
      baseUrl: account.baseUrl,
      path,
      method: 'POST',
      token: account.token,
    });
    if (answer.status < HTTP.BAD_REQUEST) return true;
    count.log(
      `the marketplace did not count ${count.listingId} ${count.version}: it answered ${answer.status}`,
    );
  } catch (err) {
    count.log(
      `the marketplace did not count ${count.listingId} ${count.version}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return false;
}

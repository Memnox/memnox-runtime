import { HTTP, type Account } from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';

/**
 * The relay's machine routes on the control plane: open a mailbox for a pairing, mint a paired
 * phone its token, close a mailbox, and wake a phone. Each carries ids only, never a word said.
 */

/** A mailbox the relay opened, with the single use token the QR hands the phone. */
export interface OpenedMailbox {
  mailbox: string;
  pairingToken: string;
  expiresAt: string;
}

export interface MintedToken {
  tokenId: string;
  token: string;
}

/** What the remote endpoint asks of the cloud, so a test hands in its own. */
export interface RelayCloud {
  openMailbox(account: Account): Promise<OpenedMailbox | null>;
  mintPhoneToken(account: Account, mailbox: string): Promise<MintedToken | null>;
  closeMailbox(account: Account, mailbox: string): Promise<boolean>;
  wakePhone(account: Account, mailbox: string): Promise<boolean>;
}

export const cloudRelay: RelayCloud = {
  openMailbox: (account) =>
    post<OpenedMailbox>(account, mailboxesPath(account), undefined),
  mintPhoneToken: (account, mailbox) =>
    post<MintedToken>(account, `${mailboxesPath(account)}/${mailbox}/tokens`, undefined),
  closeMailbox: async (account, mailbox) =>
    (await send(account, `${mailboxesPath(account)}/${mailbox}`, 'DELETE')) !== null,
  wakePhone: async (account, mailbox) =>
    (await post<unknown>(account, `${mailboxesPath(account)}/${mailbox}/wake`, {
      reason: 'waiting',
    })) !== null,
};

function mailboxesPath(account: Account): string {
  return `/v1/workspaces/${account.workspaceId}/machines/${account.machineId}/relay/mailboxes`;
}

function post<T>(account: Account, path: string, body: unknown): Promise<T | null> {
  return send<T>(account, path, 'POST', body);
}

/** The body of a 2xx, or null for anything else, an unreachable cloud included. */
async function send<T>(
  account: Account,
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
): Promise<T | null> {
  try {
    const response = await callCloud<T>({
      baseUrl: account.baseUrl,
      path,
      method,
      token: account.token,
      ...(body === undefined ? {} : { body }),
    });
    if (response.status < HTTP.OK || response.status >= HTTP.MULTIPLE_CHOICES)
      return null;
    // A 204 carries no body, and still means it was done.
    return response.body ?? ({} as T);
  } catch (err) {
    if (err instanceof CloudUnreachable) return null;
    throw err;
  }
}

import {
  HTTP,
  PERSONAL_SYNC_STATE,
  readAccount,
  secondsToMs,
  type PersonalSyncState,
} from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';

/**
 * Personal sync's routes on Memnox Cloud, called with this machine's own credential. Everything
 * sent is ciphertext or an opaque id; what comes back is the same, opened only on this machine.
 */

/** Enough for a page of a few MiB on a slow network; sync runs on request, never in an agent's way. */
const SYNC_TIMEOUT_MS = secondsToMs(30);

const REFUSED_NO_PERSON = 'no_person';

export type CloudSend = typeof callCloud;

/** What a route answered, or where sync stands now that it would not. */
export type SyncAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; state?: PersonalSyncState; said: string; status?: number };

/** One item as the cloud keeps it. */
export interface CloudItem {
  kind: string;
  id: string;
  version: number;
  seq: number;
  keyId: string;
  ciphertext?: string;
  deleted?: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface CloudPage {
  items: CloudItem[];
  next: number;
  more: boolean;
  reset: boolean;
}

export interface CloudUpload {
  kind: string;
  id: string;
  baseVersion: number;
  keyId: string;
  ciphertext?: string;
  deleted?: true;
}

interface CloudUploaded {
  kind: string;
  id: string;
  version: number;
  seq: number;
  conflictId?: string;
}

export interface CloudConflict {
  id: string;
  kind: string;
  itemId: string;
  version: number;
  keyId: string;
  ciphertext: string;
  writtenBy: string;
  keptAt: string;
}

export interface CloudMachineKey {
  machineId: string;
  publicKey: string;
  envelope?: string;
  keyId?: string;
  updatedAt: string;
}

/** A request on one of personal sync's routes, past the workspace. */
interface Route {
  method: 'GET' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}

/** Calls one route as this machine, mapping every refusal to where sync stands. */
export async function callSync<T>(
  home: string,
  route: Route,
  send: CloudSend = callCloud,
): Promise<SyncAnswer<T>> {
  const account = await readAccount(home);
  if (account === null)
    return {
      ok: false,
      state: PERSONAL_SYNC_STATE.OFF,
      said: 'This machine is not on Memnox Cloud, so there is nowhere to carry anything.',
    };
  try {
    const answer = await send<T>({
      baseUrl: account.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(account.workspaceId)}/personal-sync${route.path}`,
      method: route.method,
      token: account.token,
      timeoutMs: SYNC_TIMEOUT_MS,
      ...(route.body === undefined ? {} : { body: route.body }),
    });
    if (answer.status < HTTP.BAD_REQUEST) return { ok: true, value: answer.body as T };
    return refusalOf(answer.status, answer.body);
  } catch (err) {
    if (err instanceof CloudUnreachable) return { ok: false, said: err.message };
    throw err;
  }
}

/** A refusal said plainly; a plan without personal sync is said as the cloud said it. */
function refusalOf(status: number, body: unknown): SyncAnswer<never> {
  // Cast is safe: only two text fields are read, each checked for being text.
  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const message = typeof fields['message'] === 'string' ? fields['message'] : undefined;
  if (status === HTTP.FORBIDDEN && fields['error'] === REFUSED_NO_PERSON)
    return {
      ok: false,
      state: PERSONAL_SYNC_STATE.NO_PERSON,
      said: 'This machine belongs to nobody in the workspace, so it has nothing of its own to sync.',
    };
  if (status === HTTP.FORBIDDEN)
    return {
      ok: false,
      state: PERSONAL_SYNC_STATE.NOT_ON_PLAN,
      said:
        message ??
        'Personal sync is not on this plan. What is on this machine stays here and keeps working.',
    };
  return {
    ok: false,
    status,
    said: `Memnox Cloud answered ${status}${message === undefined ? '' : `: ${message}`}`,
  };
}

/** Every change past the cursor, one page. */
export async function pageSince(
  home: string,
  since: number,
  send?: CloudSend,
): Promise<SyncAnswer<CloudPage>> {
  const answer = await callSync<CloudPage>(
    home,
    { method: 'GET', path: `/items?since=${since}` },
    send,
  );
  if (answer.ok && (answer.value === undefined || !Array.isArray(answer.value.items)))
    return { ok: false, said: 'Memnox Cloud answered with no page of changes.' };
  return answer;
}

export async function uploadItems(
  home: string,
  items: readonly CloudUpload[],
  send?: CloudSend,
): Promise<SyncAnswer<{ items: CloudUploaded[] }>> {
  const answer = await callSync<{ items: CloudUploaded[] }>(
    home,
    { method: 'PUT', path: '/items', body: { items } },
    send,
  );
  if (answer.ok && (answer.value === undefined || !Array.isArray(answer.value.items)))
    return {
      ok: false,
      said: 'Memnox Cloud kept the upload and did not say which versions it took.',
    };
  return answer;
}

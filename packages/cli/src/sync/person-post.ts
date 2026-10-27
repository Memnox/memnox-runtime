import { HTTP } from '@memnox/core';
import { callCloud } from './client';
import type { PersonCredential } from './person';

/**
 * One POST to the workspace in the signed in person's own name, said back in words the voice
 * can use as they are, whatever happened: sent, refused with the workspace's reason, or unreached.
 */

/** How a call went, in words the voice can say as they are. */
export interface PersonCall {
  ok: boolean;
  said: string;
}

/** The one call out, a seam so a test answers for the workspace. */
export type CloudSend = typeof callCloud;

/** Long enough for a slow network, short enough that a person talking is not kept waiting. */
const PERSON_CALL_TIMEOUT_MS = 5_000;

export const NOT_SIGNED_IN: PersonCall = {
  ok: false,
  said: 'You are not signed in as yourself on this Mac, so nothing can be sent in your name. Sign in from the Account page, then try again.',
};

/** `route` is below the workspace, like `me/handovers`. */
export async function postAsPerson(
  send: CloudSend,
  person: PersonCredential,
  route: string,
  body: Record<string, unknown>,
): Promise<PersonCall> {
  try {
    const answer = await send<{ message?: string }>({
      baseUrl: person.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/${route}`,
      method: 'POST',
      token: person.token,
      body,
      timeoutMs: PERSON_CALL_TIMEOUT_MS,
    });
    if (answer.status < HTTP.BAD_REQUEST) return { ok: true, said: 'Sent.' };
    const message = answer.body?.message;
    return {
      ok: false,
      said:
        typeof message === 'string'
          ? message
          : `The workspace would not take it (${answer.status}).`,
    };
  } catch {
    return {
      ok: false,
      said: 'The workspace could not be reached, so nothing was sent.',
    };
  }
}

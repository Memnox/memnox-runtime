import { HTTP } from '@memnox/core';
import { callCloud } from './client';
import { readPerson } from './person';
import { NOT_SIGNED_IN, type CloudSend } from './person-post';

/**
 * The features this person's agents share with other people's, as the workspace found them,
 * with what every agent on each is doing and what they said to each other, for the voice.
 */

/** Long enough for a slow network, short enough that a person talking is not kept waiting. */
const SHARED_WORK_TIMEOUT_MS = 5_000;

type SharedWorkRead = { ok: true; features: unknown[] } | { ok: false; said: string };

export async function sharedWorkOf(
  home: string,
  send: CloudSend = callCloud,
): Promise<SharedWorkRead> {
  const person = await readPerson(home);
  if (person === null) return { ok: false, said: NOT_SIGNED_IN.said };
  try {
    const answer = await send<{ features?: unknown }>({
      baseUrl: person.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/work`,
      method: 'GET',
      token: person.token,
      timeoutMs: SHARED_WORK_TIMEOUT_MS,
    });
    const features = answer.body?.features;
    if (answer.status >= HTTP.BAD_REQUEST || !Array.isArray(features)) {
      return { ok: false, said: `The workspace would not say (${answer.status}).` };
    }
    return { ok: true, features };
  } catch {
    return { ok: false, said: 'The workspace could not be reached.' };
  }
}

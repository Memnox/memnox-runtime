import { callCloud } from './client';
import { readPerson } from './person';
import {
  NOT_SIGNED_IN,
  postAsPerson,
  type CloudSend,
  type PersonCall,
} from './person-post';

/**
 * Acting on what the workspace asked of this person, by voice, where acting is safe without
 * Touch ID: taking an incident, and saying no to an exception. Approving one loosens a rule,
 * which is the console's, with the second admin it asks for.
 */

export async function acknowledgeIncident(
  home: string,
  id: string,
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  const person = await readPerson(home);
  if (person === null) return NOT_SIGNED_IN;
  return postAsPerson(
    send,
    person,
    `incidents/${encodeURIComponent(id)}/acknowledge`,
    {},
  );
}

export async function rejectException(
  home: string,
  id: string,
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  const person = await readPerson(home);
  if (person === null) return NOT_SIGNED_IN;
  return postAsPerson(
    send,
    person,
    `policies/exceptions/${encodeURIComponent(id)}/reject`,
    {},
  );
}

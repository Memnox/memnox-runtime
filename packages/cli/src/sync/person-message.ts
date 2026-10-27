import {
  PERSON_MESSAGE_KIND,
  type PersonMessage,
  type PersonMessageKind,
} from '@memnox/core';
import { callCloud } from './client';
import { readPerson } from './person';
import {
  NOT_SIGNED_IN,
  postAsPerson,
  type CloudSend,
  type PersonCall,
} from './person-post';

/**
 * Speaking to a teammate through the workspace in the person's own name: by name, or to
 * whoever's machine holds the lines their agent was held off. The workspace carries it to the
 * other person's stream, where their voice says it at once.
 */

/** Who it is for: a name or address as said, or the lease whose holder it is for. */
export type MessageTo = { person: string } | { leaseId: string };

export async function sendToPerson(
  home: string,
  to: MessageTo,
  message: { kind: PersonMessageKind; said: string; replyTo?: string },
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  const person = await readPerson(home);
  if (person === null) return NOT_SIGNED_IN;
  return postAsPerson(send, person, 'me/messages', {
    ...('person' in to ? { to: to.person } : { leaseId: to.leaseId }),
    kind: message.kind,
    said: message.said,
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
  });
}

/** An answer to a message this person heard, going back to whoever sent it. */
export function answerPerson(
  home: string,
  heard: PersonMessage,
  said: string,
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  return sendToPerson(
    home,
    { person: heard.fromPersonId },
    { kind: PERSON_MESSAGE_KIND.TELL, said, replyTo: heard.id },
    send,
  );
}

import {
  readAccount,
  type Clash,
  type HandoverAnswer,
  type HandoverAsk,
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
 * Asking the owner of another machine for the lines its agent holds, and answering one such
 * ask, in the person's own name through their sign in. The workspace carries each to the
 * other person's stream, where their voice says it.
 */

/** Asks for the lines a clash was held off, naming this person's agent as the one they go to. */
export async function askForLines(
  home: string,
  clash: Clash,
  said: string | undefined,
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  const [person, account] = await Promise.all([readPerson(home), readAccount(home)]);
  if (person === null) return NOT_SIGNED_IN;
  if (clash.leaseId === undefined) {
    return {
      ok: false,
      said: 'That hold was on this machine, so there is nobody else to ask: the other agent is yours.',
    };
  }
  const reply = await postAsPerson(send, person, 'me/handovers', {
    leaseId: clash.leaseId,
    requester: {
      agent: clash.agent,
      session: clash.sessionId,
      ...(account === null ? {} : { machine: account.machineId }),
    },
    ...(said === undefined ? {} : { said }),
  });
  if (reply.ok) return { ok: true, said: 'Asked. Their voice is telling them now.' };
  return reply;
}

/** Answers an ask that reached this person; a give hands their agent's lines over on the record. */
export async function answerAsk(
  home: string,
  ask: HandoverAsk,
  reply: { answer: HandoverAnswer; minutes?: number; said?: string },
  send: CloudSend = callCloud,
): Promise<PersonCall> {
  const person = await readPerson(home);
  if (person === null) return NOT_SIGNED_IN;
  return postAsPerson(send, person, 'me/handovers/answer', {
    leaseId: ask.leaseId,
    toPersonId: ask.fromPersonId,
    requester: ask.requester,
    answer: reply.answer,
    ...(reply.minutes === undefined ? {} : { minutes: reply.minutes }),
    ...(reply.said === undefined ? {} : { said: reply.said }),
  });
}

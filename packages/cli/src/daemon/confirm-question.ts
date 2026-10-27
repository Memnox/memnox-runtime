import {
  AgentQuestions,
  holds,
  isAgentQuestionId,
  REMOTE_CAPABILITY,
  type DaemonRequest,
} from '@memnox/core';
import {
  confirmAnswer,
  type ConfirmInput,
  type ConfirmResult,
  type RemotePrincipal,
} from './confirm';

/** What an agent's question answered from a tap comes to; the agent carries on once every question has one. */
const QUESTION_ANSWERED = 'answered';

/** A person's answer to whatever waits on them: a held call, a proposal, or an agent's own question. */
export async function answerWaiting(
  home: string,
  request: DaemonRequest,
  at: string,
  principal?: RemotePrincipal,
): Promise<ConfirmResult> {
  if (request.subject === undefined || request.answer === undefined)
    return { ok: false, error: 'confirm needs a subject and an answer' };
  const input: ConfirmInput = {
    subject: request.subject,
    answer: request.answer,
    at,
    ...(request.signature === undefined ? {} : { signature: request.signature }),
    ...(request.edited === undefined ? {} : { edited: request.edited }),
    ...(request.editedTo === undefined ? {} : { editedTo: request.editedTo }),
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(principal === undefined ? {} : { principal }),
  };
  return isAgentQuestionId(input.subject)
    ? answerQuestion(home, input, request.questionNumber ?? 1)
    : confirmAnswer(home, input);
}

/**
 * A pick in an agent's own picker, tapped on the notch or the phone. It is the person's choice
 * going to their own agent, which rules on what it then does as ever, so it needs no signature,
 * only a device allowed to answer.
 */
async function answerQuestion(
  home: string,
  input: ConfirmInput,
  number: number,
): Promise<ConfirmResult> {
  const device = input.principal?.device;
  if (device !== undefined && !holds(device, REMOTE_CAPABILITY.ANSWER))
    return {
      ok: false,
      error: `${device.name} may not answer that from afar`,
      refused: true,
    };
  if (input.answer.trim() === '')
    return { ok: false, error: 'an answer needs some words' };
  const answered = await new AgentQuestions(home).answer(
    input.subject,
    number,
    input.answer,
    input.at,
  );
  if (answered === null)
    return { ok: false, error: `${input.subject} is no longer waiting on an answer` };
  return { ok: true, outcome: QUESTION_ANSWERED };
}

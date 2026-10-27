import { AgentQuestions } from '@memnox/core';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * The person's answer to a question an agent asked in its own picker, passed back in the
 * picker's place. It is their own choice going to their own agent, so it needs no read back
 * and no Touch ID, and what the agent then does is ruled on as ever.
 */

const NEEDS =
  'Pass question, the id the question came with, and answer, the option they chose or their own words.';

const GONE =
  'That question is no longer waiting: it was answered already, or its time ran out and the agent showed its own picker on screen. Say so in a sentence.';

const PASSED =
  'Passed on: the agent has the answer and carries on. Say so in a few words, like "Done, I told it Postgres."';

const NEXT =
  'Noted. Ask them the next question, then answer it the same way with its number.';

export async function answerQuestionTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const id = textArg(args, 'question');
  const said = textArg(args, 'answer');
  if (id === undefined || said === undefined || said.trim() === '') {
    return { answered: false, said: NEEDS };
  }
  const number = Number.parseInt(textArg(args, 'number') ?? '1', 10);
  const answered = await new AgentQuestions(deps.home).answer(
    id,
    Number.isInteger(number) && number > 0 ? number : 1,
    said,
    deps.now().toISOString(),
  );
  if (answered === null) return { answered: false, said: GONE };
  const left = answered.questions
    .map((each, at) => ({ number: at + 1, question: each.question }))
    .filter((each) => answered.answers?.[each.question] === undefined);
  return left.length === 0
    ? { answered: true, passedOn: answered.answers, said: PASSED }
    : { answered: true, next: left[0], said: NEXT };
}

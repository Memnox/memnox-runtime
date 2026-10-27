import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * A question an agent put to its person in its own picker, such as Claude Code's
 * AskUserQuestion, held for a moment so the voice can read it out and the spoken answer can
 * go back in the picker's place. Unanswered in time, the picker opens as it always did.
 */

export const AGENT_QUESTIONS_DIR = 'questions';

/** Every agent question id starts with this, so a brief can tell one from any other subject. */
export const AGENT_QUESTION_PREFIX = 'aqn_';

/** Long enough to hear one question read and answer it; each answer earns the next one as long again. */
export const AGENT_QUESTION_WAIT_MS = 45_000;

/**
 * The longest a set of questions is held however many steps it has, inside the five minutes
 * the hook is given, so the agent's own picker still opens if the person walks away mid-way.
 */
export const AGENT_QUESTION_MOST_MS = 270_000;

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestionItem {
  question: string;
  header?: string;
  options: AgentQuestionOption[];
  multiSelect: boolean;
}

export interface AgentQuestion {
  id: string;
  sessionId: string;
  agent: string;
  questions: AgentQuestionItem[];
  askedAt: string;
  expiresAt: string;
  /** By question text, the way the host's picker records a pick. */
  answers?: Record<string, string>;
  answeredAt?: string;
}

export interface AgentQuestionInput {
  sessionId: string;
  agent: string;
  toolUseId: string;
  questions: AgentQuestionItem[];
  at: string;
  waitMs?: number;
}

export function isAgentQuestionId(subject: string): boolean {
  return subject.startsWith(AGENT_QUESTION_PREFIX);
}

/** Every question has an answer, so the picker has nothing left to ask. */
export function fullyAnswered(question: AgentQuestion): boolean {
  return question.questions.every(
    (each) => question.answers?.[each.question] !== undefined,
  );
}

/** The marks a spoken answer may end on, which never decide which option it names. */
const CLOSING_MARKS = new Set(['.', '!', '?']);

/** A sentence without the marks it ends on, by a loop rather than a pattern that could backtrack. */
function withoutClosingMarks(text: string): string {
  let end = text.length;
  while (end > 0 && CLOSING_MARKS.has(text[end - 1] ?? '')) end -= 1;
  return text.slice(0, end);
}

/**
 * What was said as the answer to one question: an option's label when it names one, ignoring
 * case and a trailing full stop, and otherwise the words themselves, which the picker takes
 * as its "other" answer.
 */
export function answerFor(item: AgentQuestionItem, said: string): string {
  const plain = (text: string): string => withoutClosingMarks(text.toLowerCase()).trim();
  const picked = item.options.find((option) => plain(option.label) === plain(said));
  return picked?.label ?? said.trim();
}

/** A step answered earns the next step its own wait, up to the longest a set is ever held. */
function renewedUntil(question: AgentQuestion, moment: string): string {
  const ceiling = Date.parse(question.askedAt) + AGENT_QUESTION_MOST_MS;
  const renewed = Date.parse(moment) + AGENT_QUESTION_WAIT_MS;
  const until = Math.min(ceiling, Math.max(Date.parse(question.expiresAt), renewed));
  return new Date(until).toISOString();
}

export class AgentQuestions {
  private readonly records: JsonRecordDir<AgentQuestion>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, AGENT_QUESTIONS_DIR));
  }

  async ask(input: AgentQuestionInput): Promise<AgentQuestion> {
    const question: AgentQuestion = {
      id: `${AGENT_QUESTION_PREFIX}${Date.parse(input.at).toString(36)}_${shortDigest(input.toolUseId)}`,
      sessionId: input.sessionId,
      agent: input.agent,
      questions: input.questions,
      askedAt: input.at,
      expiresAt: new Date(
        Date.parse(input.at) + (input.waitMs ?? AGENT_QUESTION_WAIT_MS),
      ).toISOString(),
    };
    await this.records.write(question.id, question);
    return question;
  }

  async read(id: string): Promise<AgentQuestion | null> {
    return isAgentQuestionId(id) ? this.records.read(id) : null;
  }

  /** Still waiting on the person: unanswered and inside its wait, removing the rest. */
  async open(moment: string): Promise<AgentQuestion[]> {
    const found = await this.records.all();
    const open: AgentQuestion[] = [];
    for (const each of found) {
      if (each.expiresAt <= moment) await this.records.remove(each.id);
      else if (!fullyAnswered(each)) open.push(each);
    }
    return open;
  }

  /**
   * One question's answer, by its number from one; the record when it took, null when the
   * question is gone, already over, or has no such number.
   */
  async answer(
    id: string,
    number: number,
    said: string,
    moment: string,
  ): Promise<AgentQuestion | null> {
    const question = await this.read(id);
    const item = question?.questions[number - 1];
    if (question === null || item === undefined || question.expiresAt <= moment)
      return null;
    const answered: AgentQuestion = {
      ...question,
      answers: { ...question.answers, [item.question]: answerFor(item, said) },
      answeredAt: moment,
      expiresAt: renewedUntil(question, moment),
    };
    await this.records.write(id, answered);
    return answered;
  }

  async close(id: string): Promise<void> {
    await this.records.remove(id);
  }
}

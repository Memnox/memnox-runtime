/**
 * A question an agent asks its person in its own picker, read out by the voice and answered
 * out loud. The hook holds the picker while the voice reads it; a spoken answer is filled in,
 * which the host passes through without showing the picker, and silence lets it open as ever.
 */
import {
  AGENT_QUESTION_WAIT_MS,
  AgentQuestions,
  fullyAnswered,
  UNNAMED_SESSION,
  voiceListening,
  type AgentQuestion,
  type AgentQuestionItem,
  type AgentQuestionOption,
} from '@memnox/core';

import { EDIT_HOOK_EVENT } from './edit-hook';
import { fieldsOf } from './hook-payload';

const PICKER_TOOL = 'AskUserQuestion';

/** Often enough that the agent carries on within a breath of the answer. */
const POLL_MS = 300;

interface AgentQuestionContext {
  home: string;
  agent: string;
  runSession: string | undefined;
  now: () => Date;
}

interface AgentQuestionSeams {
  voiceThere?: () => Promise<boolean>;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The hook's reply when the person answered out loud; null lets the picker open as it would. */
export async function answerAgentQuestion(
  payload: unknown,
  context: AgentQuestionContext,
  seams: AgentQuestionSeams = {},
): Promise<string | null> {
  const asked = askedIn(payload);
  if (asked === null) return null;
  const there =
    seams.voiceThere ?? ((): Promise<boolean> => voiceListening(context.home));
  if (!(await there().catch(() => false))) return null;
  const store = new AgentQuestions(context.home);
  const waitMs = seams.waitMs ?? AGENT_QUESTION_WAIT_MS;
  const question = await store.ask({
    sessionId: context.runSession ?? asked.sessionId,
    agent: context.agent,
    toolUseId: asked.toolUseId,
    questions: asked.questions,
    at: context.now().toISOString(),
    waitMs,
  });
  const answered = await untilAnswered(store, question.id, seams);
  await store.close(question.id);
  return answered === null ? null : filledIn(asked.input, answered);
}

interface Asked {
  input: Record<string, unknown>;
  toolUseId: string;
  sessionId: string;
  questions: AgentQuestionItem[];
}

/** A picker opening with nothing filled in, which is a question for the person. */
function askedIn(payload: unknown): Asked | null {
  const hook = fieldsOf(payload);
  if (hook === null || hook['tool_name'] !== PICKER_TOOL) return null;
  if (hook['hook_event_name'] !== EDIT_HOOK_EVENT.PRE_TOOL_USE) return null;
  const input = fieldsOf(hook['tool_input']);
  const toolUseId = hook['tool_use_id'];
  if (input === null || typeof toolUseId !== 'string' || toolUseId === '') return null;
  // Already answered by the agent itself, so there is nothing for the person to say.
  const filled = fieldsOf(input['answers']);
  if (filled !== null && Object.keys(filled).length > 0) return null;
  const questions = questionsOf(input['questions']);
  if (questions.length === 0) return null;
  const session = hook['session_id'];
  return {
    input,
    toolUseId,
    sessionId: typeof session === 'string' && session !== '' ? session : UNNAMED_SESSION,
    questions,
  };
}

function questionsOf(value: unknown): AgentQuestionItem[] {
  if (!Array.isArray(value)) return [];
  const found: AgentQuestionItem[] = [];
  for (const each of value) {
    const fields = fieldsOf(each);
    const question = fields?.['question'];
    if (typeof question !== 'string' || question === '') continue;
    const header = fields?.['header'];
    found.push({
      question,
      ...(typeof header === 'string' && header !== '' ? { header } : {}),
      options: optionsOf(fields?.['options']),
      multiSelect: fields?.['multiSelect'] === true,
    });
  }
  return found;
}

function optionsOf(value: unknown): AgentQuestionOption[] {
  if (!Array.isArray(value)) return [];
  const found: AgentQuestionOption[] = [];
  for (const each of value) {
    const fields = fieldsOf(each);
    const label = fields?.['label'];
    if (typeof label !== 'string') continue;
    const description = fields?.['description'];
    found.push(
      typeof description === 'string' && description !== ''
        ? { label, description }
        : { label },
    );
  }
  return found;
}

/** Until every step has its answer, or the record's own deadline passes, which each answer moves on. */
async function untilAnswered(
  store: AgentQuestions,
  id: string,
  seams: AgentQuestionSeams,
): Promise<AgentQuestion | null> {
  const sleep =
    seams.sleep ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const question = await store.read(id).catch(() => null);
    if (question === null) return null;
    if (fullyAnswered(question)) return question;
    if (Date.now() >= Date.parse(question.expiresAt)) return null;
    await sleep(POLL_MS);
  }
}

/** The picker's own input with the spoken answers in it, which the host takes as already picked. */
function filledIn(input: Record<string, unknown>, answered: AgentQuestion): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: EDIT_HOOK_EVENT.PRE_TOOL_USE,
      permissionDecision: 'allow',
      permissionDecisionReason: 'Answered out loud through Memnox.',
      updatedInput: { ...input, answers: answered.answers ?? {} },
    },
  });
}

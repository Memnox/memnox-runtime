import {
  APPROVED_DESTINATIONS_QUESTION,
  HTTP,
  readAccount,
  RULE_DRAFTED_BY,
  spokenRuleFromModel,
  type RuleDraftedBy,
  type SpokenRuleReading,
} from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';

/**
 * A sentence an enrolled machine's person said, drafted by the workspace on the machine's own credential, where the
 * plan decides whether its model reads it or its grammar alone. The answer is held to the runtime's own validator
 * before anybody sees it, and nothing is proposed there: the confirm here writes it and offers it to the team.
 */

export type CloudCall = typeof callCloud;

/** Short, since somebody waits on the phone or the notch for the read back. */
const DRAFT_TIMEOUT_MS = 15_000;

/** The opening both drafters ask the destinations question with, whatever they say after it. */
const APPROVED_OPENING = 'Which destinations are approved?';

type CloudDraft =
  | { drafted: SpokenRuleReading; draftedBy: RuleDraftedBy; note?: string }
  | { refused: string; upgrade?: true }
  /** Not enrolled, revoked or unreachable, so the machine's own grammar reads it. */
  | null;

export async function draftInCloud(
  home: string,
  sentence: string,
  call: CloudCall = callCloud,
): Promise<CloudDraft> {
  const account = await readAccount(home);
  if (account === null || account.revokedAt !== undefined) return null;
  let answer: Awaited<ReturnType<CloudCall>>;
  try {
    answer = await call<unknown>({
      baseUrl: account.baseUrl,
      path: `/v1/workspaces/${encodeURIComponent(account.workspaceId)}/policies/proposals/from-sentence`,
      method: 'POST',
      token: account.token,
      timeoutMs: DRAFT_TIMEOUT_MS,
      body: { sentence },
    });
  } catch (err) {
    if (err instanceof CloudUnreachable) return null;
    throw err;
  }
  if (answer.status === HTTP.PAYMENT_REQUIRED)
    return { refused: messageOf(answer.body) ?? NOT_READ_FREE, upgrade: true };
  if (answer.status === HTTP.UNPROCESSABLE_ENTITY)
    return { refused: messageOf(answer.body) ?? NOT_READ };
  // Any other refusal, such as a revoked credential, is the cloud unable to help, so the grammar here reads it.
  if (answer.status < HTTP.OK || answer.status >= HTTP.MULTIPLE_CHOICES) return null;
  return readCloudDraft(answer.body);
}

/** The cloud's draft held to the runtime's validator; one it would not load is no draft, and the grammar reads it. */
function readCloudDraft(body: unknown): CloudDraft {
  if (typeof body !== 'object' || body === null) return null;
  const fields = body as Record<string, unknown>;
  const questions = Array.isArray(fields['openQuestions'])
    ? fields['openQuestions'].map((each) =>
        typeof each === 'string' && each.startsWith(APPROVED_OPENING)
          ? APPROVED_DESTINATIONS_QUESTION
          : each,
      )
    : [];
  const draft = fields['draft'];
  const read = spokenRuleFromModel(
    typeof draft === 'object' && draft !== null
      ? { ...draft, openQuestions: questions }
      : null,
  );
  if (read === undefined) return null;
  const note = typeof fields['note'] === 'string' ? fields['note'] : undefined;
  const draftedBy =
    fields['draftedBy'] === RULE_DRAFTED_BY.MODEL
      ? RULE_DRAFTED_BY.MODEL
      : RULE_DRAFTED_BY.PATTERN;
  return { drafted: read, draftedBy, ...(note === undefined ? {} : { note }) };
}

function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const message = (body as Record<string, unknown>)['message'];
  return typeof message === 'string' ? message : undefined;
}

const NOT_READ =
  'That was not read as a rule. Say it as never, ask me before, or let, then what an agent does.';
const NOT_READ_FREE = `${NOT_READ} On Pro, a rule in any phrasing is drafted too.`;

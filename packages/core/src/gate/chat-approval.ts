/**
 * A question for a person when the agent cannot show a prompt of its own: held as a call,
 * always asked in the session and in their DM where they asked for that. Only the person
 * types a prompt or answers a DM, so a yes the agent writes itself never counts.
 */
import { digest } from '../domain/digest';
import { HOLD_ANSWER, type HoldAnswer, type HoldRequest } from './hold';
import { ANSWER_PLACE, PendingApprovals, type PendingApproval } from './pending';
import { plainAsk, type PlainAsk } from './plain-ask';
import {
  grantPlaceOf,
  grantKeyFor,
  grantProgramOf,
  type GrantSubject,
} from './session-grants';
import { TOOL_CLASS } from '../discovery/classify';
import {
  APPROVAL_ROUTE,
  type ApprovalRoute,
} from '../constants/approval-route.constants';

/** Long enough for somebody to come back from a meeting, short enough to be about now. */
export const CHAT_APPROVAL_MS = 30 * 60 * 1000;

/** What a held question is about, as the hook knows it. */
export interface ChatQuestion {
  sessionId: string;
  agent: string;
  action: string;
  target?: string;
  class: string;
  reason: string;
  /** What the person asked for this session, so the question says what it is in service of. */
  task?: string;
  /** Everything the call changes stays inside the session's repository. */
  withinSession?: boolean;
  /** The rule that asked, by name. */
  rule?: string;
  /** The rule's way forward, as `describeAlternative` words it. */
  alternative?: string;
}

function grantKeyOf(question: Pick<ChatQuestion, 'action' | 'target'>): string {
  return grantKeyFor(question.action, question.target);
}

/**
 * One per thing a yes covers: the action, or for a delete the action on that target, so an
 * answer about one file is never spent on another.
 */
function fingerprintOf(question: ChatQuestion): string {
  const key = grantKeyOf(question);
  if (question.class !== TOOL_CLASS.DESTRUCTIVE)
    return digest(`${question.sessionId}\u0000${key}`);
  return digest(`${question.sessionId}\u0000${key}\u0000${question.target ?? ''}`);
}

/** What "for this session" grants, the same shape the answer writes and the next call reads. */
export function grantSubjectFor(question: ChatQuestion): GrantSubject {
  return {
    sessionId: question.sessionId,
    operation: grantKeyOf(question),
    fingerprint: fingerprintOf(question),
    class: question.class,
  };
}

/** The held call for this question, so asking twice before an answer is one question. */
export async function openQuestionFor(
  approvals: PendingApprovals,
  question: ChatQuestion,
  moment: string,
): Promise<PendingApproval | null> {
  const fingerprint = fingerprintOf(question);
  const open = await approvals.list(moment);
  return (
    open.find(
      (each) =>
        each.request.sessionId === question.sessionId &&
        each.request.fingerprint === fingerprint,
    ) ?? null
  );
}

/** Writes the question down, or finds the one already waiting for the same thing. */
export async function holdInChat(
  approvals: PendingApprovals,
  question: ChatQuestion,
  route: ApprovalRoute,
  moment: string,
): Promise<PendingApproval> {
  const open = await openQuestionFor(approvals, question, moment);
  if (open !== null) return open;
  const request: HoldRequest = {
    sessionId: question.sessionId,
    agent: question.agent,
    operation: question.action,
    ...(question.target === undefined ? {} : { target: question.target }),
    fingerprint: fingerprintOf(question),
    reason: question.reason,
    class: question.class,
    grantKey: grantKeyOf(question),
    ...(question.withinSession === true ? { withinSession: true } : {}),
    ...(question.rule === undefined ? {} : { rule: question.rule }),
    ...(question.alternative === undefined ? {} : { alternative: question.alternative }),
  };
  const raised = await approvals.raise(request, moment, CHAT_APPROVAL_MS);
  const routed: PendingApproval = {
    ...raised,
    route,
    plain: plainAsk(request, question.task),
  };
  await approvals.keep(routed);
  return routed;
}

/** What the person typed, read as an answer to one held question. */
export interface ChatReply {
  id: string;
  answer: HoldAnswer;
}

/** A reply longer than this is an instruction that happens to contain "no", not an answer. */
const MOST_REPLY_CHARS = 80;

const HELD_ID = /\bapr_[a-z0-9]+_[a-z0-9]+\b/i;
const FOR_SESSION = /\b(for (this|the) session|this session|every time|always)\b/;
const REFUSING = /^(no|nope|deny|denied|don'?t|do not|refuse|reject|stop|cancel)\b/;
const ALLOWING =
  /^(yes|y|yep|yeah|ok|okay|allow|allowed|approve|approved|go ahead|go|sure|do it|proceed)\b/;

/**
 * The answer a prompt gives, or null where it is not one. A reply naming a held call by id
 * answers that one; a bare "yes" answers only when exactly one question is waiting, so a
 * yes is never spent on something the person was not looking at.
 */
export function replyOf(
  prompt: string,
  open: readonly PendingApproval[],
): ChatReply | null {
  const text = prompt.trim().toLowerCase();
  if (text === '' || text.length > MOST_REPLY_CHARS) return null;
  const named = HELD_ID.exec(text)?.[0];
  const said = text.replace(HELD_ID, '').replace(/\s+/g, ' ').trim();
  const answer = answerOf(said);
  if (answer === null) return null;
  if (named !== undefined) {
    const found = open.find((each) => each.id.toLowerCase() === named);
    return found === undefined ? null : { id: found.id, answer };
  }
  const [only, ...more] = open;
  return only === undefined || more.length > 0 ? null : { id: only.id, answer };
}

/** The numbered choices every question shows. */
const NUMBERED: Readonly<Record<string, HoldAnswer>> = {
  '1': HOLD_ANSWER.ONCE,
  '2': HOLD_ANSWER.SESSION,
  '3': HOLD_ANSWER.DENY,
};

function answerOf(said: string): HoldAnswer | null {
  const numbered = NUMBERED[said.replace(/[.)]$/, '')];
  if (numbered !== undefined) return numbered;
  if (REFUSING.test(said)) return HOLD_ANSWER.DENY;
  if (!ALLOWING.test(said)) return null;
  return FOR_SESSION.test(said) ? HOLD_ANSWER.SESSION : HOLD_ANSWER.ONCE;
}

/** The questions this session is waiting on that its own prompt may answer. */
export async function openInSession(
  approvals: PendingApprovals,
  sessionId: string,
  moment: string,
): Promise<PendingApproval[]> {
  const open = await approvals.list(moment);
  return open.filter(
    (each) => each.request.sessionId === sessionId && each.answer === undefined,
  );
}

/** Answered where the agent was not listening, and not yet told: from a DM, mostly. */
export async function answeredUntold(
  approvals: PendingApprovals,
  sessionId: string,
  moment: string,
): Promise<PendingApproval[]> {
  const open = await approvals.list(moment);
  return open.filter(
    (each) =>
      each.request.sessionId === sessionId &&
      each.answer !== undefined &&
      each.toldAgentAt === undefined,
  );
}

/** Kept so the agent hears each answer once, however many turns end after it. */
export async function markTold(
  approvals: PendingApprovals,
  held: readonly PendingApproval[],
  moment: string,
): Promise<void> {
  for (const each of held) await approvals.keep({ ...each, toldAgentAt: moment });
}

/** Answerable somewhere a picker on screen would never hear of: a DM, the Mac app, a phone. */
function answeredAway(held: PendingApproval): boolean {
  return held.route === APPROVAL_ROUTE.BOTH || (held.alsoOn?.length ?? 0) > 0;
}

/** Whether this session has a question out somewhere else that nobody has answered yet. */
export async function waitingOnDm(
  approvals: PendingApprovals,
  sessionId: string,
  moment: string,
): Promise<boolean> {
  const open = await openInSession(approvals, sessionId, moment);
  return open.some(answeredAway);
}

/** A delete is granted on its target only, so its "for this session" has to say so. */
function coversOneTarget(held: PendingApproval): boolean {
  return (
    held.request.class === TOOL_CLASS.DESTRUCTIVE && held.request.target !== undefined
  );
}

function plainOf(held: PendingApproval): PlainAsk {
  return held.plain ?? plainAsk(held.request);
}

/** "delete", from "delete finish-cloud.patch", for the note on what a session yes leaves out. */
function actionWord(held: PendingApproval): string {
  return (plainOf(held).doing ?? held.request.operation).split(' ')[0] ?? 'action';
}

/** The three answers, labelled the same in the picker, the numbered list and the parser. */
export const PICKER_LABEL = {
  ONCE: 'Allow once',
  SESSION: 'Allow for this session',
  DENY: 'Deny',
} as const;

/** The header a held question's picker carries, so the hook knows it is ours. */
export const PICKER_HEADER = 'Memnox';

/** Where a file yes reaches, the repository or folder, where the grant is narrower than the action. */
function coveredFolder(held: PendingApproval): string | undefined {
  const { operation, target } = held.request;
  if (coversOneTarget(held) || target === undefined) return undefined;
  return operation.startsWith('filesystem.') ? grantPlaceOf(target) : undefined;
}

/** The program a command yes covers, where the grant is narrower than running anything. */
function coveredProgram(held: PendingApproval): string | undefined {
  const { operation, target } = held.request;
  if (target === undefined || grantKeyFor(operation, target) === operation)
    return undefined;
  return operation.startsWith('filesystem.') || operation.startsWith('http.')
    ? undefined
    : grantProgramOf(target);
}

/** What "for this session" leaves out, where it leaves anything out. */
function sessionNote(held: PendingApproval): string | undefined {
  if (coversOneTarget(held))
    return `this ${held.request.target ?? 'target'} only; any other ${actionWord(held)} still asks`;
  const folder = coveredFolder(held);
  if (folder !== undefined) return `only in ${folder}; anywhere else still asks`;
  const program = coveredProgram(held);
  return program === undefined
    ? undefined
    : `only ${program} commands; any other still asks`;
}

/** The three answers, numbered the same wherever they are shown, so "2" means one thing. */
function choices(held: PendingApproval): string[] {
  const note = sessionNote(held);
  const session =
    note === undefined ? PICKER_LABEL.SESSION : `${PICKER_LABEL.SESSION} (${note})`;
  return [`  1. ${PICKER_LABEL.ONCE}`, `  2. ${session}`, `  3. ${PICKER_LABEL.DENY}`];
}

/** Every held id a text names, so a picker's question can be matched to what it asks. */
export function heldIdsIn(text: string): string[] {
  return [...text.matchAll(new RegExp(HELD_ID.source, 'gi'))].map((match) =>
    match[0].toLowerCase(),
  );
}

/**
 * Only Claude Code has the picker, and only while the question is nowhere else: nothing
 * outside can close a picker, so an answer there would leave it asking for nothing.
 */
function hasPicker(held: PendingApproval): boolean {
  return held.request.agent === 'claude-code' && !answeredAway(held);
}

/** Where else the question was put, in the words the session shows. */
function elsewhere(
  held: PendingApproval,
  whose: 'their' | 'your',
  joined: 'and' | 'or',
): string | null {
  const places = [
    ...(held.alsoOn?.includes(ANSWER_PLACE.MAC) === true ? ['the Memnox Mac app'] : []),
    ...(held.alsoOn?.includes(ANSWER_PLACE.PAIRED) === true
      ? [`${whose} paired phone`]
      : []),
    ...(held.route === APPROVAL_ROUTE.BOTH ? [`${whose} Slack or Discord DM`] : []),
  ];
  const last = places.pop();
  if (last === undefined) return null;
  return places.length === 0 ? last : `${places.join(', ')} ${joined} ${last}`;
}

/** The only question a picker may put for this held call, word for word. */
export function pickerQuestion(held: PendingApproval): string {
  return `${plainOf(held).summary} Allow it? (${held.id})`;
}

/** One option a held question's picker offers, as Memnox wrote it. */
export interface PickerOption {
  label: string;
  description?: string;
}

/**
 * The only options a picker may offer, in order. The agent types them, so the hook holds
 * them to this, and a label reworded to mislead is a refused picker rather than an answer.
 */
export function pickerOptions(held: PendingApproval): PickerOption[] {
  const note = sessionNote(held);
  return [
    { label: PICKER_LABEL.ONCE },
    note === undefined
      ? { label: PICKER_LABEL.SESSION }
      : { label: PICKER_LABEL.SESSION, description: note },
    { label: PICKER_LABEL.DENY },
  ];
}

/** The answer a picked label stands for, only on an exact match with Memnox's own labels. */
export function pickedAnswer(label: string): HoldAnswer | null {
  if (label === PICKER_LABEL.ONCE) return HOLD_ANSWER.ONCE;
  if (label === PICKER_LABEL.SESSION) return HOLD_ANSWER.SESSION;
  if (label === PICKER_LABEL.DENY) return HOLD_ANSWER.DENY;
  return null;
}

function pickerAsk(held: PendingApproval): string {
  const note = sessionNote(held);
  const session =
    note === undefined
      ? `"${PICKER_LABEL.SESSION}"`
      : `"${PICKER_LABEL.SESSION}" (description: "${note}")`;
  return [
    `Ask them now with your AskUserQuestion tool: header "${PICKER_HEADER}", question "${pickerQuestion(held)}", and exactly these options with no other description: "${PICKER_LABEL.ONCE}", ${session}, "${PICKER_LABEL.DENY}". A picker worded any other way is refused.`,
    'Leave its answers empty. Only their own pick counts, and a question sent with an answer already filled in is refused.',
  ].join('\n');
}

/** What the agent is told once a person answered, so it carries on or stops. */
export function answeredText(held: PendingApproval): string {
  const plain = plainOf(held);
  const what = plain.doing ?? held.request.operation;
  const by = held.answeredBy ?? 'Your person';
  if (held.answer === HOLD_ANSWER.ONCE)
    return `Memnox: ${by} said yes, once: you may ${what} (${held.id}). Try the same call again now and carry on.`;
  if (held.answer === HOLD_ANSWER.SESSION) {
    const folder = coveredFolder(held);
    const program = coveredProgram(held);
    const scope = coversOneTarget(held)
      ? ` Any other ${actionWord(held)} still needs their OK.`
      : folder !== undefined
        ? ` That covers ${folder} only; anywhere else still needs their OK.`
        : program !== undefined
          ? ` That covers ${program} commands only; any other command still needs their OK.`
          : '';
    return `Memnox: ${by} said yes for the rest of this session: you may ${what} (${held.id}).${scope} Try the same call again now and carry on.`;
  }
  return `Memnox: ${by} said no: do not ${what}, and do not get the same result another way (${held.id}).${saidWithNo(held)} Carry on without it, or tell them what you need instead.`;
}

/** The person's reason and the rule's way forward, which together are how a no becomes a narrower try. */
function saidWithNo(held: PendingApproval): string {
  const reason =
    held.answerReason === undefined
      ? ''
      : ` They said: ${held.answerReason.replace(/[.!?]+$/, '')}.`;
  const instead =
    held.request.alternative === undefined ? '' : ` ${held.request.alternative}`;
  return `${reason}${instead}`;
}

/**
 * The question in the person's own words, shown to them by the host rather than left for
 * the agent to relay, because an agent that ends its turn quietly leaves nobody asked.
 */
export function heldNotice(held: PendingApproval): string {
  const plain = plainOf(held);
  const away = elsewhere(held, 'your', 'and');
  const dm =
    away === null
      ? ''
      : ` It was also sent to ${away}: answer there and the agent carries on by itself.`;
  return [
    `Memnox needs your OK (${held.id})`,
    plain.summary,
    ...(plain.task === undefined ? [] : [`While working on: "${plain.task}"`]),
    `Why you are asked: ${plain.why}`,
    ...choices(held),
    `Reply here with 1, 2 or 3, or in words.${dm}`,
  ].join('\n');
}

/** What the agent is told when its question is held: how to ask, and how to wait. */
export function heldText(held: PendingApproval): string {
  const plain = plainOf(held);
  const away = elsewhere(held, 'their', 'or');
  const dm = away !== null;
  const ask = hasPicker(held)
    ? [pickerAsk(held)]
    : dm
      ? [
          `Tell them in one line that you are waiting on their answer, here or from ${away}, and end your turn. Do not open a picker or ask them any other way.`,
        ]
      : [
          'Show them these choices, in these words, and wait for their reply:',
          ...choices(held),
          'They answer by typing 1, 2 or 3, or the words, in this session. Only their own reply counts, so never answer for them.',
        ];
  return [
    `Memnox is holding this until your person answers (${held.id}): ${plain.summary}`,
    `Why: ${plain.why}`,
    ...ask,
    dm
      ? 'Memnox tells you their answer when it arrives, and you carry on from there.'
      : 'Try the same call again once they have answered.',
    'Doing it another way is the same action.',
  ].join('\n');
}

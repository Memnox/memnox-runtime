/**
 * What the Mac draws for the person's own tools: the icons of the tools they still have to sign in
 * to, and a draft of what is about to go out in their name, drawn the way that tool draws it, Slack
 * as a message, GitHub as a review comment, Gmail as a mail, read whole before Touch ID sends it.
 */

/** A tool the person asked for and has not signed in to, with the page that signs them in. */
export interface ToolSignIn {
  toolkit: string;
  url: string;
  /** Signed in before as somebody else's account, so this is to sign in again with their own. */
  again?: boolean;
}

/** A sign in that finished, or never did, as the notch and the voice are told of it. */
export interface SignedIn {
  toolkit: string;
  /** The account it reached; absent on a sign in that never finished. */
  account?: WorkAccount;
  /** What the person asked for before they signed in, asked again so it carries on. */
  resume?: string;
  /** Where nothing ties the account to them: the proposal "that's me" confirms, and "not me" declines. */
  confirm?: string;
}

/** Whether the account a sign in reached is known to be the person's own. */
export const WORK_ACCOUNT_CHECK = {
  MATCHED: 'matched',
  UNVERIFIED: 'unverified',
  MISMATCH: 'mismatch',
  UNKNOWN: 'unknown',
} as const;

export type WorkAccountCheck =
  (typeof WORK_ACCOUNT_CHECK)[keyof typeof WORK_ACCOUNT_CHECK];

/** The account something goes out as, as the tool itself named it. */
export interface WorkAccount {
  /** The id the control plane checks the run against, so a sign in changed since is refused. */
  key?: string;
  handle?: string;
  name?: string;
  check: WorkAccountCheck;
}

/** What kind of thing is drafted, which decides how the card is laid out. */
export const WORK_DRAFT_KIND = {
  MESSAGE: 'message',
  COMMENT: 'comment',
  EMAIL: 'email',
  ISSUE: 'issue',
  EVENT: 'event',
  PAGE: 'page',
  OTHER: 'other',
} as const;

export type WorkDraftKind = (typeof WORK_DRAFT_KIND)[keyof typeof WORK_DRAFT_KIND];

export interface WorkField {
  name: string;
  value: string;
}

/** Something about to go out in the person's name, as the Mac draws it before they confirm. */
export interface WorkDraft {
  toolkit: string;
  tool: string;
  kind: WorkDraftKind;
  account?: WorkAccount;
  /** Who it goes to: people, addresses or a channel. A mail always shows its real addresses here. */
  to?: string[];
  /** On a mail, the name the voice found for whom it goes to, shown beside the address and never in its place. */
  toName?: string;
  /** On a mail, the person may rewrite its addresses on the card, which their Touch ID then covers. */
  toEditable?: boolean;
  /** Where it lands: `owner/repo#412`, an issue, a page. */
  where?: string;
  subject?: string;
  body?: string;
  /** On an event, when it starts and ends as the tool was given them, so the card shows the time it books. */
  starts?: string;
  ends?: string;
  /** Every other argument, as text, so nothing goes out that the card did not show. */
  fields: WorkField[];
}

/** Read off the tool's own slug, first match wins, so a review comment is never drawn as a message. */
const KIND_WORDS: ReadonlyArray<[WorkDraftKind, readonly string[]]> = [
  [WORK_DRAFT_KIND.COMMENT, ['COMMENT', 'REVIEW', 'REACTION']],
  [WORK_DRAFT_KIND.EMAIL, ['EMAIL', 'MAIL', 'DRAFT']],
  [WORK_DRAFT_KIND.EVENT, ['EVENT', 'MEETING']],
  [WORK_DRAFT_KIND.PAGE, ['PAGE', 'DOCUMENT', 'DOC']],
  [WORK_DRAFT_KIND.ISSUE, ['ISSUE', 'TICKET', 'TASK']],
  [WORK_DRAFT_KIND.MESSAGE, ['MESSAGE', 'CHAT', 'POST', 'DM', 'REPLY']],
];

const BODY_KEYS = [
  'text',
  'body',
  // A Gmail reply carries its words here, and a card that missed it showed an empty box over them.
  'message_body',
  'message',
  'markdown',
  'markdown_text',
  'content',
  'comment',
];
// A calendar event carries its title as a summary.
const SUBJECT_KEYS = ['subject', 'title', 'summary'];
const TO_KEYS = [
  'to',
  'to_email',
  'recipient_email',
  'recipient',
  'recipients',
  'channel',
  'channel_id',
  'user',
  'users',
  'attendees',
  'cc',
];
/** The arguments a mail holds its main addresses in, the only ones the person may rewrite on its card. */
const ADDRESS_KEYS = ['to', 'to_email', 'recipient_email', 'recipients'];
const STARTS_KEYS = ['start_datetime', 'start_time', 'start', 'start_date'];
const ENDS_KEYS = ['end_datetime', 'end_time', 'end', 'end_date'];
const REPO_KEYS = ['owner', 'repo'];
const NUMBER_KEYS = ['pull_number', 'issue_number', 'number'];
const PLACE_KEYS = [
  'issue_id',
  'issueId',
  'page_id',
  'document_id',
  'thread_id',
  'thread_ts',
];

/** Long enough to read an argument whole on a card, never a wall of JSON. */
const FIELD_TEXT_LIMIT = 300;

/** What the card shows beside the arguments: whose account it goes out as and who it goes to by name. */
export interface WorkDraftExtras {
  account?: WorkAccount;
  toName?: string;
}

/** The draft of one tool call, laid out from its slug and arguments, with nothing left off. */
export function workDraftOf(
  toolkit: string,
  tool: string,
  args: Record<string, unknown>,
  { account, toName }: WorkDraftExtras = {},
): WorkDraft {
  const used = new Set<string>();
  const body = firstOf(args, BODY_KEYS, used);
  const subject = firstOf(args, SUBJECT_KEYS, used);
  const mail = MAIL_TOOLKITS.includes(toolkit);
  // A mail's copies stay a field of their own, so the editable row holds only the addresses it rewrites.
  const toKeys = mail ? TO_KEYS.filter((key) => key !== 'cc') : TO_KEYS;
  const ids = toKeys.flatMap((key) => {
    const value = textOf(args[key]);
    if (value === undefined) return [];
    used.add(key);
    return value.split(', ');
  });
  // A mail keeps its addresses, since a name alone hid a misheard one until it had gone out.
  const named = !mail && toName !== undefined && ids.length > 0;
  // Elsewhere the name alone, since a Slack id like U0B3QDB89Q9 tells a person nothing.
  const to = named ? [toName] : ids;
  const where = placeOf(args, used);
  const kind = kindOf(toolkit, tool);
  // Only an event's times are lifted out, so a start argument elsewhere still shows among the fields.
  const event = kind === WORK_DRAFT_KIND.EVENT;
  const starts = event ? firstOf(args, STARTS_KEYS, used) : undefined;
  const ends = event ? firstOf(args, ENDS_KEYS, used) : undefined;
  const fields = restOf(args, used);
  return {
    toolkit,
    tool,
    kind,
    ...(account === undefined ? {} : { account }),
    ...(to.length === 0 ? {} : { to }),
    ...(mail && toName !== undefined && ids.length > 0 ? { toName } : {}),
    ...(mail && addressKeyOf(args) !== undefined ? { toEditable: true } : {}),
    ...(where === undefined ? {} : { where }),
    ...(subject === undefined ? {} : { subject }),
    ...(body === undefined ? {} : { body }),
    ...(starts === undefined ? {} : { starts }),
    ...(ends === undefined ? {} : { ends }),
    fields,
  };
}

/**
 * The arguments with the person's own words in place of the body the card showed, or null where the body
 * is not plain text or there is none, so an edit never lands in an argument the card did not draw as words.
 */
export function editedArguments(argumentsText: string, edited: string): string | null {
  const record = argumentsRecord(argumentsText);
  if (record === null) return null;
  const key = BODY_KEYS.find((each) => textOf(record[each]) !== undefined);
  if (key === undefined || typeof record[key] !== 'string') return null;
  return JSON.stringify({ ...record, [key]: edited });
}

/**
 * The arguments of a mail with the addresses the person typed on its card in place of the proposed ones, in the
 * shape the tool took them, or null where the toolkit is no mail, an address is malformed, or a single address
 * argument would be handed several.
 */
export function editedRecipients(
  toolkit: string,
  argumentsText: string,
  editedTo: string,
): string | null {
  if (!MAIL_TOOLKITS.includes(toolkit)) return null;
  const addresses = editedTo.split(',');
  if (!addresses.every(isAddress)) return null;
  const record = argumentsRecord(argumentsText);
  if (record === null) return null;
  const key = addressKeyOf(record);
  if (key === undefined) return null;
  const was = record[key];
  if (Array.isArray(was)) return JSON.stringify({ ...record, [key]: addresses });
  // A tool that took one address as text is never handed a list it was not written for.
  const several = typeof was === 'string' && was.includes(',');
  if (addresses.length > 1 && !several) return null;
  return JSON.stringify({ ...record, [key]: addresses.join(', ') });
}

/** Who a send in the person's name goes to, read off the arguments it went with, so "who did it go to" is fact. */
export function recipientsOf(
  toolkit: string,
  tool: string,
  argumentsText: string,
  toName?: string,
): string[] {
  const extras = toName === undefined ? {} : { toName };
  return workDraftFromText(toolkit, tool, argumentsText, extras).to ?? [];
}

/** The draft of one tool call from the arguments as proposed text; text that is no object draws only the tool. */
export function workDraftFromText(
  toolkit: string,
  tool: string,
  argumentsText: string,
  extras: WorkDraftExtras = {},
): WorkDraft {
  return workDraftOf(toolkit, tool, argumentsRecord(argumentsText) ?? {}, extras);
}

function argumentsRecord(argumentsText: string): Record<string, unknown> | null {
  let args: unknown;
  try {
    args = JSON.parse(argumentsText);
  } catch {
    // Arguments are checked as JSON before they are proposed, so this is a record written by hand.
    return null;
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null;
  return args as Record<string, unknown>; // narrowed to a plain object just above
}

/** One plain address, refusing the colon, comma and space that would make the signed text read two ways. */
export function isAddress(text: string): boolean {
  return /^[^\s:,@]+@[^\s:,@]+\.[^\s:,@]+$/.test(text);
}

/** The one argument holding a mail's addresses, or none where there is none or more than one to choose from. */
function addressKeyOf(args: Record<string, unknown>): string | undefined {
  const held = ADDRESS_KEYS.filter((key) => textOf(args[key]) !== undefined);
  return held.length === 1 ? held[0] : undefined;
}

/** The first of these arguments that holds anything, marked as shown. */
function firstOf(
  args: Record<string, unknown>,
  keys: readonly string[],
  used: Set<string>,
): string | undefined {
  for (const key of keys) {
    const value = textOf(args[key]);
    if (value !== undefined) {
      used.add(key);
      return value;
    }
  }
  return undefined;
}

/** Every argument the card has not shown yet, as text. */
function restOf(args: Record<string, unknown>, used: ReadonlySet<string>): WorkField[] {
  return Object.entries(args)
    .filter(([name]) => !used.has(name))
    .flatMap(([name, value]) => {
      const text = textOf(value);
      return text === undefined ? [] : [{ name, value: text.slice(0, FIELD_TEXT_LIMIT) }];
    });
}

/** Toolkits whose every send is a mail, since a slug like GMAIL_REPLY_TO_THREAD reads as a chat reply. */
const MAIL_TOOLKITS = ['gmail', 'outlook'];

function kindOf(toolkit: string, tool: string): WorkDraftKind {
  if (MAIL_TOOLKITS.includes(toolkit)) return WORK_DRAFT_KIND.EMAIL;
  const words = tool.toUpperCase().split('_');
  for (const [kind, markers] of KIND_WORDS) {
    if (markers.some((marker) => words.includes(marker))) return kind;
  }
  return WORK_DRAFT_KIND.OTHER;
}

/** `owner/repo#412` where a repository and a number are given, else the first place named. */
function placeOf(args: Record<string, unknown>, used: Set<string>): string | undefined {
  const [owner, repo] = REPO_KEYS.map((key) => textOf(args[key]));
  const number = NUMBER_KEYS.map((key) => textOf(args[key])).find(
    (each) => each !== undefined,
  );
  if (owner !== undefined && repo !== undefined) {
    REPO_KEYS.forEach((key) => used.add(key));
    NUMBER_KEYS.forEach((key) => used.add(key));
    return number === undefined ? `${owner}/${repo}` : `${owner}/${repo}#${number}`;
  }
  for (const key of PLACE_KEYS) {
    const value = textOf(args[key]);
    if (value !== undefined) {
      used.add(key);
      return value;
    }
  }
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.flatMap((each) => {
      const text = textOf(each);
      return text === undefined ? [] : [text];
    });
    return parts.length === 0 ? undefined : parts.join(', ');
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return undefined;
}

import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  confirmationMessage,
  HTTP,
  readAccount,
  secondsToMs,
  type ToolConnection,
  type WorkAccount,
  type WorkAccountCheck,
} from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';
import { openBrowser, OPEN_BROWSER_VAR } from './browser';
import { readPerson } from './person';
import { defaultBaseUrl } from './cloud-url';
import {
  ensureDeviceSpace,
  readDeviceSpace,
  spaceAsCaller,
  spaceBaseUrl,
  type PersonalCaller,
} from './device-space';

/**
 * The person's own tools through their own sign ins, so the voice reads and replies as them, never a
 * bot. Reads go straight through; anything else is signed only after they confirmed it with Touch ID.
 */

/** Short for a read, since the person is waiting on a spoken answer; longer for a send. */
const READ_TIMEOUT_MS = secondsToMs(8);
const RUN_TIMEOUT_MS = secondsToMs(20);

const WORK_CLASS = { READ: 'read', ACT: 'act' } as const;
export type WorkClass = (typeof WORK_CLASS)[keyof typeof WORK_CLASS];

export interface PersonalTool {
  slug: string;
  name: string;
  description?: string;
  toolkit: string;
  inputParameters?: Record<string, unknown>;
  workClass: WorkClass;
  /** Read through the workspace's own connection, which somebody else made and the person has not signed in to. */
  throughWorkspace?: true;
  /** Reached on this Mac itself, an MCP server or a signed in command line tool, with no Memnox service between. */
  local?: true;
}

/** The account one of the person's sign ins reached, as the tool itself named it. */
export interface CheckedAccount {
  toolkit: string;
  account?: { externalId?: string; handle?: string; name?: string; email?: string };
  check: WorkAccountCheck;
}

/** What a search found, the accounts it runs as, and what the person still has to sign in to. */
export interface PersonalTools {
  tools: PersonalTool[];
  accounts: CheckedAccount[];
  /** Tools the person named and has not signed in to yet, which any person may connect themselves. */
  signInFirst: string[];
  /** Signed in as somebody else's account, so nothing runs there until they sign in again. */
  signInAgain: string[];
  /** Tools the cloud would not let them connect, which it no longer does for anybody; kept so an old cloud is said plainly. */
  needsAdmin: string[];
  /** No tool by the name they gave can be reached. */
  unknown: string[];
}

/** A run the person confirmed: the proposal it answers, and the account they heard named. */
interface ConfirmedRun {
  proposalId: string;
  expectedAccount?: string;
}

export type PersonalAnswer<T> =
  { ok: true; value: T } | { ok: false; said: string; status?: number };

export interface PersonalRun {
  workClass: WorkClass;
  data: Record<string, unknown>;
}

/** Only when this Mac could not set itself up to act for them, since acting for themselves needs no Memnox account. */
const NOT_SIGNED_IN =
  'Memnox Cloud could not be reached to set this Mac up to act in their own tools just now. Say so in a sentence and offer to try again; they need no Memnox account for their own tools, so never ask them to sign in to Memnox for this.';
const NOT_REACHABLE =
  'The workspace could not be asked just now. Say so in a sentence; never say there is nothing there.';

/** What one confirmation is about, the same subject the control plane checks. */
export function workSubject(proposalId: string): string {
  return `work:${proposalId}`;
}

/** The tool and its exact argument text, hashed as the control plane hashes them. */
export function workDigest(tool: string, argumentsText: string): string {
  return createHash('sha256').update(`${tool}\n${argumentsText}`, 'utf8').digest('hex');
}

/** Tools matching the words, from the accounts the person connected. */
export async function findPersonalTools(
  home: string,
  search: string,
  toolkit?: string,
): Promise<PersonalAnswer<PersonalTools>> {
  return asPerson(home, async (person) => {
    const answer = await callCloud<Partial<PersonalTools>>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'work/tools'),
      method: 'POST',
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
      body: { search, ...(toolkit === undefined ? {} : { toolkit }) },
    });
    if (answer.status !== HTTP.OK) return refusal(answer);
    const body = answer.body;
    return {
      ok: true,
      value: {
        tools: listOf(body?.tools),
        accounts: listOf(body?.accounts),
        signInFirst: listOf(body?.signInFirst),
        signInAgain: listOf(body?.signInAgain),
        needsAdmin: listOf(body?.needsAdmin),
        unknown: listOf(body?.unknown),
      },
    };
  });
}

/** Runs one tool as the person; signed only where a proposal the person confirmed is named. */
export async function runPersonalTool(
  home: string,
  tool: string,
  argumentsText: string,
  confirmed?: ConfirmedRun,
): Promise<PersonalAnswer<PersonalRun>> {
  return asPerson(home, async (person) => {
    const signed =
      confirmed === undefined
        ? {}
        : {
            proposalId: confirmed.proposalId,
            deviceId: person.deviceId,
            signature: signWork(person, confirmed.proposalId, tool, argumentsText),
            ...(confirmed.expectedAccount === undefined
              ? {}
              : { expectedAccount: confirmed.expectedAccount }),
          };
    const answer = await callCloud<PersonalRun>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'work/run'),
      method: 'POST',
      token: person.token,
      timeoutMs: confirmed === undefined ? READ_TIMEOUT_MS : RUN_TIMEOUT_MS,
      body: { tool, arguments: argumentsText, ...signed },
    });
    if (answer.status !== HTTP.OK || answer.body === undefined) return refusal(answer);
    return { ok: true, value: answer.body };
  });
}

/**
 * The provider's own sign in for any tool, opened on this Mac. Every person connects their own tools,
 * whatever their role or plan, and this is the tool asking them once whether Memnox may act in their name.
 */
export async function signInPersonal(
  home: string,
  toolkit: string,
): Promise<PersonalAnswer<{ url: string; opened: boolean }>> {
  const link = await signInLink(home, toolkit);
  if (!link.ok) return link;
  // The person asked the voice for this, so they are at the Mac even with no terminal open.
  const opened = await openBrowser(link.value, {
    ...process.env,
    [OPEN_BROWSER_VAR]: '1',
  });
  return { ok: true, value: { url: link.value, opened } };
}

/** The page that signs the person in to one tool, opened by nobody, for the notch to offer. */
export async function signInLink(
  home: string,
  toolkit: string,
): Promise<PersonalAnswer<string>> {
  return asPerson(home, async (person) => {
    const answer = await callCloud<{ redirectUrl?: string }>({
      baseUrl: person.baseUrl,
      path: workPath(person, `grants/${encodeURIComponent(toolkit)}/link`),
      method: 'POST',
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    const url = answer.body?.redirectUrl;
    if (answer.status !== HTTP.OK || url === undefined) return refusal(answer);
    return { ok: true, value: url };
  });
}

/** One repository the workspace's GitHub App was granted, by `owner/repo`. */
export interface WorkspaceRepository {
  name: string;
  isPrivate?: boolean;
  pushedAt?: string;
}

/** What the workspace answers about its repositories: the linked ones, and how many more its App can reach. */
export interface WorkspaceRepositories {
  repositories: WorkspaceRepository[];
  /** Whether `repositories` is what the workspace linked, rather than everything its GitHub App was granted. */
  linked: boolean;
  elsewhere: number;
  others?: WorkspaceRepository[];
}

/**
 * The repositories the workspace connected, newest push first. Only names, which the workspace hands this Mac's own
 * credential too, so "which repository is linked" is answered before the person has signed in here.
 */
export async function workspaceRepositories(
  home: string,
  all = false,
): Promise<PersonalAnswer<WorkspaceRepositories>> {
  const reader = (await readPerson(home)) ?? (await machineReader(home));
  if (reader === null) return { ok: false, said: NOT_SIGNED_IN };
  try {
    const answer = await callCloud<Partial<WorkspaceRepositories>>({
      baseUrl: reader.baseUrl,
      path: `${workPath(reader, 'repositories')}${all ? '?all=true' : ''}`,
      token: reader.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (answer.status !== HTTP.OK) return refusal(answer);
    return { ok: true, value: repositoriesOf(answer.body) };
  } catch (err) {
    if (err instanceof CloudUnreachable) return { ok: false, said: NOT_REACHABLE };
    throw err;
  }
}

/** This Mac's own enrolment in the workspace, unless it was taken back. */
async function machineReader(home: string): Promise<CloudReader | null> {
  const account = await readAccount(home);
  return account === null || account.revokedAt !== undefined ? null : account;
}

/** An answer from before the linked ones were told apart reads as every repository being linked. */
function repositoriesOf(
  body: Partial<WorkspaceRepositories> | undefined,
): WorkspaceRepositories {
  return {
    repositories: listOf(body?.repositories),
    linked: body?.linked ?? true,
    elsewhere: typeof body?.elsewhere === 'number' ? body.elsewhere : 0,
    ...(Array.isArray(body?.others) ? { others: body.others } : {}),
  };
}

/** One read of a repository through the workspace's GitHub App, which needs no GitHub sign in of the person's own. */
export interface GithubRead {
  repository: string;
  what: string;
  number?: number;
}

export async function readWorkspaceGithub(
  home: string,
  read: GithubRead,
): Promise<PersonalAnswer<unknown>> {
  return asPerson(home, async (person) => {
    const answer = await callCloud<{ data?: unknown }>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'github/read'),
      method: 'POST',
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
      body: read,
    });
    if (answer.status !== HTTP.OK) return refusal(answer);
    return { ok: true, value: answer.body?.data ?? null };
  });
}

/** Whose accounts the person's sign ins reached, each checked against them by the workspace. */
export async function personalAccounts(
  home: string,
): Promise<PersonalAnswer<CheckedAccount[]>> {
  return asPerson(home, async (person) => {
    const answer = await callCloud<CheckedAccount[]>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'accounts'),
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (answer.status !== HTTP.OK) return refusal(answer);
    return { ok: true, value: listOf(answer.body) };
  });
}

/** The account the person's sign in to this tool reached, said once to be theirs. */
export async function claimAccount(
  home: string,
  toolkit: string,
): Promise<PersonalAnswer<CheckedAccount>> {
  return asPerson(home, async (person) => {
    const answer = await callCloud<CheckedAccount>({
      baseUrl: person.baseUrl,
      path: workPath(person, `accounts/${encodeURIComponent(toolkit)}/mine`),
      method: 'POST',
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (answer.status !== HTTP.OK || answer.body === undefined) return refusal(answer);
    return { ok: true, value: answer.body };
  });
}

/** Every sign in the person made to this tool undone, which only ever takes access away. */
export async function signOutOf(
  home: string,
  toolkit: string,
): Promise<PersonalAnswer<number>> {
  return asPerson(home, async (person) => {
    const grants = await callCloud<Array<{ id: string; toolkit: string }>>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'grants'),
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (grants.status !== HTTP.OK) return refusal(grants);
    const mine = listOf(grants.body).filter((grant) => grant.toolkit === toolkit);
    for (const grant of mine) {
      const removed = await callCloud({
        baseUrl: person.baseUrl,
        path: workPath(person, `grants/${encodeURIComponent(grant.id)}`),
        method: 'DELETE',
        token: person.token,
        timeoutMs: READ_TIMEOUT_MS,
      });
      if (removed.status !== HTTP.NO_CONTENT) return refusal(removed);
    }
    return { ok: true, value: mine.length };
  });
}

/** One of the person's sign ins as the workspace lists it under `me/grants`. */
interface PersonGrant {
  id: string;
  toolkit: string;
  status?: string;
  enabled?: boolean;
}

/** The cloud's word for a sign in that works right now. */
const GRANT_ACTIVE = 'active';

/** Said by the Mac's menu bar as it stands, so these are words for the person rather than for the voice. */
export const CONNECTIONS_NOT_SIGNED_IN =
  'This Mac could not reach Memnox Cloud to connect your apps just now. Try again in a moment; you need no Memnox account for your own apps.';
const CONNECTIONS_NOT_REACHABLE =
  'Memnox Cloud could not be reached just now, so your connected apps cannot be shown.';

/** The apps the person connected, one per toolkit, for the Mac to show. */
export async function connectionsOf(
  home: string,
): Promise<PersonalAnswer<ToolConnection[]>> {
  const person = await existingCaller(home);
  // Nothing registered yet is nothing connected yet, so a list never registers a space on its own.
  if (person === null) return { ok: true, value: [] };
  try {
    const grants = await callCloud<PersonGrant[]>({
      baseUrl: person.baseUrl,
      path: workPath(person, 'grants'),
      token: person.token,
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (grants.status !== HTTP.OK) return refusal(grants);
    return { ok: true, value: connectionsFrom(listOf(grants.body)) };
  } catch (err) {
    if (err instanceof CloudUnreachable)
      return { ok: false, said: CONNECTIONS_NOT_REACHABLE };
    throw err;
  }
}

/** One entry per toolkit, connected when any of its sign ins is active and enabled, sorted by toolkit. */
export function connectionsFrom(grants: readonly PersonGrant[]): ToolConnection[] {
  const byToolkit = new Map<string, boolean>();
  for (const grant of grants) {
    if (typeof grant.toolkit !== 'string' || grant.toolkit === '') continue;
    const toolkit = grant.toolkit.toLowerCase();
    const live = grant.status?.toLowerCase() === GRANT_ACTIVE && grant.enabled === true;
    byToolkit.set(toolkit, (byToolkit.get(toolkit) ?? false) || live);
  }
  return [...byToolkit.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([toolkit, connected]) => ({ toolkit, connected }));
}

/** The account as a card names it, and the key a run is checked against. */
export function workAccountOf(checked: CheckedAccount): WorkAccount {
  const account = checked.account;
  const key = account?.externalId ?? account?.handle;
  return {
    check: checked.check,
    ...(key === undefined ? {} : { key }),
    ...(account?.handle === undefined ? {} : { handle: account.handle }),
    ...(account?.name === undefined ? {} : { name: account.name }),
  };
}

function signWork(
  person: PersonalCaller,
  proposalId: string,
  tool: string,
  argumentsText: string,
): string {
  const message = confirmationMessage(
    workSubject(proposalId),
    workDigest(tool, argumentsText),
  );
  return sign('sha256', Buffer.from(message, 'utf8'), {
    key: createPrivateKey(person.privateKey),
    dsaEncoding: 'der',
  }).toString('base64');
}

async function asPerson<T>(
  home: string,
  call: (person: PersonalCaller) => Promise<PersonalAnswer<T>>,
): Promise<PersonalAnswer<T>> {
  const person = await personalCaller(home);
  if (person === null) return { ok: false, said: NOT_SIGNED_IN };
  try {
    return await call(person);
  } catch (err) {
    if (err instanceof CloudUnreachable) return { ok: false, said: NOT_REACHABLE };
    throw err;
  }
}

function listOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Whoever a read goes out as: the person, or for workspace names alone this Mac. */
type CloudReader = Pick<PersonalCaller, 'baseUrl' | 'workspaceId' | 'token'>;

/** The signed in person, else this Mac's own personal space, without registering one. */
export async function existingCaller(home: string): Promise<PersonalCaller | null> {
  const person = await readPerson(home);
  if (person !== null) return person;
  const space = await readDeviceSpace(home);
  return space === null ? null : spaceAsCaller(space);
}

/**
 * Who acts in the person's own tools: the person where they signed in, else this Mac's personal space,
 * registered the first time it is needed so nobody needs a Memnox account to act as themselves.
 */
export async function personalCaller(home: string): Promise<PersonalCaller | null> {
  const found = await existingCaller(home);
  if (found !== null) return found;
  const space = await ensureDeviceSpace(home, await spaceBaseUrl(home, defaultBaseUrl()));
  return space === null ? null : spaceAsCaller(space);
}

function workPath(person: CloudReader, route: string): string {
  return `/v1/workspaces/${encodeURIComponent(person.workspaceId)}/me/${route}`;
}

/** The control plane's own sentence where it gave one, so the voice says what actually stopped it. */
export function refusal<T>(answer: {
  status: number;
  body?: unknown;
}): PersonalAnswer<T> {
  const body = answer.body;
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message) // narrowed by the `in` check above
      : `The workspace answered ${answer.status}.`;
  return { ok: false, said: message, status: answer.status };
}

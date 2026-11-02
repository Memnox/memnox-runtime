import {
  budgetOf,
  HTTP,
  isCredentialRefused,
  noteRead,
  readAccount,
  readRange,
  secondsToMs,
  type ReadRange,
  type WorkSource,
} from '@memnox/core';

import { callCloud, CloudUnreachable, sameControlPlane } from './client';
import { readPerson } from './person';

/**
 * What the workspace lets this machine read beyond its rules and settled facts: the messages and
 * tickets people wrote, and the workspace's own name. Both come through the control plane's MCP
 * route, which filters to what a machine is cleared for, so nothing here widens what it may see.
 */

/** Short, since the person is waiting on a spoken answer. */
const READ_TIMEOUT_MS = secondsToMs(5);

const TOOL_SOURCES = 'memnox_sources';
const TOOL_WORKSPACE = 'memnox_workspace';
const TOOL_SOURCE = 'memnox_source';
const TOOL_PEOPLE = 'memnox_people';

/** One item read whole, as far as the workspace lets this machine. */
export interface SourceRead {
  content: string;
  /** The workspace stopped at its own ceiling, so this is not the end of it. */
  cut: boolean;
  untrusted: boolean;
  /** Where a range was asked: the lines this is, of how many, and the range to ask for next. */
  lines?: { from: number; to: number; total: number; next?: string };
}

/** Part of an item to read, inside a token budget, rather than the whole of it. */
interface SourceRange extends ReadRange {
  budget?: number;
}

/** What the person asked for, every part optional and narrowing. */
export interface SourceQuery {
  about?: string;
  person?: string;
  assignee?: string;
  system?: string;
  since?: string;
}

export interface SourcesRead {
  sources: WorkSource[];
  /** Every readable item that matches, not only these. */
  total: number;
  /** Matched and kept back, since this machine is not cleared for them. */
  withheld: number;
}

/** The messages and tickets that match, or null where the workspace cannot be asked just now. */
export async function readSources(
  home: string,
  query: SourceQuery,
): Promise<SourcesRead | null> {
  const answer = await callWorkspaceTool(home, TOOL_SOURCES, { ...query });
  if (answer === null) return null;
  const listed = answer['sources'];
  return {
    sources: Array.isArray(listed) ? listed.flatMap(sourceOf) : [],
    total: numberOr(answer['total'], 0),
    withheld: numberOr(answer['withheld'], 0),
  };
}

/**
 * The item at this link, whole, or only the asked lines or heading inside a token budget; null
 * where it is not there, not cleared, or not reachable. A control plane that answered whole is cut
 * here, so a range costs the agent the same whichever version answered.
 */
export async function readSource(
  home: string,
  link: string,
  range?: SourceRange,
): Promise<SourceRead | null> {
  const answer = await callWorkspaceTool(home, TOOL_SOURCE, {
    link,
    ...(range === undefined ? {} : { ...range, budget: budgetOf(range.budget) }),
  });
  const source = objectOr(answer?.['source']);
  const content = source?.['content'];
  if (source === null || typeof content !== 'string') return null;
  const whole = {
    content,
    cut: source['cut'] === true,
    untrusted: typeof source['untrusted'] === 'string',
  };
  if (range === undefined) return whole;
  const ranged = objectOr(source['lines']);
  if (ranged !== null) return { ...whole, lines: linesOf(ranged) };
  const part = readRange(content, range, budgetOf(range.budget));
  if (part === null) return { ...whole, content: '' };
  await noteRead(home, { tool: TOOL_SOURCE, returnedText: part.text, fullText: content });
  return {
    ...whole,
    content: part.text,
    lines: {
      from: part.from,
      to: part.to,
      total: part.total,
      ...(part.next === undefined ? {} : { next: part.next }),
    },
  };
}

/** The name the workspace was given, or null when it has none or cannot be asked. */
export async function readWorkspaceName(home: string): Promise<string | null> {
  const answer = await callWorkspaceTool(home, TOOL_WORKSPACE, {});
  // Only the name is kept: the rest of that answer is the fleet, which nothing here needs.
  const name = answer?.['name'];
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
}

/**
 * Whether the person signed in to one workspace and this Mac is enrolled in another, which leaves
 * the voice reading an empty memory and none of the tools an admin connected, with no error anywhere.
 */
export async function personElsewhere(home: string): Promise<boolean> {
  const [account, person] = await Promise.all([
    readAccount(home).catch(() => null),
    readPerson(home).catch(() => null),
  ]);
  if (account === null || person === null) return false;
  return (
    account.workspaceId !== person.workspaceId ||
    !sameControlPlane(account.baseUrl, person.baseUrl)
  );
}

/**
 * Who in the workspace answers to a name, with the handles each has in the tools it connects, so a
 * message finds the person meant; null where the workspace cannot be asked just now.
 */
export async function readPeople(
  home: string,
  name: string | undefined,
): Promise<Record<string, unknown> | null> {
  return callWorkspaceTool(home, TOOL_PEOPLE, name === undefined ? {} : { name });
}

/** One `tools/call`, answered as the object the tool wrote, or null for any failure at all. */
async function callWorkspaceTool(
  home: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const account = await readAccount(home);
  if (account === null || account.revokedAt !== undefined) return null;
  let answer;
  try {
    answer = await callCloud<unknown>({
      baseUrl: account.baseUrl,
      path: `/v1/workspaces/${account.workspaceId}/mcp`,
      method: 'POST',
      token: account.token,
      timeoutMs: READ_TIMEOUT_MS,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    });
  } catch (err) {
    if (err instanceof CloudUnreachable) return null;
    throw err;
  }
  if (isCredentialRefused(answer.status) || answer.status !== HTTP.OK) return null;
  return toolPayload(answer.body);
}

/** The JSON a tool put in its first text block, unless the call or the tool failed. */
function toolPayload(body: unknown): Record<string, unknown> | null {
  const result = objectOr(objectOr(body)?.['result']);
  if (result === null || result['isError'] === true) return null;
  const content = result['content'];
  const first = Array.isArray(content) ? objectOr(content[0]) : null;
  const text = first?.['text'];
  if (typeof text !== 'string') return null;
  try {
    return objectOr(JSON.parse(text));
  } catch {
    return null;
  }
}

function sourceOf(item: unknown): WorkSource[] {
  const row = objectOr(item);
  const title = row?.['title'];
  const system = row?.['system'];
  const at = row?.['at'];
  if (typeof title !== 'string' || typeof system !== 'string' || typeof at !== 'string')
    return [];
  return [
    {
      title,
      system,
      at,
      ...textField(row, 'excerpt'),
      ...textField(row, 'author'),
      ...textField(row, 'link'),
    },
  ];
}

function textField(
  row: Record<string, unknown> | null,
  key: 'excerpt' | 'author' | 'link',
): Partial<Record<typeof key, string>> {
  const value = row?.[key];
  return typeof value === 'string' && value !== '' ? { [key]: value } : {};
}

/** The control plane's account of which lines it sent, read field by field. */
function linesOf(ranged: Record<string, unknown>): NonNullable<SourceRead['lines']> {
  const next = ranged['next'];
  return {
    from: numberOr(ranged['from'], 1),
    to: numberOr(ranged['to'], 0),
    total: numberOr(ranged['total'], 0),
    ...(typeof next === 'string' ? { next } : {}),
  };
}

function objectOr(value: unknown): Record<string, unknown> | null {
  // Narrowed here, at the edge, because this is the control plane's JSON and nothing vouches for it.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

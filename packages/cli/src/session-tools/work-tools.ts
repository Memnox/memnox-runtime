/**
 * The workspace behind a piece of work: what the voice reads when the person asks about their
 * Slack or their tickets, the brief it gathers when it hands an agent a ticket, and the tool the
 * agent reads that brief through. None of it is consulted by any verdict.
 */
import {
  factOrigin,
  factsAbout,
  MOST_FACTS_ANSWERED,
  MOST_WORK_ITEM_CHARS,
  MOST_WORK_ITEMS_READ_WHOLE,
  MOST_WORK_SOURCES,
  readWorkspaceMemoryCached,
  WorkBriefs,
  workBriefId,
  isWorkBriefId,
  WORK_BRIEF_KEEPING,
  type WorkBrief,
  type WorkDecision,
  type WorkSource,
} from '@memnox/core';

import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { readTool, type ToolDefinition } from './session-tools';

const NOT_REACHABLE =
  'The workspace could not be asked just now: this Mac is not connected, or the control plane did not answer. Say so in a sentence; never say there is nothing there.';

/** Messages, tickets and documents from the systems the workspace connects, as far as this Mac may read. */
export async function sourcesTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const query = {
    ...optional('about', textArg(args, 'about')),
    ...optional('person', textArg(args, 'person')),
    ...optional('assignee', textArg(args, 'assignee')),
    ...optional('system', textArg(args, 'system')),
    ...optional('since', textArg(args, 'since')),
  };
  const read = (await deps.sources?.(query)) ?? null;
  if (read === null) return { reached: false, said: NOT_REACHABLE };
  return {
    sources: read.sources,
    total: read.total,
    ...(read.withheld > 0
      ? { withheld: `${read.withheld} more this Mac is not cleared to read` }
      : {}),
    ...(read.sources.length === 0
      ? { said: 'Nothing in the connected systems matches. Say so rather than guess.' }
      : {}),
  };
}

export const PEOPLE_TOOL: ToolDefinition = readTool(
  'people',
  'Who is in the workspace: each person with their name, email and the handle or id they have in every tool the workspace connects, such as their Slack user id, and people seen in those tools who have no seat. Use it to find who they mean by a name before a message, a DM or a mention, like "send a message to Neko", and pass that id to the tool that sends. Matches part of a name, email or handle; leave name out to list everyone.',
  {
    name: {
      type: 'string',
      description: 'the name, email or handle as they said it, misheard words fixed',
    },
  },
);

/** Who in the workspace answers to a name, with their handles in each tool it connects. */
export async function peopleTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const read = (await deps.people?.(textArg(args, 'name'))) ?? null;
  if (read === null) return { reached: false, said: NOT_REACHABLE };
  return read;
}

/**
 * Gathers what the workspace holds about the work named, and keeps it for the agent to read: the
 * ticket, every message and document that names it by its words, its id or its link, and the
 * settled facts it must keep to.
 */
async function gatherWork(deps: SessionToolDeps, about: string): Promise<WorkBrief> {
  const at = deps.now().toISOString();
  const [first] = await Promise.all([deps.sources?.({ about }), deps.refreshMemory?.()]);
  const ticket = (first?.sources ?? []).find(isTicket);
  const handles = ticket === undefined ? [] : ticketHandles(ticket);
  const more = await Promise.all([
    ...handles.map((handle) => deps.sources?.({ about: handle })),
    deps.sources?.({ about, system: 'document' }),
  ]);
  const reads = [first, ...more].filter((each) => each !== undefined && each !== null);
  const brief: WorkBrief = {
    id: workBriefId(about, at),
    about,
    at,
    sources: await readWhole(
      deps,
      inOrder(
        ticket,
        reads.flatMap((read) => read.sources),
      ),
    ),
    decisions: await decisionsAbout(deps, `${about} ${ticket?.title ?? ''}`),
    withheld: Math.max(0, ...reads.map((read) => read.withheld)),
  };
  await new WorkBriefs(deps.home).write(brief);
  return brief;
}

/**
 * The ticket read whole, and the documents and messages whose excerpt stopped short, so the agent
 * works from what was written rather than its first few hundred characters.
 */
async function readWhole(
  deps: SessionToolDeps,
  sources: readonly WorkSource[],
): Promise<WorkSource[]> {
  const read = deps.source;
  if (read === undefined) return [...sources];
  const chosen = new Set(
    sources
      .filter((each, at) => (at === 0 && isTicket(each)) || looksCut(each))
      .filter((each) => each.link !== undefined)
      .slice(0, MOST_WORK_ITEMS_READ_WHOLE + 1),
  );
  return Promise.all(
    sources.map(async (each) => {
      if (!chosen.has(each) || each.link === undefined) return each;
      const whole = await read(each.link);
      if (whole === null) return each;
      const most = isTicket(each) ? whole.content.length : MOST_WORK_ITEM_CHARS;
      const cut = whole.cut || whole.content.length > most;
      return {
        ...each,
        content: `${whole.content.slice(0, most)}${cut ? ' [cut short here; open the link for the rest]' : ''}`,
        ...(whole.untrusted ? { untrusted: true } : {}),
      };
    }),
  );
}

/** A document, or an excerpt that ran to the length the workspace clips at. */
function looksCut(source: WorkSource): boolean {
  return source.system === 'document' || (source.excerpt?.length ?? 0) >= CLIPPED_AT;
}

/** Just under the workspace's own excerpt length, which is four hundred characters. */
const CLIPPED_AT = 390;

/** The settled facts that name any of these words, each with who settled it. */
async function decisionsAbout(
  deps: SessionToolDeps,
  text: string,
): Promise<WorkDecision[]> {
  const memory = await readWorkspaceMemoryCached(deps.home);
  if (memory === null) return [];
  const words = text.split(/[\s,]+/).filter((word) => word !== '');
  return factsAbout(memory, { words, paths: words.filter((word) => word.includes('/')) })
    .slice(0, MOST_FACTS_ANSWERED)
    .map(({ fact }) => ({ statement: fact.statement, settled: factOrigin(fact) }));
}

/** How people refer to a ticket without its title: its key, its number and its link. */
function ticketHandles(ticket: WorkSource): string[] {
  const text = `${ticket.title} ${ticket.link ?? ''}`;
  const keys = text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
  const number = ticket.link?.match(/\/(?:issues|pull)\/(\d+)/)?.[1];
  const handles = [...keys, ...(number === undefined ? [] : [`#${number}`])];
  if (ticket.link !== undefined) handles.push(ticket.link);
  return [...new Set(handles)].slice(0, MOST_HANDLES);
}

/** Few enough searches that gathering stays inside the time a spoken read back can wait. */
const MOST_HANDLES = 3;

/** The ticket first, then everything else once and oldest first, so the thread reads as it went. */
function inOrder(
  ticket: WorkSource | undefined,
  found: readonly WorkSource[],
): WorkSource[] {
  const seen = new Set<string>();
  const once = found.filter((each) => {
    const key = each.link ?? `${each.system}|${each.title}|${each.at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rest = once
    .filter((each) => each !== ticket)
    .sort((a, b) => a.at.localeCompare(b.at));
  return [...(ticket === undefined ? [] : [ticket]), ...rest].slice(0, MOST_WORK_SOURCES);
}

function isTicket(source: WorkSource): boolean {
  return TICKET_SYSTEMS.has(source.system.toLowerCase());
}

/**
 * Words for an agent with the pointer to its brief added, when the person named work from the
 * workspace. The pointer goes whole and the words give way, so the agent always learns where it is.
 */
export async function withBrief(
  deps: SessionToolDeps,
  args: ToolArgs,
  words: string,
  most = Number.POSITIVE_INFINITY,
): Promise<{ text: string; brief?: string; found?: Record<string, unknown> }> {
  const work = textArg(args, 'work');
  if (work === undefined) return { text: words.slice(0, most) };
  const brief = await gatherWork(deps, work);
  const pointer = ` ${briefPointer(brief)}`;
  return {
    text: `${words.slice(0, Math.max(0, most - pointer.length))}${pointer}`,
    brief: brief.id,
    found: briefFound(brief),
  };
}

/** The line a task or an instruction carries, which is all a terminal line has room for. */
function briefPointer(brief: WorkBrief): string {
  return `Before you change anything, read workspace brief ${brief.id} with the memnox-session work tool, and keep to every decision in it.`;
}

/** What the voice says it found, in counts, so a read back never claims more than was there. */
function briefFound(brief: WorkBrief): Record<string, unknown> {
  const ticket = brief.sources.find(isTicket);
  return {
    brief: brief.id,
    ...(ticket === undefined ? {} : { ticket: ticket.title }),
    messages: brief.sources.filter((each) => each !== ticket).length,
    decisions: brief.decisions.length,
  };
}

const TICKET_SYSTEMS = new Set(['linear', 'jira', 'github']);

/** The agent's side: the brief in full, and what keeping to it means. */
export async function workTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const id = textArg(args, 'brief');
  if (id === undefined || !isWorkBriefId(id)) {
    return { said: 'Pass brief: the id your instruction named, such as wrk_1a2b3c.' };
  }
  const brief = await new WorkBriefs(deps.home).read(id);
  if (brief === null)
    return { said: `No workspace brief ${id} is kept on this machine.` };
  return {
    ...brief,
    keep: WORK_BRIEF_KEEPING,
  };
}

function optional<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  // Built this way so an absent field is left out rather than sent as undefined.
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, string>>);
}

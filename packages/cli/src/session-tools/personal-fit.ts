import type { PersonalTool } from '../sync/personal-work';
import { bounded, MOST_ANSWER_CHARS } from './bounded';

/**
 * What the person's own tools hand back, made to fit the brain's answer whole: a listing loses fields
 * from every item before it loses a single item, and a tool search keeps its best matches with short inputs.
 */

/** Room under the answer's cap for what the voice is told beside the data. */
const ROOM_FOR_WORDS = 1_000;

/** As much data as one answer carries before it is cut. */
export const MOST_DATA_CHARS = MOST_ANSWER_CHARS - ROOM_FOR_WORDS;

/** Fields an item is known and opened by, kept whatever else it loses, so a trimmed list still names every item. */
const NAMING_KEY =
  /^(id|number|key|identifier|name|title|full_name|login|by|state|status|html_url|url|permalink|web_url|email|subject|isPullRequest|draft)$/i;

/** A list made to fit, and the fields every item lost on the way. */
interface Fitted {
  value: unknown;
  leftOut: string[];
}

/** Bounded as every answer is, then the bulkiest field taken off every item until the whole list fits. */
export function fittedListing(value: unknown, budget = MOST_DATA_CHARS): Fitted {
  const shaped = bounded(value);
  const leftOut: string[] = [];
  while (sizeOf(shaped) > budget) {
    const key = shedBulkiestField(shaped);
    if (key === null) break;
    leftOut.push(key);
  }
  return { value: shaped, leftOut };
}

/** What the voice is told when items lost fields, so it never says an item is missing that is only shorter. */
function leftOutSaid(leftOut: readonly string[]): string | undefined {
  return leftOut.length === 0
    ? undefined
    : `Every item is here, and to fit each one lost ${leftOut.join(', ')}. Answer how many and which from this; read one item on its own for those.`;
}

function sizeOf(value: unknown): number {
  return (JSON.stringify(value) ?? '').length;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Takes the field with the most text across the items of any list off each of them; null when none has one to lose. */
function shedBulkiestField(root: unknown): string | null {
  let bulkiest: { rows: Record<string, unknown>[]; key: string; size: number } | null =
    null;
  for (const list of listsIn(root)) {
    const rows = list.filter(isRow);
    // One item is read on its own, never a listing.
    if (rows.length < 2) continue;
    const sizes = new Map<string, number>();
    for (const row of rows) {
      for (const [key, each] of Object.entries(row)) {
        if (NAMING_KEY.test(key)) continue;
        sizes.set(key, (sizes.get(key) ?? 0) + sizeOf(each));
      }
    }
    for (const [key, size] of sizes) {
      if (bulkiest === null || size > bulkiest.size) bulkiest = { rows, key, size };
    }
  }
  if (bulkiest === null) return null;
  for (const row of bulkiest.rows) delete row[bulkiest.key];
  return bulkiest.key;
}

/** Every list in a bounded value, which is a fresh tree and so safe to change in place. */
function listsIn(value: unknown): unknown[][] {
  if (Array.isArray(value)) return [value, ...value.flatMap(listsIn)];
  if (!isRow(value)) return [];
  return Object.values(value).flatMap(listsIn);
}

/** A tool as the voice reads it: what it does and the inputs it needs, without the examples and titles of its schema. */
interface VoiceTool {
  slug: string;
  workClass: PersonalTool['workClass'];
  does?: string;
  /** Each input it cannot run without, with what goes in it. */
  needs?: Record<string, string>;
  /** The rest by name and type, which is enough to fill one the person asked for. */
  optional?: string;
  throughWorkspace?: true;
}

/** Long enough to tell two tools apart, short enough that twenty fit in one answer. */
const DOES_CHARS = 160;
const NEEDS_CHARS = 90;
const BRIEF_CHARS = 90;
/** A choice of values is named in full up to here, since a value outside it is refused. */
const MOST_CHOICES = 8;
/** How many the cloud's search ranks first, ahead of each tool's usual set. */
const SEARCH_MATCHES = 8;

/**
 * The tools a search found, best match first, each in a few words and as many as fit, so a write the search
 * ranked first is never the one lost to make room. The count left out is said rather than hidden.
 */
export function voiceTools(
  tools: readonly PersonalTool[],
  budget = MOST_DATA_CHARS,
): { tools: VoiceTool[]; leftOut: number } {
  const whole = tools.map((tool) => voiceTool(tool, true));
  // Past the search's own matches a tool is named in brief, so more of the usual ones fit.
  const fitting =
    sizeOf(whole) <= budget
      ? whole
      : tools.map((tool, at) => voiceTool(tool, at < SEARCH_MATCHES));
  const shown: VoiceTool[] = [];
  let size = 0;
  for (const each of fitting) {
    const more = sizeOf(each) + 1;
    if (size + more > budget) break;
    shown.push(each);
    size += more;
  }
  return { tools: shown, leftOut: tools.length - shown.length };
}

/** In full, each input it needs is described and the rest named; in brief, only the types of what it needs. */
function voiceTool(tool: PersonalTool, full: boolean): VoiceTool {
  const schema = isRow(tool.inputParameters) ? tool.inputParameters : {};
  const properties = isRow(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((each): each is string => typeof each === 'string')
      : [],
  );
  const needs: Record<string, string> = {};
  const optional: string[] = [];
  for (const [name, input] of Object.entries(properties)) {
    const kind = kindOf(input);
    if (required.has(name)) {
      const about = full && isRow(input) ? textOf(input.description, NEEDS_CHARS) : '';
      needs[name] = about === '' ? kind : `${kind}: ${about}`;
    } else optional.push(`${name} ${kind}`);
  }
  const does = textOf(tool.description ?? tool.name, full ? DOES_CHARS : BRIEF_CHARS);
  return {
    slug: tool.slug,
    workClass: tool.workClass,
    ...(does === '' ? {} : { does }),
    ...(Object.keys(needs).length === 0 ? {} : { needs }),
    ...(full && optional.length > 0 ? { optional: optional.join(', ') } : {}),
    ...(tool.throughWorkspace === true ? { throughWorkspace: true as const } : {}),
  };
}

/** An input's type in a word, or the values it takes when it takes only a few. */
function kindOf(input: unknown): string {
  if (!isRow(input)) return 'any';
  if (Array.isArray(input.enum)) return input.enum.slice(0, MOST_CHOICES).join('|');
  const type = typeof input.type === 'string' ? input.type : 'any';
  if (type !== 'array') return type;
  const items =
    isRow(input.items) && typeof input.items.type === 'string' ? input.items.type : 'any';
  return `list of ${items}`;
}

/** Cut at a word, so a description never ends in half of one. */
function textOf(value: unknown, most: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= most) return text;
  const cut = text.slice(0, most);
  const space = cut.lastIndexOf(' ');
  return `${space > 0 ? cut.slice(0, space) : cut}...`;
}

/** What a read came back with, every item kept, since a listing cut short cannot answer how many or which. */
export function readBack(data: unknown): Record<string, unknown> {
  const fitted = fittedListing(data);
  const said = leftOutSaid(fitted.leftOut);
  return { data: fitted.value, untrusted: true, ...(said === undefined ? {} : { said }) };
}

/** A search's tools fitted best match first, since a long list cut to fit used to lose its first and best ones. */
export function foundTools(
  tools: readonly PersonalTool[],
  signIns: string | undefined,
): { tools: VoiceTool[]; said?: string } {
  const fitted = voiceTools(tools);
  const said = [signIns, toolsSaid(fitted.tools, fitted.leftOut)]
    .filter((each) => each !== undefined)
    .join(' ');
  return { tools: fitted.tools, ...(said === '' ? {} : { said }) };
}

/** What the tools found can do, so a write in the list is never reported as missing. */
function toolsSaid(tools: readonly VoiceTool[], leftOut: number): string | undefined {
  const acts = tools.some((tool) => tool.workClass === 'act');
  const parts = [
    ...(acts
      ? [
          'A tool with workClass act sends or changes something as them, such as a comment on a pull request, an issue or a ticket: write it down with propose_tool, which puts a draft on their screen for Touch ID.',
        ]
      : []),
    ...(leftOut === 0
      ? []
      : [
          `${leftOut} more of its usual tools were left out to fit. When none here does what they asked, call find_tool again with the words for that one before saying it cannot be done.`,
        ]),
  ];
  return parts.length === 0 ? undefined : parts.join(' ');
}

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  SESSION_COST_DAYS,
  SKILL_OUTCOME,
  skillNameInvoked,
  type SkillEvent,
  type UsageTurn,
} from '@memnox/core';

/**
 * What the transcripts Claude Code keeps say about cost and skills, read once per file version:
 * each assistant turn's cache tokens, and each skill invoked with what failed or was refused
 * inside its turn. Read for counting only; no word of a conversation leaves this module.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
/** A transcript past this is a runaway, so it is passed over rather than read whole. */
const MOST_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
/** What an agent's tool says when a permission or a rule stopped it, as against an error of its own. */
const REFUSED = /\b(denied|refused|not allowed|blocked|permission)\b/i;
const SKILL_TOOL = 'Skill';
const MOST_SAID_CHARS = 160;

interface TranscriptUsage {
  turns: UsageTurn[];
  skills: SkillEvent[];
}

/** Each file's reading, by path, kept while its size and time are unchanged. */
const cache = new Map<string, { stamp: string; usage: TranscriptUsage }>();

type Entry = Record<string, unknown>;

function entryOf(line: string): Entry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    // Cast is safe: an object was just checked for.
    return parsed !== null && typeof parsed === 'object' ? (parsed as Entry) : null;
  } catch {
    // A torn last line is the ordinary end of a transcript still being written.
    return null;
  }
}

function objectOf(value: unknown): Entry | null {
  // Cast is safe: an object was just checked for.
  return value !== null && typeof value === 'object' ? (value as Entry) : null;
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function blocksOf(message: Entry | null): Entry[] {
  const content = message?.['content'];
  if (!Array.isArray(content)) return [];
  const listed: unknown[] = content;
  return listed.flatMap((each): Entry[] => {
    const block = objectOf(each);
    return block === null ? [] : [block];
  });
}

/** One assistant turn's cache tokens, once per message however many lines it was written as. */
function turnOf(entry: Entry, session: string, seen: Set<string>): UsageTurn | null {
  const message = objectOf(entry['message']);
  const usage = objectOf(message?.['usage']);
  const id = message?.['id'];
  if (usage === null || typeof id !== 'string' || seen.has(id)) return null;
  seen.add(id);
  const at = Date.parse(typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '');
  if (Number.isNaN(at)) return null;
  return {
    session,
    at,
    model: typeof message?.['model'] === 'string' ? message['model'] : 'unknown',
    cacheWrite: numberOf(usage['cache_creation_input_tokens']),
    cacheRead: numberOf(usage['cache_read_input_tokens']),
  };
}

/** The skill a tool call invokes, by its name without a plugin's prefix. */
function skillInvoked(block: Entry): string | null {
  if (block['type'] !== 'tool_use' || block['name'] !== SKILL_TOOL) return null;
  const input = objectOf(block['input']);
  const named = input?.['skill'] ?? input?.['command'];
  return typeof named === 'string' && named.trim() !== ''
    ? skillNameInvoked(named)
    : null;
}

function resultText(block: Entry): string {
  const content = block['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((each) => {
      const text = objectOf(each)?.['text'];
      return typeof text === 'string' ? [text] : [];
    })
    .join(' ');
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim() !== '') ?? '')
    .trim()
    .slice(0, MOST_SAID_CHARS);
}

/** A person's own prompt, which ends the turn a skill was invoked in. */
function isPrompt(entry: Entry): boolean {
  if (entry['type'] !== 'user') return false;
  const content = objectOf(entry['message'])?.['content'];
  if (typeof content === 'string') return true;
  return blocksOf(objectOf(entry['message'])).every(
    (block) => block['type'] !== 'tool_result',
  );
}

interface Walk {
  usage: TranscriptUsage;
  seen: Set<string>;
  /** The skill whose turn the walk is in, until the person's next prompt. */
  inside: string | null;
}

function failureOf(walk: Walk, block: Entry, at: string): void {
  if (
    walk.inside === null ||
    block['type'] !== 'tool_result' ||
    block['is_error'] !== true
  )
    return;
  const said = firstLine(resultText(block));
  walk.usage.skills.push({
    skill: walk.inside,
    at,
    outcome: REFUSED.test(said) ? SKILL_OUTCOME.REFUSAL : SKILL_OUTCOME.FAILURE,
    ...(said === '' ? {} : { said }),
  });
}

function walkEntry(walk: Walk, entry: Entry, session: string): void {
  if (entry['isSidechain'] === true) return;
  const at = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '';
  if (isPrompt(entry)) walk.inside = null;
  const turn = entry['type'] === 'assistant' ? turnOf(entry, session, walk.seen) : null;
  if (turn !== null) walk.usage.turns.push(turn);
  for (const block of blocksOf(objectOf(entry['message']))) {
    const skill = skillInvoked(block);
    if (skill !== null) {
      walk.inside = skill;
      walk.usage.skills.push({ skill, at, outcome: SKILL_OUTCOME.USE });
    }
    failureOf(walk, block, at);
  }
}

/** One transcript's turns and skill events, from its raw JSON lines. */
export function transcriptUsageIn(raw: string, session: string): TranscriptUsage {
  const walk: Walk = { usage: { turns: [], skills: [] }, seen: new Set(), inside: null };
  for (const line of raw.split('\n')) {
    const entry = entryOf(line);
    if (entry !== null) walkEntry(walk, entry, session);
  }
  return walk.usage;
}

async function transcriptFiles(transcripts: string, since: number): Promise<string[]> {
  const projects = join(transcripts, '.claude', 'projects');
  const folders = await readdir(projects).catch((): string[] => []);
  const listed = await Promise.all(
    folders.map(async (folder) => {
      const names = await readdir(join(projects, folder)).catch((): string[] => []);
      return names
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => join(projects, folder, name));
    }),
  );
  const files = await Promise.all(
    listed.flat().map(async (path) => {
      const info = await stat(path).catch(() => null);
      return info !== null && info.mtimeMs >= since && info.size <= MOST_TRANSCRIPT_BYTES
        ? { path, stamp: `${info.size}:${info.mtimeMs}` }
        : null;
    }),
  );
  return files.flatMap((file) => (file === null ? [] : [`${file.stamp}\n${file.path}`]));
}

/** Every transcript changed in the last days, its turns kept to those days. */
export async function recentTranscriptUsage(
  transcripts: string,
  now: Date,
): Promise<TranscriptUsage> {
  const since = now.getTime() - SESSION_COST_DAYS * DAY_MS;
  const usage: TranscriptUsage = { turns: [], skills: [] };
  for (const stamped of await transcriptFiles(transcripts, since)) {
    const [stamp = '', path = ''] = stamped.split('\n');
    const read = await readOnce(path, stamp);
    usage.turns.push(...read.turns.filter((turn) => turn.at >= since));
    usage.skills.push(...read.skills.filter((event) => Date.parse(event.at) >= since));
  }
  return usage;
}

async function readOnce(path: string, stamp: string): Promise<TranscriptUsage> {
  const kept = cache.get(path);
  if (kept !== undefined && kept.stamp === stamp) return kept.usage;
  const raw = await readFile(path, 'utf8').catch(() => '');
  const usage = transcriptUsageIn(raw, basename(path, '.jsonl'));
  cache.set(path, { stamp, usage });
  return usage;
}

import { BRAIN_CHUNK, type BrainChunk } from './brain';

/**
 * Claude Code's `stream-json` output, one line at a time, turned into what the voice says.
 * Every field is checked before it is read, since the shape is Claude Code's and not ours.
 */

interface StreamRead {
  chunks: BrainChunk[];
  /** Set by the lines that carry one, so the next conversation can resume this one. */
  sessionId?: string;
}

/** How Claude Code words a plan that has run out, the one error said differently. */
const LIMIT_WORDING = /usage limit|rate limit|limit reached|quota/i;

/**
 * @param announced tool calls already said to have started, by id, so the whole message that
 * repeats them later is not a second call. Kept by the caller for the turn.
 */
export function readStreamLine(
  line: string,
  spokeThisTurn: boolean,
  announced: Set<string> = new Set(),
): StreamRead {
  const message = parsedObject(line);
  if (message === null) return { chunks: [] };
  const sessionId = stringField(message, 'session_id');
  const withSession = (chunks: BrainChunk[]): StreamRead =>
    sessionId === undefined ? { chunks } : { chunks, sessionId };

  switch (message['type']) {
    case 'stream_event':
      return withSession([
        ...deltaOf(message['event']),
        ...toolStartOf(message['event'], announced),
      ]);
    case 'assistant':
      return withSession(toolsOf(message['message'], announced));
    case 'result':
      return withSession(resultOf(message, spokeThisTurn));
    default:
      return withSession([]);
  }
}

/** A piece of text as it is generated, so speech starts before the answer is finished. */
function deltaOf(event: unknown): BrainChunk[] {
  const record = asObject(event);
  if (record === null || record['type'] !== 'content_block_delta') return [];
  const delta = asObject(record['delta']);
  const text = delta === null ? undefined : stringField(delta, 'text');
  if (delta?.['type'] !== 'text_delta' || text === undefined) return [];
  return [{ kind: BRAIN_CHUNK.TEXT, text }];
}

/**
 * A tool call as soon as it starts, before its arguments are written: a summary card's
 * arguments take a second to write, and the words said before it wait on knowing it began.
 */
function toolStartOf(event: unknown, announced: Set<string>): BrainChunk[] {
  const record = asObject(event);
  if (record === null || record['type'] !== 'content_block_start') return [];
  const block = asObject(record['content_block']);
  const tool = block === null ? undefined : stringField(block, 'name');
  const id = block === null ? undefined : stringField(block, 'id');
  if (block?.['type'] !== 'tool_use' || tool === undefined || id === undefined) return [];
  announced.add(id);
  return [{ kind: BRAIN_CHUNK.TOOL, tool }];
}

/** The tools a whole message called that did not stream their start; its text already arrived as deltas. */
function toolsOf(message: unknown, announced: Set<string>): BrainChunk[] {
  const content = asObject(message)?.['content'];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    const record = asObject(block);
    const tool = record === null ? undefined : stringField(record, 'name');
    const id = record === null ? undefined : stringField(record, 'id');
    if (id !== undefined && announced.has(id)) return [];
    return record?.['type'] === 'tool_use' && tool !== undefined
      ? [{ kind: BRAIN_CHUNK.TOOL, tool }]
      : [];
  });
}

function resultOf(message: Record<string, unknown>, spoke: boolean): BrainChunk[] {
  const text = stringField(message, 'result') ?? '';
  if (message['is_error'] === true) {
    const kind = LIMIT_WORDING.test(text) ? BRAIN_CHUNK.LIMITED : BRAIN_CHUNK.FAILED;
    return [{ kind, text: text === '' ? 'the brain stopped without saying why' : text }];
  }
  // A Claude Code too old to stream partial text still gives the whole answer here.
  const unsaid = !spoke && text !== '' ? [{ kind: BRAIN_CHUNK.TEXT, text }] : [];
  return [...unsaid, { kind: BRAIN_CHUNK.DONE }];
}

function parsedObject(line: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(line));
  } catch {
    // A line that is not JSON, such as a warning on stdout, is not a message.
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  // Only ever indexed through stringField and equality checks, each of which narrows again.
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === 'string' ? value : undefined;
}

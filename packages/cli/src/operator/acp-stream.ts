import { BRAIN_CHUNK, type BrainChunk } from './brain';
import { isRecord } from './acp-connection';

/** One session update in the voice's terms: words to say, a tool being read, or nothing. */
export function readSessionUpdate(
  params: unknown,
  sessionId: string,
  announced: Set<string>,
): BrainChunk[] {
  if (!isRecord(params) || params['sessionId'] !== sessionId) return [];
  const update = params['update'];
  if (!isRecord(update)) return [];
  const kind = update['sessionUpdate'];
  if (kind === 'agent_message_chunk') {
    const content = update['content'];
    if (!isRecord(content) || content['type'] !== 'text') return [];
    const text = content['text'];
    return typeof text === 'string' && text !== ''
      ? [{ kind: BRAIN_CHUNK.TEXT, text }]
      : [];
  }
  if (kind === 'tool_call') {
    const tool = toolName(update);
    // Once per tool a turn, since the orb shows thinking and not every retry of it.
    if (announced.has(tool)) return [];
    announced.add(tool);
    return [{ kind: BRAIN_CHUNK.TOOL, tool }];
  }
  return [];
}

/** How a prompt ended, as the voice says it. */
export function readStopReason(result: unknown, label: string): BrainChunk {
  const reason = isRecord(result) ? result['stopReason'] : undefined;
  if (reason === 'cancelled') return { kind: BRAIN_CHUNK.CANCELLED };
  if (reason === 'refusal') {
    return { kind: BRAIN_CHUNK.FAILED, text: `${label} refused to answer that` };
  }
  return { kind: BRAIN_CHUNK.DONE };
}

/**
 * Every permission an agent asks for is refused, because the voice reads and proposes and
 * anything that acts goes through the operator tools, which Memnox gates itself.
 */
export function refusePermission(params: unknown): unknown {
  const options = isRecord(params) ? params['options'] : undefined;
  const reject = Array.isArray(options)
    ? options.find(
        (option): option is Record<string, unknown> =>
          isRecord(option) &&
          (option['kind'] === 'reject_once' || option['kind'] === 'reject_always'),
      )
    : undefined;
  const optionId = reject?.['optionId'];
  return typeof optionId === 'string'
    ? { outcome: { outcome: 'selected', optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

/** The mode that stops it acting, the first of the wanted ones it offers, or null. */
export function readOnlyMode(session: unknown, wanted: readonly string[]): string | null {
  const modes = isRecord(session) ? session['modes'] : undefined;
  const available = isRecord(modes) ? modes['availableModes'] : undefined;
  if (!Array.isArray(available)) return null;
  const ids = new Set(
    available.flatMap((mode) =>
      isRecord(mode) && typeof mode['id'] === 'string' ? [mode['id']] : [],
    ),
  );
  return wanted.find((mode) => ids.has(mode)) ?? null;
}

function toolName(update: Record<string, unknown>): string {
  const title = update['title'];
  if (typeof title === 'string' && title !== '') return title;
  const id = update['toolCallId'];
  return typeof id === 'string' ? id : 'a tool';
}

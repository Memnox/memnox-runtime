import { BRAIN_CHUNK, type Brain } from './brain';
import type { VoiceBrainSpec } from './voice-brains';

/**
 * Whether an agent can be the voice. Being installed proves nothing: a spent plan or a
 * retired model still finishes its turn normally, with the error as the answer, so an agent
 * counts only once it has called a Memnox tool and said the words it was asked to.
 */

export interface BrainCheck {
  spec: VoiceBrainSpec;
  works: boolean;
  /** Why it does not, in words a person can act on. */
  because?: string;
  /** Its own account's words when it answered something else, whole enough to read on a card. */
  reply?: string;
}

const CHECK_PHRASE = 'memnox ready';
const CHECK_QUESTION = `This is a setup check, not the person speaking. Call the sessions tool once, then reply with exactly the two words ${CHECK_PHRASE} and nothing else.`;
/** Long enough for a cold start and one tool call on a slow plan. */
const CHECK_TIMEOUT_MS = 90_000;
/** Enough of a wrong answer to recognise it, such as a plan asking to be upgraded. */
const SHOWN_CHARS = 120;
/** The reply kept for the card, long enough that a model error is not cut before it names the fix. */
const REPLY_CHARS = 400;

/** What a check heard: the words, whether a Memnox tool was read, and what went wrong. */
interface Heard {
  said: string;
  toolCalled: boolean;
  failure?: string;
  late: boolean;
}

/** Asks one question with a known answer, and always lets the brain go after. */
export async function checkBrain(
  spec: VoiceBrainSpec,
  brain: Brain,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<BrainCheck> {
  const heard = await listen(brain, timeoutMs);
  if (heard.late) {
    return {
      spec,
      works: false,
      because: `no answer within ${timeoutMs / 1_000} seconds`,
    };
  }
  if (heard.failure !== undefined) return { spec, works: false, because: heard.failure };
  if (!heard.said.toLowerCase().includes(CHECK_PHRASE)) {
    const reply = heard.said.trim().replace(/\s+/g, ' ');
    const answer = reply.slice(0, SHOWN_CHARS);
    return {
      spec,
      works: false,
      ...(reply === '' ? {} : { reply: reply.slice(0, REPLY_CHARS) }),
      // Its own account's reply, such as a spent plan, named as its own so nobody takes it for a Memnox limit.
      because:
        answer === ''
          ? 'it said nothing'
          : `its own account replied "${answer}", so it cannot be the voice yet`,
    };
  }
  if (!heard.toolCalled) {
    return { spec, works: false, because: 'it answered without the Memnox tools' };
  }
  return { spec, works: true };
}

async function listen(brain: Brain, timeoutMs: number): Promise<Heard> {
  const heard: Heard = { said: '', toolCalled: false, late: false };
  // Ended rather than asked to stop, since a brain still starting has nothing to cancel yet.
  const timer = setTimeout(() => {
    heard.late = true;
    brain.cancel();
    brain.close();
  }, timeoutMs);
  try {
    for await (const chunk of brain.ask(CHECK_QUESTION)) {
      if (chunk.kind === BRAIN_CHUNK.TEXT) heard.said += chunk.text ?? '';
      else if (chunk.kind === BRAIN_CHUNK.TOOL)
        heard.toolCalled ||= mentionsSessions(chunk.tool);
      else if (chunk.kind !== BRAIN_CHUNK.DONE)
        heard.failure = chunk.text ?? 'it stopped';
    }
  } finally {
    clearTimeout(timer);
    brain.close();
  }
  return heard;
}

function mentionsSessions(tool: string | undefined): boolean {
  return tool !== undefined && tool.toLowerCase().includes('sessions');
}

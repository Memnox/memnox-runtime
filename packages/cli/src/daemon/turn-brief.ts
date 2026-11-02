import { hermesLastAnswer, isHermesSession } from './hermes-view';
import { readLastAnswer, sessionTranscript } from './transcript';

/**
 * What a finished session did, in the agent's own closing words cut to a sentence or two, so the notch says
 * "Fixed the follow up into VS Code terminals" rather than how many minutes it ran.
 */

/** About two lines on the notch card, and one breath said aloud. */
const MOST_BRIEF_CHARS = 160;
/** Short enough that a reply of one line is taken whole rather than cut at its first full stop. */
const LEAST_SENTENCE_CHARS = 40;

/** The agent's closing words as plain text and no longer than a brief, or undefined when it said nothing. */
export function briefOf(answer: string | null): string | undefined {
  if (answer === null) return undefined;
  const plain = answer
    // A code block is detail, never the gist.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain === '') return undefined;
  return clippedToSentences(plain);
}

/** Whole sentences while they fit, and else the first cut at a word with an ellipsis. */
function clippedToSentences(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  let kept = '';
  for (const sentence of sentences) {
    const next = `${kept}${sentence}`.trim();
    if (next.length > MOST_BRIEF_CHARS) break;
    kept = `${next} `;
    if (kept.length >= LEAST_SENTENCE_CHARS) break;
  }
  if (kept.trim() !== '') return kept.trim();
  const cut = text.slice(0, MOST_BRIEF_CHARS);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)) || cut;
  return `${atWord.trimEnd()}…`;
}

/** The brief for a session that just finished, read from its own transcript; empty where none can be read. */
export async function briefFor(
  home: string,
  sessionId: string,
): Promise<{ brief?: string }> {
  const answer = await lastAnswerOf(home, sessionId).catch(() => null);
  const brief = briefOf(answer);
  return brief === undefined ? {} : { brief };
}

/** Read the way the session view reads it, without it, since the waiting feed sits underneath that view. */
async function lastAnswerOf(home: string, sessionId: string): Promise<string | null> {
  if (isHermesSession(sessionId)) return hermesLastAnswer(home, sessionId);
  const path = await sessionTranscript(home, sessionId, home);
  return path === null ? null : readLastAnswer(path);
}

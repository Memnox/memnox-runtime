import { statSync } from 'node:fs';
import { SPEAKER, type ConversationLine } from '@memnox/core';
import { readLinesFromEnd, sessionTranscript } from './transcript';

/** Enough of the end to reach back past a long run of tool calls to the person's last words. */
const SPOKEN_TO_TAIL_BYTES = 512 * 1_024;

/** Each transcript's last words from the person as of its last change, so polling reads nothing new. */
const spokenToSeen = new Map<string, { changedAt: number; at: string | null }>();

/**
 * When the person last wrote to a session, from its transcript, else `prompted`, the prompt hook's word, where
 * none is read. The hook alone also fires for a helper's report, and the ledger dates what the agent did.
 * A transcript holding none of their words means they never wrote to it.
 */
export async function sessionSpokenToAt(
  home: string,
  sessionId: string,
  prompted: string | undefined,
  transcripts: string = home,
): Promise<string | undefined> {
  const path = await sessionTranscript(home, sessionId, transcripts).catch(() => null);
  if (path === null) return prompted;
  const changedAt = modifiedAt(path);
  const known = spokenToSeen.get(path);
  if (known !== undefined && known.changedAt === changedAt) return known.at ?? undefined;
  const at = latestPersonAt(readLinesFromEnd(path, SPOKEN_TO_TAIL_BYTES));
  spokenToSeen.set(path, { changedAt, at });
  return at ?? undefined;
}

/** When the newest line the person said was written, or null when none is in these lines. */
export function latestPersonAt(lines: readonly ConversationLine[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line?.who === SPEAKER.PERSON && line.at !== '') return line.at;
  }
  return null;
}

function modifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

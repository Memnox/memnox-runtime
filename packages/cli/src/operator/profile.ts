import { join } from 'node:path';
import { MEMNOX_HOME, readJsonFile, writeJsonFile } from '@memnox/core';

/**
 * What the person told the voice about themselves: what they work on, which projects matter,
 * the tools they use and how they want to be spoken to. It lives in their own home and never
 * goes to the workspace, and every word of it is something they said, never something guessed.
 */

const PROFILE_FILE = join('voice', 'profile.json');

/** What a fact is about, so the voice can say what it knows in order and ask only what it does not. */
export const PROFILE_TOPIC = {
  WORK: 'work',
  PROJECTS: 'projects',
  TOOLS: 'tools',
  STYLE: 'style',
  OTHER: 'other',
} as const;

export type ProfileTopic = (typeof PROFILE_TOPIC)[keyof typeof PROFILE_TOPIC];

const TOPICS: readonly string[] = Object.values(PROFILE_TOPIC);

export interface ProfileFact {
  topic: ProfileTopic;
  fact: string;
  /** When they said it, so the newest of two that disagree is the one that holds. */
  at: string;
}

interface Profile {
  facts: ProfileFact[];
  /** When the voice first offered to learn about them, so it offers once and never again. */
  offeredAt?: string;
}

/** Enough to know somebody's work, never a diary. */
const MOST_FACTS = 30;
/** A sentence, said in one breath; anything longer is a document, not a fact about them. */
const MOST_FACT_CHARS = 200;

export async function readProfile(home: string): Promise<Profile> {
  const kept = await readJsonFile<Profile>(join(home, MEMNOX_HOME, PROFILE_FILE));
  const facts = Array.isArray(kept?.facts) ? kept.facts.filter(isFact) : [];
  return {
    facts,
    ...(typeof kept?.offeredAt === 'string' ? { offeredAt: kept.offeredAt } : {}),
  };
}

function isFact(value: unknown): value is ProfileFact {
  if (typeof value !== 'object' || value === null) return false;
  // An object checked just above, read field by field before anything trusts it.
  const fact = value as Record<string, unknown>;
  return (
    typeof fact['topic'] === 'string' &&
    TOPICS.includes(fact['topic']) &&
    typeof fact['fact'] === 'string' &&
    typeof fact['at'] === 'string'
  );
}

/** The topic as given, or other for anything the voice named some other way. */
export function topicOf(said: string | undefined): ProfileTopic {
  const wanted = (said ?? '').toLowerCase();
  return (
    (Object.values(PROFILE_TOPIC) as ProfileTopic[]).find((each) => each === wanted) ??
    PROFILE_TOPIC.OTHER
  );
}

/** One fact kept as plain words on one line, or null when nothing is left of it. */
export async function keepFact(
  home: string,
  topic: ProfileTopic,
  said: string,
  at: string,
): Promise<ProfileFact | null> {
  const fact = said.replace(/\s+/g, ' ').trim().slice(0, MOST_FACT_CHARS);
  if (fact === '') return null;
  const profile = await readProfile(home);
  const others = profile.facts.filter(
    (each) => each.fact.toLowerCase() !== fact.toLowerCase(),
  );
  const kept: ProfileFact = { topic, fact, at };
  await writeProfile(home, { ...profile, facts: [...others, kept].slice(-MOST_FACTS) });
  return kept;
}

/** Every fact holding these words, gone; the facts taken away, so the voice can say which. */
export async function forgetFacts(home: string, words: string): Promise<ProfileFact[]> {
  const wanted = words.trim().toLowerCase();
  if (wanted === '') return [];
  const profile = await readProfile(home);
  const gone = profile.facts.filter((each) => each.fact.toLowerCase().includes(wanted));
  if (gone.length === 0) return [];
  await writeProfile(home, {
    ...profile,
    facts: profile.facts.filter((each) => !gone.includes(each)),
  });
  return gone;
}

/** Marked once the offer to learn about them has been made, whatever they answered. */
export async function noteOffered(home: string, at: string): Promise<void> {
  const profile = await readProfile(home);
  if (profile.offeredAt !== undefined) return;
  await writeProfile(home, { ...profile, offeredAt: at });
}

async function writeProfile(home: string, profile: Profile): Promise<void> {
  await writeJsonFile(join(home, MEMNOX_HOME, PROFILE_FILE), profile);
}

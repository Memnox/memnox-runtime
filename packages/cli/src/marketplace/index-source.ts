import { join } from 'node:path';
import {
  communityIndexFrom,
  HTTP,
  MEMNOX_HOME,
  minutesToMs,
  readAccount,
  readJsonFile,
  writeJsonFile,
  type CommunityIndex,
} from '@memnox/core';
import { callCloud, CloudUnreachable, insecureBaseUrl } from '../sync/client';
import { defaultBaseUrl } from '../sync/cloud-url';

/**
 * Where the community index is read from and what it last said. The source is Memnox Cloud's
 * marketplace unless the person named another, such as a raw `index.json` in a git repository;
 * what was read is kept beside the Memnox home, so browsing works while the network does not.
 */

const CACHE_FILE = 'community-index.json';
const MARKETPLACE_INDEX = '/v1/marketplace/index.json';
/** The marketplace caches its shelf a minute; ten here keeps a screen from asking on every draw. */
const FRESH_MS = minutesToMs(10);

export type IndexSend = typeof callCloud;

interface KeptIndex {
  /** Named by the person; absent reads the marketplace. */
  source?: string;
  /** The source the kept index was read from, so a new source is read afresh. */
  readFrom?: string;
  fetchedAt?: string;
  index?: CommunityIndex;
}

/** The index as read, from where, and why it is not fresh where it is not. */
export interface ReadIndex {
  source: string;
  fetchedAt?: string;
  index?: CommunityIndex;
  said?: string;
}

function cachePathFor(home: string): string {
  return join(home, MEMNOX_HOME, CACHE_FILE);
}

async function readKept(home: string): Promise<KeptIndex> {
  return (await readJsonFile<KeptIndex>(cachePathFor(home))) ?? {};
}

/** The source named, or the marketplace of the workspace this machine is on, or Memnox Cloud's. */
async function sourceOf(home: string, kept: KeptIndex): Promise<string> {
  if (kept.source !== undefined) return kept.source;
  const account = await readAccount(home);
  const base = account === null ? defaultBaseUrl() : account.baseUrl;
  return new URL(MARKETPLACE_INDEX, base).toString();
}

/** Names the index to read from now on; refused where it is not a URL that keeps it out of the clear. */
export async function setIndexSource(
  home: string,
  source: string,
): Promise<{ ok: true } | { refused: string }> {
  const insecure = insecureBaseUrl(source);
  if (insecure !== null) return { refused: insecure };
  const kept = await readKept(home);
  await writeJsonFile(cachePathFor(home), { ...kept, source });
  return { ok: true };
}

/** The index, read again where it is stale, asked for, or from another source; else as kept. */
export async function readIndex(
  home: string,
  input: { refresh: boolean; now: Date; send?: IndexSend },
): Promise<ReadIndex> {
  const kept = await readKept(home);
  const source = await sourceOf(home, kept);
  const fresh =
    kept.readFrom === source &&
    kept.fetchedAt !== undefined &&
    input.now.getTime() - Date.parse(kept.fetchedAt) < FRESH_MS;
  if (fresh && !input.refresh) return keptAs(source, kept);
  const fetched = await fetchJson(source, input.send ?? callCloud);
  const index = 'value' in fetched ? communityIndexFrom(fetched.value) : null;
  if (index === null) {
    const why =
      'said' in fetched ? fetched.said : `${source} did not answer with an index.`;
    return { ...keptAs(source, kept), said: staleSaid(why, kept) };
  }
  const fetchedAt = input.now.toISOString();
  await writeJsonFile(cachePathFor(home), {
    ...kept,
    readFrom: source,
    fetchedAt,
    index,
  });
  return { source, fetchedAt, index };
}

function keptAs(source: string, kept: KeptIndex): ReadIndex {
  if (kept.readFrom !== source || kept.index === undefined) return { source };
  return {
    source,
    index: kept.index,
    ...(kept.fetchedAt === undefined ? {} : { fetchedAt: kept.fetchedAt }),
  };
}

function staleSaid(why: string, kept: KeptIndex): string {
  return kept.fetchedAt === undefined
    ? `${why} Nothing was read from it before, so there is nothing to show.`
    : `${why} This is what it said at ${kept.fetchedAt}.`;
}

/**
 * One document at an absolute URL, with no credential: an index is public, and the machine's
 * token is never handed to a host that is not its workspace.
 */
export async function fetchJson(
  url: string,
  send: IndexSend = callCloud,
): Promise<{ value: unknown } | { said: string }> {
  try {
    const answer = await send<unknown>({ baseUrl: url, path: url });
    if (answer.status >= HTTP.BAD_REQUEST || answer.body === undefined)
      return { said: `${url} answered ${answer.status}.` };
    return { value: answer.body };
  } catch (err) {
    if (err instanceof CloudUnreachable) return { said: `${url} could not be reached.` };
    throw err;
  }
}

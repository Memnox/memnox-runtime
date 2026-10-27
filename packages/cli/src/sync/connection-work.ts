import {
  HTTP,
  MOST_TOOLKITS_FOUND,
  secondsToMs,
  type ToolConnection,
  type ToolkitSummary,
} from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';
import {
  CONNECTIONS_NOT_SIGNED_IN,
  connectionsOf,
  existingCaller,
  personalCaller,
  refusal,
  signInLink,
  signOutOf,
  type PersonalAnswer,
} from './personal-work';

/**
 * Connecting and disconnecting the person's own tools from a screen, in words for the person rather than
 * for the voice: every person on every plan connects any tool the cloud's catalogue holds, as themselves.
 */

/** A person waits on a picker for this, so it is a read's patience rather than a send's. */
const SEARCH_TIMEOUT_MS = secondsToMs(8);

/** A toolkit slug as the cloud spells them, so anything else is refused before it reaches a path. */
const TOOLKIT_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

const NAME_A_TOOL = 'Name the tool to connect, such as notion or asana.';
const NOT_REACHABLE = 'Memnox Cloud could not be reached just now.';

/** The slug lowered and trimmed, or null when it is no slug at all. */
export function toolkitSlug(value: string | undefined): string | null {
  const slug = (value ?? '').trim().toLowerCase();
  return TOOLKIT_SLUG.test(slug) ? slug : null;
}

/** The page that connects one tool, or a sentence saying plainly why it cannot be had. */
export async function connectLink(
  home: string,
  toolkit: string,
  link: typeof signInLink = signInLink,
): Promise<PersonalAnswer<string>> {
  const slug = toolkitSlug(toolkit);
  if (slug === null) return { ok: false, said: NAME_A_TOOL };
  // The first connect registers this Mac's personal space, so nobody needs a Memnox account for it.
  if ((await personalCaller(home)) === null)
    return { ok: false, said: CONNECTIONS_NOT_SIGNED_IN };
  const answer = await link(home, slug);
  return answer.ok
    ? answer
    : couldNot(answer, `${toolkitTitle(slug)} could not be connected.`);
}

/** Every sign in to one tool undone, answering the list as it now stands. */
export async function disconnect(
  home: string,
  toolkit: string,
  seams: { signOut?: typeof signOutOf; list?: typeof connectionsOf } = {},
): Promise<PersonalAnswer<ToolConnection[]>> {
  const slug = toolkitSlug(toolkit);
  if (slug === null) return { ok: false, said: 'Name the tool to disconnect.' };
  if ((await existingCaller(home)) === null)
    return { ok: false, said: 'Nothing is connected on this Mac yet.' };
  const undone = await (seams.signOut ?? signOutOf)(home, slug);
  if (!undone.ok)
    return couldNot(undone, `${toolkitTitle(slug)} could not be disconnected.`);
  return (seams.list ?? connectionsOf)(home);
}

/** Whether this tool already has a sign in that works, false whenever the list cannot be read. */
export async function connectedAlready(
  home: string,
  toolkit: string,
  list: typeof connectionsOf = connectionsOf,
): Promise<boolean> {
  const listed = await list(home).catch(() => null);
  if (listed === null || !listed.ok) return false;
  return listed.value.some((each) => each.toolkit === toolkit && each.connected);
}

/** One catalogue entry as the cloud answers it; only the fields a picker shows are read. */
interface CatalogueToolkit {
  slug?: unknown;
  name?: unknown;
  logo?: unknown;
}

/** Tools from the cloud's whole catalogue matching the words, read with the person's own token. */
export async function searchToolkits(
  home: string,
  query?: string,
): Promise<PersonalAnswer<ToolkitSummary[]>> {
  const person = await personalCaller(home);
  if (person === null) return { ok: false, said: CONNECTIONS_NOT_SIGNED_IN };
  const words = query?.trim() ?? '';
  const search = words === '' ? '' : `&search=${encodeURIComponent(words)}`;
  try {
    const answer = await callCloud<{ items?: CatalogueToolkit[] }>({
      baseUrl: person.baseUrl,
      path: `/v1/toolkits?limit=${MOST_TOOLKITS_FOUND}${search}`,
      token: person.token,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (answer.status !== HTTP.OK) return refusal(answer);
    return { ok: true, value: toolkitsFrom(answer.body?.items) };
  } catch (err) {
    if (err instanceof CloudUnreachable) return { ok: false, said: NOT_REACHABLE };
    throw err;
  }
}

/** The catalogue's entries a sign in can take, at most MOST_TOOLKITS_FOUND of them. */
export function toolkitsFrom(items: unknown): ToolkitSummary[] {
  if (!Array.isArray(items)) return [];
  const listed: unknown[] = items;
  const found: ToolkitSummary[] = [];
  for (const item of listed) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as CatalogueToolkit; // narrowed to an object just above
    const slug = toolkitSlug(typeof entry.slug === 'string' ? entry.slug : undefined);
    if (slug === null) continue;
    const name =
      typeof entry.name === 'string' && entry.name !== ''
        ? entry.name
        : toolkitTitle(slug);
    const logo = typeof entry.logo === 'string' && entry.logo !== '' ? entry.logo : null;
    found.push({ slug, name, ...(logo === null ? {} : { logo }) });
  }
  return found.slice(0, MOST_TOOLKITS_FOUND);
}

/** The cloud's own reason after a plain sentence; a failure with no status never reached the cloud at all. */
function couldNot<T>(
  failed: { said: string; status?: number },
  sentence: string,
): PersonalAnswer<T> {
  if (failed.status === undefined)
    return { ok: false, said: `${sentence} ${NOT_REACHABLE}` };
  return { ok: false, said: `${sentence} ${failed.said}`, status: failed.status };
}

/** How a tool is named in a sentence when only its slug is known. */
export function toolkitTitle(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

import {
  DAEMON_METHOD,
  type DaemonRequest,
  type DaemonResponse,
  type ToolConnection,
} from '@memnox/core';
import { localConnections } from '../local-tools/local-tools';
import { openBrowser, OPEN_BROWSER_VAR } from '../sync/browser';
import {
  connectedAlready,
  connectLink,
  disconnect,
  searchToolkits,
  toolkitSlug,
  toolkitTitle,
} from '../sync/connection-work';
import { connectionsOf } from '../sync/personal-work';

/**
 * The person's own tools from the Mac, Windows, Linux or a paired phone: which are connected, connecting
 * any tool as themselves with nobody else asked, disconnecting one, and finding one in the catalogue.
 */

/** Said when the list failed in a way nobody planned for, since the menu bar only ever shows words. */
const COULD_NOT_LIST = 'Your connected apps could not be listed just now.';
const COULD_NOT_CONNECT = 'That tool could not be connected just now.';
const COULD_NOT_DISCONNECT = 'That tool could not be disconnected just now.';
const COULD_NOT_SEARCH = 'The tools you can connect could not be found just now.';

const CONNECTION_METHODS: readonly string[] = [
  DAEMON_METHOD.CONNECTIONS_LIST,
  DAEMON_METHOD.CONNECTIONS_SIGN_IN,
  DAEMON_METHOD.CONNECTIONS_SIGN_OUT,
  DAEMON_METHOD.TOOLKITS_SEARCH,
];

export function isConnectionsMethod(method: string): boolean {
  return CONNECTION_METHODS.includes(method);
}

/** What the calls reach the cloud and the browser through, so a test drives them with neither. */
export interface ConnectionSeams {
  list: typeof connectionsOf;
  /** What this Mac reaches itself, listed beside the connections and never connected or disconnected here. */
  local: (home: string) => Promise<ToolConnection[]>;
  link: typeof connectLink;
  open: (url: string) => Promise<boolean>;
  signOut: typeof disconnect;
  search: typeof searchToolkits;
}

const LIVE: ConnectionSeams = {
  list: connectionsOf,
  local: localConnections,
  link: connectLink,
  // The person pressed connect at this Mac, so the page opens even with no terminal in front of them.
  open: (url) => openBrowser(url, { ...process.env, [OPEN_BROWSER_VAR]: '1' }),
  signOut: disconnect,
  search: searchToolkits,
};

/** Any of the four connection calls; `remote` is a paired phone, which opens the page itself. */
export async function answerConnectionCall(
  request: DaemonRequest,
  home: string,
  remote: boolean,
  seams: Partial<ConnectionSeams> = {},
): Promise<DaemonResponse> {
  const live = { ...LIVE, ...seams };
  if (request.method === DAEMON_METHOD.CONNECTIONS_SIGN_IN)
    return guarded(request, COULD_NOT_CONNECT, () => signIn(request, home, remote, live));
  if (request.method === DAEMON_METHOD.CONNECTIONS_SIGN_OUT)
    return guarded(request, COULD_NOT_DISCONNECT, () => signOut(request, home, live));
  if (request.method === DAEMON_METHOD.TOOLKITS_SEARCH)
    return guarded(request, COULD_NOT_SEARCH, () => search(request, home, live));
  return answerConnections(request, home, live.list, live.local);
}

/** The Mac's menu bar and notch asking which apps the person connected; a refusal is a sentence, never a throw. */
export async function answerConnections(
  request: DaemonRequest,
  home: string,
  list: typeof connectionsOf = connectionsOf,
  local: ConnectionSeams['local'] = async () => [],
): Promise<DaemonResponse> {
  try {
    const [answer, here] = await Promise.all([list(home), local(home).catch(() => [])]);
    if (answer.ok)
      return { id: request.id, ok: true, connections: [...here, ...answer.value] };
    // What this Mac reaches itself stands whatever the cloud said.
    return here.length > 0
      ? { id: request.id, ok: true, connections: here }
      : { id: request.id, ok: false, reason: answer.said };
  } catch {
    return { id: request.id, ok: false, reason: COULD_NOT_LIST };
  }
}

async function signIn(
  request: DaemonRequest,
  home: string,
  remote: boolean,
  seams: ConnectionSeams,
): Promise<DaemonResponse> {
  const toolkit = toolkitSlug(request.toolkit) ?? '';
  if (await isLocal(seams, home, toolkit))
    return refused(
      request,
      `${toolkitTitle(toolkit)} is already on this Mac, so there is nothing to connect.`,
    );
  // A second press on a tool that already works is a slip unless they asked for another account.
  if (request.again !== true && (await connectedAlready(home, toolkit, seams.list))) {
    return refused(
      request,
      `${toolkitTitle(toolkit)} is already connected. Connect it again only to use another account.`,
    );
  }
  const link = await seams.link(home, toolkit);
  if (!link.ok) return refused(request, link.said);
  const opened = remote ? false : await seams.open(link.value);
  return { id: request.id, ok: true, signIn: { toolkit, url: link.value, opened } };
}

async function signOut(
  request: DaemonRequest,
  home: string,
  seams: ConnectionSeams,
): Promise<DaemonResponse> {
  const toolkit = toolkitSlug(request.toolkit) ?? '';
  if (await isLocal(seams, home, toolkit)) {
    return refused(
      request,
      `${toolkitTitle(toolkit)} is on this Mac itself rather than connected, so it is removed from the agent or signed out of where it runs.`,
    );
  }
  const answer = await seams.signOut(home, request.toolkit ?? '', { list: seams.list });
  return answer.ok
    ? { id: request.id, ok: true, connections: answer.value }
    : refused(request, answer.said);
}

async function search(
  request: DaemonRequest,
  home: string,
  seams: ConnectionSeams,
): Promise<DaemonResponse> {
  const answer = await seams.search(home, request.query);
  return answer.ok
    ? { id: request.id, ok: true, toolkits: answer.value }
    : refused(request, answer.said);
}

async function isLocal(
  seams: ConnectionSeams,
  home: string,
  toolkit: string,
): Promise<boolean> {
  const here = await seams.local(home).catch(() => []);
  return here.some((each) => each.toolkit.toLowerCase() === toolkit);
}

/** A failure nobody planned for is still a sentence on the screen, never a dropped connection. */
async function guarded(
  request: DaemonRequest,
  sentence: string,
  call: () => Promise<DaemonResponse>,
): Promise<DaemonResponse> {
  try {
    return await call();
  } catch {
    return refused(request, sentence);
  }
}

function refused(request: DaemonRequest, error: string): DaemonResponse {
  return { id: request.id, ok: false, error };
}

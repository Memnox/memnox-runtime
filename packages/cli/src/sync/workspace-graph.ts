import {
  foldWorkspaceGraph,
  HTTP,
  isCredentialRefused,
  parseCloudGraph,
  readAccount,
  readWorkspaceMemory,
  secondsToMs,
  WORKSPACE_GRAPH_FALLBACK,
  type Account,
  type CloudGraph,
  type WorkspaceGraphFallback,
  type WorkspaceGraphView,
} from '@memnox/core';

import { callCloud, CloudUnreachable } from './client';

/**
 * The workspace's memory graph, read live off `GET :ws/graph` on this machine's own credential, the
 * route the console's memory page reads. Held in this process a few seconds and never on disk.
 */

/** Short, since the person is looking at the page while it is read. */
const GRAPH_TIMEOUT_MS = secondsToMs(5);

/** Long enough that opening the page twice reads the cloud once, short enough that it is still today's. */
const HELD_FOR_MS = secondsToMs(30);

interface Held {
  graph: CloudGraph;
  readAt: string;
  workspaceId: string;
  /** Epoch milliseconds it was read. */
  at: number;
}

/** One entry per home, since tests run several daemons in one process. */
const held = new Map<string, Held>();

export interface WorkspaceGraphDeps {
  /** Read the cloud again now, as a manual refresh asks. */
  fresh?: boolean;
  now?: () => Date;
  call?: typeof callCloud;
}

type LiveRead =
  { graph: CloudGraph; readAt: string } | { fallback: WorkspaceGraphFallback };

/** The picture: live where the cloud answered just now, the saved facts with the reason where it did not. */
export async function readWorkspaceGraph(
  home: string,
  deps: WorkspaceGraphDeps = {},
): Promise<WorkspaceGraphView> {
  const now = deps.now ?? (() => new Date());
  const [live, memory] = await Promise.all([
    liveGraph(home, deps, now),
    readWorkspaceMemory(home).catch(() => null),
  ]);
  if ('fallback' in live) {
    return foldWorkspaceGraph({ live: null, memory, fallback: live.fallback });
  }
  return foldWorkspaceGraph({ live: live.graph, memory, readAt: live.readAt });
}

/** Forgets what was held, for a machine let go or a test that starts again. */
export function forgetWorkspaceGraph(home: string): void {
  held.delete(home);
}

async function liveGraph(
  home: string,
  deps: WorkspaceGraphDeps,
  now: () => Date,
): Promise<LiveRead> {
  const account = await readAccount(home).catch(() => null);
  if (account === null || account.revokedAt !== undefined) {
    held.delete(home);
    return { fallback: WORKSPACE_GRAPH_FALLBACK.NOT_JOINED };
  }
  const at = now().getTime();
  const kept = held.get(home);
  if (
    deps.fresh !== true &&
    kept !== undefined &&
    kept.workspaceId === account.workspaceId &&
    at - kept.at < HELD_FOR_MS
  ) {
    return { graph: kept.graph, readAt: kept.readAt };
  }
  const read = await askCloud(account, deps.call ?? callCloud);
  if ('fallback' in read) return read;
  const readAt = new Date(at).toISOString();
  held.set(home, { graph: read.graph, readAt, workspaceId: account.workspaceId, at });
  return { graph: read.graph, readAt };
}

/** One GET, answered as the graph or as why there is none. */
async function askCloud(
  account: Account,
  call: typeof callCloud,
): Promise<{ graph: CloudGraph } | { fallback: WorkspaceGraphFallback }> {
  let answer;
  try {
    answer = await call<unknown>({
      baseUrl: account.baseUrl,
      path: `/v1/workspaces/${account.workspaceId}/graph`,
      token: account.token,
      timeoutMs: GRAPH_TIMEOUT_MS,
    });
  } catch (err) {
    // Unreachable or broken on the way, the saved facts stand; only a picture is lost, never a verdict.
    const unreachable = err instanceof CloudUnreachable;
    return {
      fallback: unreachable
        ? WORKSPACE_GRAPH_FALLBACK.UNREACHABLE
        : WORKSPACE_GRAPH_FALLBACK.REFUSED,
    };
  }
  if (isCredentialRefused(answer.status) || answer.status !== HTTP.OK) {
    return { fallback: WORKSPACE_GRAPH_FALLBACK.REFUSED };
  }
  const graph = parseCloudGraph(answer.body);
  return graph === null ? { fallback: WORKSPACE_GRAPH_FALLBACK.REFUSED } : { graph };
}

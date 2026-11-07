import {
  INDEX_KIND,
  INDEX_METHOD,
  matchingEntries,
  type DaemonRequest,
  type DaemonResponse,
  type IndexKind,
} from '@memnox/core';
import { indexView, installFromIndex } from '../marketplace/index-install';
import { readIndex, type IndexSend } from '../marketplace/index-source';
import { setSourceAnswer } from './index-source-answer';

/**
 * The community index methods. Installing checks every download against its digest and only holds
 * a skill or proposes a pack's rules, so nothing is granted here; a new source waits on the Mac's
 * signature, and where the index is read from is never decided from a phone.
 */

const INDEX_METHODS: readonly string[] = Object.values(INDEX_METHOD);
const KINDS: readonly string[] = Object.values(INDEX_KIND);

export function isIndexMethod(method: string): boolean {
  return INDEX_METHODS.includes(method);
}

interface IndexDeps {
  now: Date;
  /** A paired phone, which may browse and install but never point the machine at another index. */
  remote: boolean;
  send?: IndexSend;
  /** Where what went wrong on the side, such as a marketplace count, is said; the daemon's log by default. */
  log?: (message: string) => void;
}

function daemonLog(message: string): void {
  process.stderr.write(`memnox: ${message}\n`);
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function communityIndexAnswer(
  home: string,
  request: DaemonRequest,
  deps: IndexDeps,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, deps).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  return { id: request.id, ...answered };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: IndexDeps,
): Promise<Answered> {
  if (request.method === INDEX_METHOD.INDEX_INSTALL) return install(home, request, deps);
  let proposed: string | undefined;
  if (request.method === INDEX_METHOD.INDEX_SOURCE_SET) {
    if (deps.remote)
      return refused('Which index this machine reads is set at the machine.');
    const set = await setSourceAnswer(home, request.indexSource, deps.now);
    if ('refused' in set) return refused(set.refused);
    proposed = set.proposed;
  }
  const kind = kindOf(request.indexKind);
  const read = await readIndex(home, {
    refresh:
      request.indexRefresh === true || request.method === INDEX_METHOD.INDEX_SOURCE_SET,
    now: deps.now,
    ...(deps.send === undefined ? {} : { send: deps.send }),
  });
  return {
    ok: true,
    ...(proposed === undefined ? {} : { proposed }),
    communityIndex: await indexView(home, read, {
      matching: (entries) => matchingEntries(entries, request.indexQuery, kind),
    }),
  };
}

async function install(
  home: string,
  request: DaemonRequest,
  deps: IndexDeps,
): Promise<Answered> {
  const name = request.indexName;
  if (name === undefined || name.trim() === '') return refused('Name what to install.');
  const installed = await installFromIndex(home, {
    name: name.trim(),
    now: deps.now,
    log: deps.log ?? daemonLog,
    ...(request.indexVersion === undefined ? {} : { version: request.indexVersion }),
    ...(deps.send === undefined ? {} : { send: deps.send }),
  });
  if ('refused' in installed) return refused(installed.refused);
  const [first] = installed.proposed;
  return {
    ok: true,
    indexInstalled: installed,
    ...(first === undefined ? {} : { proposed: first }),
  };
}

function kindOf(value: string | undefined): IndexKind | undefined {
  // Cast is safe: checked against every kind just before.
  return value !== undefined && KINDS.includes(value) ? (value as IndexKind) : undefined;
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

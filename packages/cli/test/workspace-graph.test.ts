import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  WORKSPACE_GRAPH_FALLBACK,
  WORKSPACE_GRAPH_SOURCE,
  writeAccount,
  writeWorkspaceMemory,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { isMemoryMethod, memoryAnswer } from '../src/daemon/memory-answer';
import { isScreenMethod } from '../src/daemon/home-status';
import { CloudUnreachable } from '../src/sync/client';
import { forgetWorkspaceGraph } from '../src/sync/workspace-graph';

/**
 * The workspace graph on the daemon: read live off the cloud's graph route on the machine's own
 * credential, held a few seconds in this process and never on disk, and the saved facts with the
 * reason whenever the cloud cannot be asked.
 */

const NOW = new Date('2026-11-01T09:00:00.000Z');
const WORKSPACE = 'ws_acme';

const GRAPH = {
  nodes: [
    { ref: 'source:slack', kind: 'source', label: 'slack', degree: 1 },
    { ref: 'item:ev1', kind: 'item', label: 'Beta on Monday', repeats: 21, degree: 1 },
  ],
  edges: [{ fromRef: 'source:slack', toRef: 'item:ev1', kind: 'carries', origin: 'graph', evidenceIds: [] }],
  withheld: 2,
  truncated: false,
};

interface Asked {
  path: string;
  token?: string;
}

type Call = NonNullable<NonNullable<Parameters<typeof memoryAnswer>[2]['graph']>['call']>;

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) forgetWorkspaceGraph(home);
});

async function home(joined: boolean): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), 'memnox-graph-'));
  homes.push(at);
  if (joined) {
    await writeAccount(at, {
      version: 1,
      baseUrl: 'https://cloud.example',
      workspaceId: WORKSPACE,
      machineId: 'm1',
      // Assembled at runtime, so no credential is ever written into a test.
      token: ['machine', 'credential'].join('-'),
      privateKey: 'unused',
      enrolledAt: NOW.toISOString(),
    });
  }
  await writeWorkspaceMemory(at, {
    hash: 'h1',
    facts: [{ id: 'f1', kind: 'decision', statement: 'Payments retry three times.', subject: 'payments' }],
    withheld: 1,
    syncedAt: '2026-11-01T08:00:00.000Z',
  });
  return at;
}

function answering(status: number, body: unknown, asked: Asked[] = []): Call {
  return (async (request: Asked) => {
    asked.push(request);
    return { status, body };
  }) as unknown as Call;
}

async function ask(at: string, call: Call, fresh = false): Promise<DaemonResponse> {
  const request = {
    id: 1,
    method: DAEMON_METHOD.WORKSPACE_GRAPH,
    ...(fresh ? { workspaceGraphFresh: true } : {}),
  } as DaemonRequest;
  return memoryAnswer(at, request, { now: NOW, graph: { call } });
}

describe('the workspace graph on the daemon', () => {
  it('is a memory read a screen makes and a phone may see', () => {
    expect(isMemoryMethod(DAEMON_METHOD.WORKSPACE_GRAPH)).toBe(true);
    expect(isScreenMethod(DAEMON_METHOD.WORKSPACE_GRAPH)).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.WORKSPACE_GRAPH)).toBe(REMOTE_CAPABILITY.SEE);
  });

  it('reads the console graph on the machine credential and folds the saved facts in', async () => {
    const at = await home(true);
    const asked: Asked[] = [];

    const answer = await ask(at, answering(200, GRAPH, asked));

    expect(asked[0]?.path).toBe(`/v1/workspaces/${WORKSPACE}/graph`);
    expect(asked[0]?.token).toBe(['machine', 'credential'].join('-'));
    expect(answer.workspaceGraph?.source).toBe(WORKSPACE_GRAPH_SOURCE.LIVE);
    expect(answer.workspaceGraph?.readAt).toBe(NOW.toISOString());
    const ids = answer.workspaceGraph?.nodes.map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining(['source:slack', 'item:ev1', 'fact:f1']));
    expect(answer.workspaceGraph?.withheld).toBe(2);
  });

  it('holds the read for a moment, and reads again when asked fresh', async () => {
    const at = await home(true);
    const asked: Asked[] = [];
    const call = answering(200, GRAPH, asked);

    await ask(at, call);
    await ask(at, call);
    expect(asked).toHaveLength(1);
    await ask(at, call, true);
    expect(asked).toHaveLength(2);
  });

  it('answers the saved facts and says it was not joined', async () => {
    const at = await home(false);
    const asked: Asked[] = [];

    const answer = await ask(at, answering(200, GRAPH, asked));

    expect(asked).toHaveLength(0);
    expect(answer.ok).toBe(true);
    expect(answer.workspaceGraph?.source).toBe(WORKSPACE_GRAPH_SOURCE.SAVED);
    expect(answer.workspaceGraph?.fallback).toBe(WORKSPACE_GRAPH_FALLBACK.NOT_JOINED);
    expect(answer.workspaceGraph?.nodes.map((node) => node.id)).toEqual(['fact:f1']);
  });

  it('answers the saved facts when the cloud refuses or cannot be reached', async () => {
    const refused = await ask(await home(true), answering(403, { message: 'no' }));
    expect(refused.workspaceGraph?.fallback).toBe(WORKSPACE_GRAPH_FALLBACK.REFUSED);

    const away = (async () => {
      throw new CloudUnreachable('down');
    }) as unknown as Call;
    const unreachable = await ask(await home(true), away);
    expect(unreachable.workspaceGraph?.fallback).toBe(WORKSPACE_GRAPH_FALLBACK.UNREACHABLE);
    expect(unreachable.workspaceGraph?.syncedAt).toBe('2026-11-01T08:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  FAST_INTERCEPT_VERSION,
  INTERCEPT_METHOD,
  INTERCEPT_PLAN,
  type DaemonRequest,
  type DaemonResponse,
  type EventSink,
  type MemnoxEvent,
} from '@memnox/core';
import type { FastPlan, InterceptOutcome } from '@memnox/interceptors';

import { InterceptSurface, sceneOf } from '../src/daemon/intercept-surface';

const OUTCOME: InterceptOutcome = {
  allowed: true,
  binary: 'ls',
  args: ['-la'],
  action: 'shell.execute',
  class: 'normal',
  argsDigest: 'digest',
};

const RUN: FastPlan = {
  kind: INTERCEPT_PLAN.RUN,
  real: '/usr/bin/ls',
  path: '/usr/bin',
  notes: ['[memnox] a warning'],
  pending: {
    row: {
      outcome: OUTCOME,
      effect: DECISION_EFFECT.ALLOW,
      reason: 'no rule matched',
      at: '2026-10-08T10:00:00.000Z',
      sessionId: 'ses_fast',
    },
    started: Date.now(),
    outOfScope: false,
  },
};

const REFUSE: FastPlan = {
  kind: INTERCEPT_PLAN.REFUSE,
  notes: ['Denied by Memnox: no'],
  exitCode: 1,
  row: {
    outcome: { ...OUTCOME, allowed: false },
    effect: DECISION_EFFECT.DENY,
    reason: 'no',
    at: '2026-10-08T10:00:00.000Z',
  },
};

const ASKED: DaemonRequest = {
  id: 1,
  method: INTERCEPT_METHOD.INTERCEPT,
  fast: FAST_INTERCEPT_VERSION,
  argv: ['ls', '-la'],
  env: { HOME: '/home' },
  cwd: '/home',
  ppid: 1,
};

function harness(plan: () => Promise<FastPlan>) {
  const rows: MemnoxEvent[] = [];
  const reported: DaemonRequest[] = [];
  const replies: DaemonResponse[] = [];
  const sink: EventSink = {
    append: async (event) => {
      rows.push(event);
    },
    query: async () => [],
  };
  const surface = new InterceptSurface({
    home: '/home',
    report: (request) => reported.push(request),
    plan,
    sink: () => sink,
    observe: async () => null,
    log: () => undefined,
  });
  const connection = {};
  const send = (request: DaemonRequest): Promise<void> =>
    surface.respond(connection, request, (response) => replies.push(response));
  return { surface, connection, send, rows, reported, replies };
}

describe('the daemon side of the native wrapper', () => {
  it('answers a run, then writes one row with the exit code once the command ends', async () => {
    const h = harness(async () => RUN);
    await h.send(ASKED);
    expect(h.replies[0]).toMatchObject({
      ok: true,
      fast: FAST_INTERCEPT_VERSION,
      plan: INTERCEPT_PLAN.RUN,
      real: '/usr/bin/ls',
      path: '/usr/bin',
      notes: ['[memnox] a warning'],
    });
    await h.send({ id: 2, method: INTERCEPT_METHOD.INTERCEPT_ACTED });
    // Acting is answered by no line, so the client never waits on it.
    expect(h.replies).toHaveLength(1);
    await h.send({ id: 3, method: INTERCEPT_METHOD.INTERCEPT_RAN, exitCode: 2 });
    expect(h.replies[1]).toEqual({ id: 3, ok: true, notes: [] });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ exitCode: 2, effect: DECISION_EFFECT.ALLOW });
    expect(h.reported[0]).toMatchObject({
      method: 'record',
      exitCode: 2,
      sessionId: 'ses_fast',
    });
    await h.surface.drop(h.connection);
    expect(h.rows).toHaveLength(1);
  });

  it('writes nothing for a client that gave up before acting, since Node records it instead', async () => {
    const h = harness(async () => RUN);
    await h.send(ASKED);
    await h.surface.drop(h.connection);
    expect(h.rows).toHaveLength(0);
  });

  it('keeps the row of a command whose wrapper hung up after acting, without an exit code', async () => {
    const h = harness(async () => RUN);
    await h.send(ASKED);
    await h.send({ id: 2, method: INTERCEPT_METHOD.INTERCEPT_ACTED });
    await h.surface.drop(h.connection);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.exitCode).toBeUndefined();
    expect(h.reported).toHaveLength(0);
  });

  it('records a refusal only once the client printed it', async () => {
    const h = harness(async () => REFUSE);
    await h.send(ASKED);
    expect(h.replies[0]).toMatchObject({ plan: INTERCEPT_PLAN.REFUSE, exitCode: 1 });
    expect(h.rows).toHaveLength(0);
    await h.send({ id: 2, method: INTERCEPT_METHOD.INTERCEPT_ACTED });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.effect).toBe(DECISION_EFFECT.DENY);
  });

  it('answers node for another version, a malformed line or a plan that threw', async () => {
    const thrown = harness(async () => {
      throw new Error('a policy file would not parse');
    });
    await thrown.send(ASKED);
    expect(thrown.replies[0]?.plan).toBe(INTERCEPT_PLAN.NODE);

    const h = harness(async () => RUN);
    await h.send({ ...ASKED, fast: FAST_INTERCEPT_VERSION + 1 });
    expect(h.replies[0]?.plan).toBe(INTERCEPT_PLAN.NODE);
    expect(sceneOf({ ...ASKED, env: { HOME: 1 } as never })).toBeNull();
    expect(sceneOf({ ...ASKED, argv: [] })).toBeNull();
    expect(sceneOf(ASKED)).not.toBeNull();
  });
});

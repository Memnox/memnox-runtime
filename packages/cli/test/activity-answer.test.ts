import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_KIND,
  ANSWERED_HOW,
  DAEMON_METHOD,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SqliteEventStore,
  verifyBundle,
  type ActivityFilter,
  type Bundle,
  type DaemonRequest,
  type DaemonResponse,
  type MemnoxEvent,
} from '@memnox/core';
import { activityAnswer, isActivityMethod } from '../src/daemon/activity-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/**
 * The activity screen's daemon methods: the ledger paged newest first and bounded, filtered by
 * what the query cannot, one decision opened whole, and a period exported as a signed bundle.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

function row(id: string, at: string, fields: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id,
    schemaVersion: 1,
    at,
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'npm.test',
    class: 'read',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...fields,
  } as MemnoxEvent;
}

async function seeded(rows: MemnoxEvent[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-activity-'));
  const store = SqliteEventStore.forHome(home);
  for (const each of rows) await store.append(each);
  store.close();
  return home;
}

function ask(home: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  const full = { id: 1, method: DAEMON_METHOD.ACTIVITY, ...request } as DaemonRequest;
  return activityAnswer(home, full, NOW);
}

const MINUTE = 60_000;

function minutesIn(n: number): string {
  return new Date(Date.parse('2026-10-30T09:00:00.000Z') + n * MINUTE).toISOString();
}

describe('the activity methods', () => {
  it('are reads a phone may make', () => {
    expect(isActivityMethod('activity')).toBe(true);
    expect(isVoiceMethod('decision')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.ACTIVITY)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.ACTIVITY_EXPORT)).toBe(
      REMOTE_CAPABILITY.SEE,
    );
  });

  it('pages newest first, and the cursor carries on where the page ended', async () => {
    const home = await seeded(
      Array.from({ length: 5 }, (_, n) => row(`e${n}`, minutesIn(n))),
    );
    const first = await ask(home, { activityLimit: 2 });
    expect(first.activity?.rows.map((each) => each.id)).toEqual(['e4', 'e3']);
    const second = await ask(home, {
      activityLimit: 2,
      activityCursor: first.activity?.nextCursor ?? '',
    });
    expect(second.activity?.rows.map((each) => each.id)).toEqual(['e2', 'e1']);
    const last = await ask(home, {
      activityLimit: 2,
      activityCursor: second.activity?.nextCursor ?? '',
    });
    expect(last.activity?.rows.map((each) => each.id)).toEqual(['e0']);
    expect(last.activity?.nextCursor).toBeUndefined();
  });

  it('filters by effect, kind and text, and says who let a held call through', async () => {
    const home = await seeded([
      row('a', minutesIn(1)),
      row('b', minutesIn(2), {
        surface: 'mcp',
        operation: 'mcp.github.merge_pull_request',
        effect: 'ask',
        authorizedBy: 'person (inside the session)',
      }),
      row('c', minutesIn(3), {
        surface: 'filesystem',
        operation: 'write',
        target: 'a.ts',
      }),
    ]);
    const asked = await ask(home, { activityFilter: { effect: 'ask' } });
    expect(asked.activity?.rows).toHaveLength(1);
    expect(asked.activity?.rows[0]).toMatchObject({
      id: 'b',
      kind: ACTIVITY_KIND.MCP,
      answeredHow: ANSWERED_HOW.WITHIN_SESSION,
    });
    const files = await ask(home, { activityFilter: { kind: 'file' } });
    expect(files.activity?.rows.map((each) => each.id)).toEqual(['c']);
    const named = await ask(home, { activityFilter: { text: 'MERGE' } });
    expect(named.activity?.rows.map((each) => each.id)).toEqual(['b']);
    // A screen is untrusted JSON, so a fourth effect is sent the way a stale client would.
    const stale: unknown = { effect: 'redact' };
    const bad = await ask(home, { activityFilter: stale as ActivityFilter });
    expect(bad.ok).toBe(false);
  });

  it('opens one decision with its lead up and its trace, digests and never arguments', async () => {
    const home = await seeded([
      row('d1', minutesIn(1), { operation: 'git.status' }),
      row('d2', minutesIn(2), {
        operation: 'git.push',
        target: 'main',
        effect: 'deny',
        rule: { name: 'no-push-main', layer: 'user', file: '/x/rules.toml' },
        argsDigest: 'abc123',
        exitCode: 1,
      }),
    ]);
    const answer = await ask(home, { method: DAEMON_METHOD.DECISION, decisionId: 'd2' });
    expect(answer.decision).toMatchObject({
      row: { id: 'd2', rule: 'no-push-main', effect: 'deny' },
      rule: { name: 'no-push-main', file: '/x/rules.toml', source: 'file' },
      chain: 'claude-code',
      trace: { argsDigest: 'abc123', exitCode: 1 },
    });
    expect(answer.decision?.before.map((each) => each.operation)).toEqual(['git.status']);
    const missing = await ask(home, { method: DAEMON_METHOD.DECISION, decisionId: 'zz' });
    expect(missing.ok).toBe(false);
  });

  it('exports what a filter selects as a bundle that verifies', async () => {
    const home = await seeded([row('x1', minutesIn(1)), row('x2', minutesIn(2))]);
    const answer = await ask(home, { method: DAEMON_METHOD.ACTIVITY_EXPORT });
    const text = answer.activityBundle ?? '';
    const split = text.indexOf('\n\n');
    // Cast is safe: the header is the JSON the export wrote just above.
    const header = JSON.parse(text.slice(0, split)) as Bundle;
    const body = text.slice(split + 2).replace(/\n$/, '');
    expect(header.events).toBe(2);
    expect(verifyBundle(header, body).result).toBe('valid');
  });
});

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  EarnedAllowances,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  MEMNOX_HOME,
  PROMOTION_THRESHOLD,
  SqliteEventStore,
  TOOL_CLASS,
  type MemnoxEvent,
} from '@memnox/core';

import { autopilotOnce, describeAutopilot } from '../src/keeper/keep-autopilot';

const NOW = new Date('2026-09-05T10:00:00.000Z');

let n = 0;
const event = (over: Partial<MemnoxEvent> = {}): MemnoxEvent => ({
  id: `evt_${(n += 1)}`,
  schemaVersion: EVENT_SCHEMA_VERSION,
  at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
  sessionId: 'ses_1',
  agent: 'claude-code',
  actorType: ACTOR_TYPE.AGENT,
  surface: EVENT_SURFACE.SHELL,
  operation: 'npm.install',
  target: 'shop-web',
  class: TOOL_CLASS.WRITE,
  effect: DECISION_EFFECT.ASK,
  authorizedBy: 'maya',
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'held',
  ...over,
});

async function homeWith(
  events: readonly MemnoxEvent[],
  autopilot: boolean,
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-autopilot-'));
  await mkdir(join(home, MEMNOX_HOME), { recursive: true });
  await writeFile(join(home, MEMNOX_HOME, 'config.toml'), `autopilot = ${autopilot}\n`);
  const store = SqliteEventStore.forHome(home);
  for (const each of events) await store.append(each);
  store.close();
  return home;
}

const habit = (): MemnoxEvent[] =>
  Array.from({ length: PROMOTION_THRESHOLD }, () => event());

describe('the autopilot pass', () => {
  it('grants nothing while the autopilot is off, however strong the record', async () => {
    const home = await homeWith(habit(), false);
    expect(await autopilotOnce(home, NOW)).toEqual({ granted: [], revoked: [] });
    expect(await new EarnedAllowances(home).all()).toEqual([]);
  });

  it('hands an earned action over, records it in the ledger, and says how to take it back', async () => {
    const home = await homeWith(habit(), true);
    const pass = await autopilotOnce(home, NOW);
    const [grant] = pass.granted;
    expect(grant?.allowance.agents).toEqual(['claude-code']);
    expect(await new EarnedAllowances(home).inForce(NOW.toISOString())).toHaveLength(1);

    const [said] = describeAutopilot(pass);
    expect(said).toContain(`memnox autopilot --revoke ${grant?.allowance.id ?? ''}`);

    const ledger = SqliteEventStore.forHome(home);
    const rows = await ledger.query({ withConfig: true, limit: 100 });
    ledger.close();
    expect(rows.some((row) => row.operation === 'autopilot.granted')).toBe(true);
  });

  it('takes a grant back on the pass after a refusal, and does not grant it again', async () => {
    const home = await homeWith(habit(), true);
    const [grant] = (await autopilotOnce(home, NOW)).granted;

    const ledger = SqliteEventStore.forHome(home);
    await ledger.append(
      event({
        effect: DECISION_EFFECT.DENY,
        authorizedBy: undefined,
        at: new Date(NOW.getTime() + 60_000).toISOString(),
      }),
    );
    ledger.close();

    const next = await autopilotOnce(home, new Date(NOW.getTime() + 5 * 60_000));
    expect(next.revoked.map((each) => each.allowance.id)).toEqual([grant?.allowance.id]);
    expect(next.granted).toEqual([]);
  });
});

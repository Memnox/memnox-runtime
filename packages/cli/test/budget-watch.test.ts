import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPE,
  BUDGET_UNIT,
  BUDGET_WINDOW,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  NOTICE_KIND,
  SqliteEventStore,
  TOOL_CLASS,
  writeBudgets,
  type MemnoxEvent,
} from '@memnox/core';
import { BudgetWatch } from '../src/daemon/budget-watch';

const NOW = '2026-11-11T12:00:00.000Z';

function deploy(n: number): MemnoxEvent {
  return {
    id: `evt_deploy_${n}`,
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: new Date(Date.parse(NOW) - n * 60_000).toISOString(),
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: ACTOR_TYPE.AGENT,
    surface: EVENT_SURFACE.SHELL,
    operation: 'deploy.service',
    class: TOOL_CLASS.WRITE,
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: 'no rule matched',
  };
}

async function homeWith(deploys: number): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-budget-watch-'));
  await writeBudgets(home, [
    {
      name: 'production deploys',
      actions: ['deploy.*'],
      limit: 5,
      warnAt: 3,
      window: BUDGET_WINDOW.DAY,
      unit: BUDGET_UNIT.CALLS,
    },
  ]);
  const store = SqliteEventStore.forHome(home);
  for (let n = 1; n <= deploys; n += 1) await store.append(deploy(n));
  store.close();
  return home;
}

describe('a budget told before it stops', () => {
  it('says nothing while the budget is under its line', async () => {
    const watch = new BudgetWatch(await homeWith(2));
    expect(await watch.look(NOW)).toEqual([]);
  });

  it('tells the line once, however many looks follow', async () => {
    const watch = new BudgetWatch(await homeWith(3));
    const first = await watch.look(NOW);
    expect(first).toHaveLength(1);
    expect(first[0]?.notice).toBe(NOTICE_KIND.BUDGET);
    expect(first[0]?.summary).toBe('3 of 5 production deploys today, stops at 5.');
    expect(await watch.look(NOW)).toEqual([]);
  });

  it('tells the stop as its own notice', async () => {
    const watch = new BudgetWatch(await homeWith(5));
    const [stopped] = await watch.look(NOW);
    expect(stopped?.summary).toContain('refused until the window moves');
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  HOLD_ANSWER,
  HOLD_OUTCOME,
  holdFor,
  LocalGate,
  Missions,
  PendingApprovals,
  SessionTurns,
  SqliteEventStore,
  summarizeMission,
  TOOL_CLASS,
  type HoldRequest,
  type MemnoxEvent,
  type Policy,
} from '@memnox/core';
import { strainHolding } from '@memnox/interceptors';
import { WaitingFeed } from '../src/daemon/waiting-feed';

/**
 * The night the vision is about, in one story through the real stores: an agent left alone
 * struggles, its reach narrows, its question is parked, a person answers from a phone hours
 * later, it recovers, and the morning starts from a summary rather than from a terminal.
 */

const SESSION = 'ses_overnight';
const START = Date.parse('2026-10-07T22:00:00.000Z');
const at = (minutes: number): string => new Date(START + minutes * 60_000).toISOString();

const ran = (minute: number, operation: string, exitCode: number): MemnoxEvent => ({
  id: `evt_${minute}_${operation}`,
  schemaVersion: EVENT_SCHEMA_VERSION,
  at: at(minute),
  sessionId: SESSION,
  agent: 'claude-code',
  actorType: ACTOR_TYPE.AGENT,
  surface: EVENT_SURFACE.SHELL,
  operation,
  class: TOOL_CLASS.READ,
  effect: DECISION_EFFECT.ALLOW,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'ran',
  exitCode,
});

async function record(home: string, rows: readonly MemnoxEvent[]): Promise<void> {
  const store = SqliteEventStore.forHome(home);
  for (const row of rows) await store.append(row);
  store.close();
}

const allowAll: Policy = {
  name: 'allow-all',
  match: { actions: ['*'] },
  decision: { effect: DECISION_EFFECT.ALLOW, reason: 'allowed' },
};

const merge: HoldRequest = {
  sessionId: SESSION,
  agent: 'claude-code',
  operation: 'gh.pr.merge',
  fingerprint: 'merge0000000001',
  reason: 'this session has failures it has not got past',
};

describe('a night with nobody at the keyboard', () => {
  it('loses one call for a while, never the night, and leaves a summary for the morning', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-overnight-'));
    const missions = new Missions(home);
    const mission = await missions.start('Fix payment webhook failures', {
      reference: 'INC-421',
      now: at(0),
    });
    await missions.attach(mission.id, SESSION);
    const turns = new SessionTurns(home);
    await turns.prompted(SESSION, 'claude-code', at(0));

    // Three failed fixes in a row, so its reach narrows and a person away is told.
    await record(home, [
      ran(10, 'npm.test', 1),
      ran(20, 'npm.test', 1),
      ran(30, 'npm.test', 1),
    ]);
    const strain = await strainHolding(home, SESSION, 'Claude');
    const gate = new LocalGate([allowAll], { agentName: 'claude-code', strain });
    expect(
      gate.evaluate({ action: 'gh.pr.merge', toolClass: TOOL_CLASS.WRITE }).effect,
    ).toBe(DECISION_EFFECT.ASK);
    expect(
      gate.evaluate({
        action: 'filesystem.write',
        toolClass: TOOL_CLASS.WRITE,
        target: 'a.ts',
      }).effect,
    ).toBe(DECISION_EFFECT.ALLOW);

    // Nobody answers, so the merge is parked and the agent goes on with the rest.
    const parked = await holdFor({ home, interactive: false, timeoutMs: 20 }).hold(merge);
    expect(parked.outcome).toBe(HOLD_OUTCOME.PARKED);
    const waiting = await new WaitingFeed(home).current(at(40));
    expect(waiting.map((event) => event.kind)).toEqual(['held', 'notice']);
    expect(waiting[1]?.notice).toBe('struggling');

    // It gets past the failure, so the struggling post is taken back.
    await record(home, [ran(60, 'npm.test', 0)]);
    await strainHolding(home, SESSION, 'Claude');
    expect(
      (await new WaitingFeed(home).current(at(61))).map((event) => event.kind),
    ).toEqual(['held']);

    // Hours later a person says yes from the phone, and the retry goes through.
    await new PendingApprovals(home).answer(
      parked.approvalId ?? '',
      HOLD_ANSWER.ONCE,
      'the phone',
      at(180),
    );
    const retry = await holdFor({ home, interactive: false, timeoutMs: 20 }).hold(merge);
    expect(retry.outcome).toBe(HOLD_OUTCOME.ALLOWED);
    expect(retry.by).toBe('the phone');

    // It hands back after four hours, and the morning starts from what it came to.
    await turns.ended(SESSION, 'claude-code', at(240));
    const morning = await new WaitingFeed(home).current(at(540));
    expect(morning).toHaveLength(1);
    expect(morning[0]?.summary).toContain('worked 4h and is waiting on you');
    expect(morning[0]?.summary).toContain('recovered: 3 failure(s) later got past');

    const joined = (await missions.read(mission.id)) ?? mission;
    const events = SqliteEventStore.forHome(home);
    const summary = summarizeMission(joined, await events.query({}));
    events.close();
    expect(summary.standings).toEqual([{ sessionId: SESSION, standing: 'clear' }]);
  }, 30_000);
});

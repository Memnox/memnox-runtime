import { describe, expect, it } from 'vitest';

import {
  actionContextOf,
  CONTEXT_DOMAIN,
  DECISION_EFFECT,
  EVENT_SCHEMA_VERSION,
  hasRecordedContext,
  LocalGate,
  POLICY_MODE,
  type ContextPart,
  type MemnoxEvent,
  type Policy,
} from '../src/index';

/* One DELETE, two right answers: the same statement through the same tool is a breach
   from a support assistant and routine from an agent working for a DBA. The row has to
   say which part of the context made the difference, long after the rules moved. */

function row(over: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id: 'evt_1',
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: '2026-10-23T10:00:00.000Z',
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'mcp',
    operation: 'mcp.query',
    target: 'support-db',
    class: 'write',
    effect: DECISION_EFFECT.ALLOW,
    mode: 'enforce',
    reason: 'no rule matched',
    signals: [],
    ...over,
  };
}

function part(event: MemnoxEvent, domain: string): ContextPart | undefined {
  return actionContextOf(event).find((each) => each.domain === domain);
}

const ONLY_A_DBA_DELETES = {
  name: 'only-a-dba-deletes',
  match: {
    actions: ['mcp.*'],
    classes: ['write', 'destructive'],
    principals: ['!dba-*'],
  },
  decision: {
    effect: DECISION_EFFECT.DENY,
    reason: 'the person this agent works for may not delete rows',
    mode: POLICY_MODE.ENFORCE,
  },
} as Policy;

describe('an action read against what decided it', () => {
  it('names every part in reading order, so an empty part says so rather than vanishing', () => {
    const parts = actionContextOf(row());
    expect(parts.map((each) => each.domain)).toEqual(Object.values(CONTEXT_DOMAIN));
    expect(part(row(), CONTEXT_DOMAIN.PERSON)?.facts).toEqual([
      'nobody was named, so no person’s authority was checked',
    ]);
    expect(part(row(), CONTEXT_DOMAIN.INTENT)?.facts[0]).toContain(
      'no task was declared',
    );
    expect(parts.some((each) => each.decided)).toBe(false);
  });

  it('says a refusal came from who the agent works for', () => {
    const gate = new LocalGate([ONLY_A_DBA_DELETES], {
      agentName: 'support-assistant',
      principal: 'tier1-sam',
    });
    const verdict = gate.evaluate({
      action: 'mcp.query',
      target: 'support-db',
      toolClass: 'write',
    });
    expect(verdict.principal).toBe('tier1-sam');
    const event = row({
      effect: verdict.effect,
      signals: verdict.signals,
      principal: verdict.principal,
    });
    const person = part(event, CONTEXT_DOMAIN.PERSON);
    expect(person?.decided).toBe(true);
    expect(person?.facts).toEqual([
      'working for tier1-sam',
      'rule only-a-dba-deletes on who the agent works for',
    ]);
    expect(part(event, CONTEXT_DOMAIN.SYSTEMS)?.decided).toBe(false);
  });

  it('lets the same call through for the DBA, and says nothing decided against it', () => {
    const gate = new LocalGate([ONLY_A_DBA_DELETES], {
      agentName: 'data-steward',
      principal: 'dba-ana',
    });
    const verdict = gate.evaluate({
      action: 'mcp.query',
      target: 'support-db',
      toolClass: 'write',
    });
    expect(verdict.effect).toBe(DECISION_EFFECT.ALLOW);
    const event = row({ signals: verdict.signals, principal: 'dba-ana' });
    expect(part(event, CONTEXT_DOMAIN.PERSON)?.facts).toEqual(['working for dba-ana']);
    expect(actionContextOf(event).some((each) => each.decided)).toBe(false);
  });

  it('puts a first bulk delete in history, and the task in intent', () => {
    const event = row({
      class: 'destructive',
      effect: DECISION_EFFECT.ASK,
      signals: ['notice:novel', 'scope:in_scope'],
    });
    const history = part(event, CONTEXT_DOMAIN.HISTORY);
    expect(history?.decided).toBe(true);
    expect(history?.facts).toEqual(['this agent had never done this before']);
    expect(part(event, CONTEXT_DOMAIN.INTENT)?.facts).toEqual([
      'inside the task the session declared',
    ]);
  });

  it('counts a person’s earlier yes as deciding an allow, never a hold', () => {
    const allowed = row({ signals: ['allowance:alw_1'] });
    expect(part(allowed, CONTEXT_DOMAIN.HISTORY)?.decided).toBe(true);
    const asked = row({ effect: DECISION_EFFECT.ASK, signals: ['allowance:alw_1'] });
    expect(part(asked, CONTEXT_DOMAIN.HISTORY)?.decided).toBe(false);
  });

  it('reads what observe let through as what enforce would have done', () => {
    const event = row({
      shadowEffect: DECISION_EFFECT.ASK,
      mode: 'observe',
      signals: ['hidden-code'],
    });
    expect(part(event, CONTEXT_DOMAIN.TOOLS)?.decided).toBe(true);
  });

  it('tells a row from before signals were kept apart from one where nothing was found', () => {
    const older = row();
    delete older.signals;
    expect(hasRecordedContext(older)).toBe(false);
    expect(hasRecordedContext(row())).toBe(true);
  });
});

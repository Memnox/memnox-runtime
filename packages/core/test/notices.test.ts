import { describe, expect, it } from 'vitest';
import {
  ACTION,
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  NOTICE_KIND,
  noticesFrom,
  startWatch,
  TOOL_CLASS,
  type MemnoxEvent,
} from '../src/index';

const START = '2026-10-01T10:00:00.000Z';

function at(minutes: number): string {
  return new Date(Date.parse(START) + minutes * 60_000).toISOString();
}

function row(minute: number, over: Partial<MemnoxEvent> = {}): MemnoxEvent {
  return {
    id: `evt_${minute}_${over.operation ?? 'x'}`,
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: at(minute),
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: ACTOR_TYPE.AGENT,
    surface: EVENT_SURFACE.FILESYSTEM,
    operation: ACTION.FILESYSTEM_WRITE,
    class: TOOL_CLASS.WRITE,
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.OBSERVE,
    reason: 'recorded',
    ...over,
  };
}

describe('what is worth saying without being asked', () => {
  it('tells a commit and a push once, and never one that failed or was refused', () => {
    const events = [
      row(1, { surface: EVENT_SURFACE.GIT, operation: ACTION.GIT_COMMIT, exitCode: 0 }),
      row(2, {
        surface: EVENT_SURFACE.GIT,
        operation: ACTION.GIT_PUSH,
        target: 'origin',
        exitCode: 0,
      }),
      row(3, { surface: EVENT_SURFACE.GIT, operation: ACTION.GIT_PUSH, exitCode: 1 }),
      row(4, {
        surface: EVENT_SURFACE.GIT,
        operation: ACTION.GIT_PUSH,
        effect: DECISION_EFFECT.DENY,
      }),
    ];
    const first = noticesFrom(startWatch(START), events, []);
    expect(first.notices.map((each) => each.kind)).toEqual([
      NOTICE_KIND.COMMITTED,
      NOTICE_KIND.PUSHED,
    ]);
    expect(noticesFrom(first.watch, events, []).notices).toEqual([]);
  });

  it('says once what a rule would have held while only watching, and never what no rule covered', () => {
    const rule = {
      name: 'voice-ask-git-push',
      layer: 'project',
      file: '/w/memnox.policies.toml',
    };
    const push = { surface: EVENT_SURFACE.GIT, operation: ACTION.GIT_PUSH, exitCode: 1 };
    const events = [
      row(1, { ...push, shadowEffect: DECISION_EFFECT.ASK, rule }),
      row(2, { ...push, shadowEffect: DECISION_EFFECT.ASK, rule }),
      row(3, { ...push, shadowEffect: DECISION_EFFECT.ASK }),
    ];
    const { notices } = noticesFrom(startWatch(START), events, []);
    expect(notices).toEqual([
      expect.objectContaining({
        kind: NOTICE_KIND.WOULD_HAVE,
        action: ACTION.GIT_PUSH,
        rule: 'voice-ask-git-push',
        wouldHave: DECISION_EFFECT.ASK,
      }),
    ]);
  });

  it('says a long turn finished once the agent hands back, and never while it is still going', () => {
    const working = [{ sessionId: 'ses_1', agent: 'claude-code', promptAt: at(1) }];
    expect(noticesFrom(startWatch(START), [], working).notices).toEqual([]);
    const ended = [{ ...working[0]!, endedAt: at(9) }];
    const told = noticesFrom(startWatch(START), [], ended);
    expect(told.notices).toEqual([
      expect.objectContaining({
        kind: NOTICE_KIND.FINISHED,
        minutes: 8,
        sessionId: 'ses_1',
      }),
    ]);
    expect(noticesFrom(told.watch, [], ended).notices).toEqual([]);
  });

  it('leaves out a short turn the person watched, and this Mac itself', () => {
    const quick = [
      { sessionId: 'ses_1', agent: 'claude-code', promptAt: at(1), endedAt: at(2) },
    ];
    expect(noticesFrom(startWatch(START), [], quick).notices).toEqual([]);
    const local = [row(12.5, { sessionId: 'ses_local', operation: ACTION.GIT_COMMIT })];
    expect(noticesFrom(startWatch(START), local, []).notices).toEqual([]);
  });
});

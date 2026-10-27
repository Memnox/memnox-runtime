import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  FileGrants,
  LocalGate,
  type MemnoxEvent,
  type Policy,
} from '@memnox/core';
import { HookAuthorizer } from '../src/hook-authorizer';
import {
  learnFromAnswer,
  learnFromRefusal,
  rememberQuestion,
} from '../src/prompt-answers';
import { answerToolCall } from '../src/tool-hook';
import { canonicalPayload } from '../src/openclaw-payload';

/**
 * Somebody allowing the same read three times in one session, which is what
 * `gh.pr-view allowed for this session` printed three times in a row looked like.
 */

const NOW = new Date('2026-09-25T10:00:00.000Z');

const RULES: Policy[] = [
  {
    name: 'cli-ask',
    match: { actions: ['gh.*', 'railway.*'] },
    decision: { effect: DECISION_EFFECT.ASK, reason: 'a person looks at the CLIs' },
  } as never,
];

function bash(event: string, id: string, command: string): Record<string, unknown> {
  return {
    hook_event_name: event,
    session_id: 's1',
    cwd: '/work/repo',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: id,
    tool_input: { command },
  };
}

async function machine(): Promise<{
  home: string;
  deps: Parameters<typeof learnFromAnswer>[1];
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-grant-hook-'));
  return {
    home,
    deps: {
      home,
      agent: 'claude-code',
      runSession: undefined,
      env: {},
      now: () => NOW,
      sink: null,
      mode: ENFORCEMENT_MODE.ENFORCE,
      authorizer: new HookAuthorizer({
        gate: new LocalGate(RULES, { agentName: 'agent' }),
      }),
    },
  };
}

/** One call, start to finish: ruled on, asked, and run because the person said yes. */
async function allowedInPrompt(
  deps: Parameters<typeof learnFromAnswer>[1],
  id: string,
  command: string,
): Promise<string> {
  const before = bash('PreToolUse', id, command);
  const answer = await answerToolCall(
    before,
    { ...deps, personThere: true },
    { authorizer: deps.authorizer!, mode: ENFORCEMENT_MODE.ENFORCE, sink: null },
  );
  if (answer === null) throw new Error('no answer');
  if (answer.asked) {
    await rememberQuestion(before, answer, deps);
    await learnFromAnswer(bash('PostToolUse', id, command), deps);
  }
  return answer.ruling.effect;
}

describe('the same yes in the same session', () => {
  it('is asked twice and then let through', async () => {
    const { deps } = await machine();
    expect(await allowedInPrompt(deps, 't1', 'gh pr view 12')).toBe(DECISION_EFFECT.ASK);
    expect(await allowedInPrompt(deps, 't2', 'gh pr view 13')).toBe(DECISION_EFFECT.ASK);
    expect(await allowedInPrompt(deps, 't3', 'gh pr view 14')).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('is not carried to another action', async () => {
    const { deps } = await machine();
    await allowedInPrompt(deps, 't1', 'gh pr view 12');
    await allowedInPrompt(deps, 't2', 'gh pr view 13');
    expect(await allowedInPrompt(deps, 't3', 'gh pr merge 12')).toBe(DECISION_EFFECT.ASK);
  });

  it('is let through at once after "for this session" from the workspace', async () => {
    const { home, deps } = await machine();
    await new FileGrants(home).grant({
      sessionId: 's1',
      operation: 'gh.pr-view',
      fingerprint: 'x',
      class: 'read',
    });
    expect(await allowedInPrompt(deps, 't1', 'gh pr view 12')).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('never lets a delete through on a count', async () => {
    const { deps } = await machine();
    for (const id of ['t1', 't2']) await allowedInPrompt(deps, id, 'railway down');
    expect(await allowedInPrompt(deps, 't3', 'railway down')).toBe(DECISION_EFFECT.ASK);
  });
});

describe("a yes at OpenClaw's own approval", () => {
  /* OpenClaw puts Memnox's question through its own approval and says nothing back on a
     yes; the call running is the yes, matched by the id OpenClaw gives the call. */
  function exec(event: string, id: string, command: string): unknown {
    return canonicalPayload({
      hook_event_name: event,
      session_id: 'agent:main:main',
      tool_name: 'exec',
      tool_use_id: id,
      tool_input: { command },
    });
  }

  async function allowedInOpenClaw(
    deps: Parameters<typeof learnFromAnswer>[1],
    id: string,
    command: string,
  ): Promise<string> {
    const before = exec('before_tool_call', id, command);
    const answer = await answerToolCall(
      before,
      { ...deps, agent: 'openclaw', personThere: true },
      { authorizer: deps.authorizer!, mode: ENFORCEMENT_MODE.ENFORCE, sink: null },
    );
    if (answer === null) throw new Error('no answer');
    if (answer.asked) {
      await rememberQuestion(before, answer, deps);
      await learnFromAnswer(exec('after_tool_call', id, command), deps);
    }
    return answer.ruling.effect;
  }

  it('is learned like a yes in Claude Code, so the third is let through', async () => {
    const { deps } = await machine();
    expect(await allowedInOpenClaw(deps, 'c1', 'gh pr view 12')).toBe(
      DECISION_EFFECT.ASK,
    );
    expect(await allowedInOpenClaw(deps, 'c2', 'gh pr view 13')).toBe(
      DECISION_EFFECT.ASK,
    );
    expect(await allowedInOpenClaw(deps, 'c3', 'gh pr view 14')).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });
});

describe("a no at OpenClaw's own approval", () => {
  /* OpenClaw says how its approval ended, so a no, a timeout and a question nobody could
     see each become a row; Claude Code's prompt tells nobody about a no at all. */
  function call(event: string, extra: Record<string, unknown> = {}): unknown {
    return canonicalPayload({
      hook_event_name: event,
      session_id: 'agent:main:main',
      tool_name: 'exec',
      tool_use_id: 'c9',
      tool_input: { command: 'gh pr merge 12' },
      ...extra,
    });
  }

  async function answered(decision: string): Promise<MemnoxEvent[]> {
    const { deps } = await machine();
    const rows: MemnoxEvent[] = [];
    const sink = {
      append: async (row: MemnoxEvent): Promise<void> => {
        rows.push(row);
      },
      query: async (): Promise<MemnoxEvent[]> => rows,
    };
    const withSink = { ...deps, agent: 'openclaw', sink, person: () => 'moise' };
    const before = call('before_tool_call');
    const answer = await answerToolCall(
      before,
      { ...withSink, personThere: true },
      { authorizer: deps.authorizer!, mode: ENFORCEMENT_MODE.ENFORCE, sink: null },
    );
    if (answer === null || !answer.asked) throw new Error('the merge is asked about');
    await rememberQuestion(before, answer, withSink);
    expect(
      await learnFromRefusal(call('approval_resolved', { decision }), withSink),
    ).toBe(true);
    return rows;
  }

  it('records a no as the person refusing, by name', async () => {
    const [row] = await answered('deny');

    expect(row).toMatchObject({
      effect: DECISION_EFFECT.DENY,
      execution: 'blocked',
      actorType: 'human',
      principal: 'moise',
      operation: 'gh.pr-merge',
    });
    expect(row?.reason).toContain("moise said no in openclaw's own approval");
  });

  it('records a timeout as nobody answering, naming no one', async () => {
    const [row] = await answered('timeout');

    expect(row).toMatchObject({ execution: 'timed-out', actorType: 'agent' });
    expect(row?.principal).toBeUndefined();
  });

  it('leaves a yes to the call running, so it is never recorded twice', async () => {
    expect(await answered('allow-once')).toEqual([]);
  });
});

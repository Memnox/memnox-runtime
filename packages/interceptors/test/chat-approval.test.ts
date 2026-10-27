import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ROUTE,
  configPathFor,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  LocalGate,
  PendingApprovals,
  type ApprovalRoute,
} from '@memnox/core';
import { HookAuthorizer } from '../src/hook-authorizer';
import { answerInChat, answersArrived } from '../src/in-session';
import { readApprovalRoute } from '@memnox/core';
import { answerToolCall } from '../src/tool-hook';

/* An agent that could not show its own prompt had every ask refused outright, with a note
   that a yes in the conversation could not help. Now the question is held, the person's
   next prompt answers it, and the retry runs, or it goes to their DM when they asked for that. */

const NOW = new Date('2026-09-26T10:00:00.000Z');

const ASK_MERGES = [
  {
    name: 'merges-ask',
    match: { actions: ['gh.*'], classes: ['write'] },
    decision: { effect: 'ask', reason: 'a person looks at merges' },
  },
];

function merge(sessionId = 's1'): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    cwd: '/repo',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr merge 12' },
  };
}

async function ask(home: string, route: ApprovalRoute, personThere = false) {
  const gate = new LocalGate(ASK_MERGES as never, { agentName: 'claude-code' });
  return answerToolCall(
    merge(),
    {
      home,
      agent: 'claude-code',
      runSession: undefined,
      env: {},
      personThere,
      now: () => NOW,
    },
    {
      authorizer: new HookAuthorizer({ gate }),
      mode: ENFORCEMENT_MODE.ENFORCE,
      sink: null,
      route,
    },
  );
}

const home = () => mkdtemp(join(tmpdir(), 'memnox-chat-approval-'));
const person = () => 'maya';

describe('a question the agent cannot show a prompt for', () => {
  it('is held, and the agent is told to ask the person here', async () => {
    const machine = await home();
    const first = await ask(machine, APPROVAL_ROUTE.SESSION);

    expect(first?.ruling.effect).toBe(DECISION_EFFECT.ASK);
    expect(first?.reply?.stdout).toContain('"permissionDecision":"deny"');
    expect(first?.reply?.stdout).toContain(
      'Memnox is holding this until your person answers (apr_',
    );
    expect(first?.reply?.stdout).toContain('with your AskUserQuestion tool');
    expect(first?.reply?.stdout).toContain('Leave its answers empty');
    expect(first?.reply?.stdout).not.toContain('Slack or Discord');
    // Shown to the person by the host, so it never waits on the agent passing it on.
    const shown = JSON.parse(first?.reply?.stdout ?? '{}') as { systemMessage?: string };
    expect(shown.systemMessage).toMatch(/^Memnox needs your OK \(apr_/);
    const held = await new PendingApprovals(machine).list(NOW.toISOString());
    expect(held).toHaveLength(1);
    expect(held[0]?.route).toBe(APPROVAL_ROUTE.SESSION);
  });

  it('asks once however many times the agent tries before an answer', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.SESSION);
    await ask(machine, APPROVAL_ROUTE.SESSION);
    expect(await new PendingApprovals(machine).list(NOW.toISOString())).toHaveLength(1);
  });

  it('runs on the retry once the person says yes in the session', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.SESSION);

    const said = await answerInChat(machine, 's1', 'yes', NOW, person);
    expect(said).toContain('maya said yes, once: you may');
    const retry = await ask(machine, APPROVAL_ROUTE.SESSION);

    expect(retry?.ruling.effect).toBe(DECISION_EFFECT.ALLOW);
    expect(retry?.ruling.reason).toContain('maya allowed this');
    // Once is once: the call after that is asked about again.
    expect((await ask(machine, APPROVAL_ROUTE.SESSION))?.ruling.effect).toBe(
      DECISION_EFFECT.ASK,
    );
  });

  it('stops asking after "allow for this session"', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.SESSION);
    await answerInChat(machine, 's1', 'allow for this session', NOW, person);

    expect((await ask(machine, APPROVAL_ROUTE.SESSION))?.ruling.effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
    expect((await ask(machine, APPROVAL_ROUTE.SESSION))?.ruling.effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('refuses the retry in the person’s words after a no', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.SESSION);
    await answerInChat(machine, 's1', 'no', NOW, person);

    const retry = await ask(machine, APPROVAL_ROUTE.SESSION);
    expect(retry?.ruling.effect).toBe(DECISION_EFFECT.DENY);
    expect(retry?.ruling.reason).toContain('maya said no to this');
  });

  it('reads an ordinary prompt as a prompt, never as an answer', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.SESSION);
    expect(
      await answerInChat(machine, 's1', 'now refactor the billing module', NOW, person),
    ).toBeNull();
    expect(await answerInChat(machine, 'another', 'yes', NOW, person)).toBeNull();
  });
});

describe('a person who also takes questions in their DM', () => {
  it('is still asked through the agent prompt where there is one', async () => {
    const machine = await home();
    const first = await ask(machine, APPROVAL_ROUTE.BOTH, true);
    expect(first?.asked).toBe(true);
    expect(await new PendingApprovals(machine).list(NOW.toISOString())).toEqual([]);
  });

  it('is still answered by a yes typed in the session', async () => {
    const machine = await home();
    const first = await ask(machine, APPROVAL_ROUTE.BOTH);
    // Nothing outside can close a picker, so with the DM on the agent waits rather than opening one.
    expect(first?.reply?.stdout).toContain('end your turn');
    expect(first?.reply?.stdout).not.toContain('AskUserQuestion');
    expect(await answerInChat(machine, 's1', 'yes', NOW, person)).toContain('said yes');
    // Told in the session, so the turn end has nothing more to say.
    expect(
      await answersArrived({ home: machine, sessionId: 's1', now: () => NOW, waitMs: 0 }),
    ).toBeNull();
  });

  it('tells the agent at the turn end once the DM answer lands, and the retry runs', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.BOTH);
    const approvals = new PendingApprovals(machine);
    const [held] = await approvals.list(NOW.toISOString());
    if (held === undefined) throw new Error('the question was held');

    let clock = NOW.getTime();
    // The answer arrives from the workspace while the turn end is waiting.
    const sleep = async (ms: number): Promise<void> => {
      clock += ms;
      await approvals.answer(
        held.id,
        'once',
        'maya in Slack',
        new Date(clock).toISOString(),
      );
    };
    const said = await answersArrived({
      home: machine,
      sessionId: 's1',
      now: () => new Date(clock),
      waitMs: 60_000,
      sleep: sleep,
    });

    expect(said).toContain('maya in Slack said yes, once: you may');
    expect(said).toContain('Try the same call again now and carry on');
    expect((await ask(machine, APPROVAL_ROUTE.BOTH))?.ruling.effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('tells a no once, and the agent is told to carry on without it', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.BOTH);
    const approvals = new PendingApprovals(machine);
    const [held] = await approvals.list(NOW.toISOString());
    if (held === undefined) throw new Error('the question was held');
    await approvals.answer(held.id, 'deny', 'maya in Discord', NOW.toISOString());

    const said = await answersArrived({
      home: machine,
      sessionId: 's1',
      now: () => NOW,
      waitMs: 0,
    });
    expect(said).toContain('maya in Discord said no');
    expect(
      await answersArrived({ home: machine, sessionId: 's1', now: () => NOW, waitMs: 0 }),
    ).toBeNull();
  });

  it('gives up waiting at the deadline, and never waits on a session-only question', async () => {
    const machine = await home();
    await ask(machine, APPROVAL_ROUTE.BOTH);
    let clock = NOW.getTime();
    const sleep = async (ms: number): Promise<void> => {
      clock += ms;
    };
    expect(
      await answersArrived({
        home: machine,
        sessionId: 's1',
        now: () => new Date(clock),
        waitMs: 5_000,
        sleep: sleep,
      }),
    ).toBeNull();
    expect(clock - NOW.getTime()).toBe(5_000);

    const local = await home();
    await ask(local, APPROVAL_ROUTE.SESSION);
    let slept = 0;
    await answersArrived({
      home: local,
      sessionId: 's1',
      now: () => NOW,
      waitMs: 60_000,
      sleep: async () => {
        slept += 1;
      },
    });
    expect(slept).toBe(0);
  });
});

describe('where the route comes from', () => {
  it('is the session until config.toml says otherwise', async () => {
    const machine = await home();
    expect(await readApprovalRoute(machine)).toBe(APPROVAL_ROUTE.SESSION);
    await mkdir(join(machine, '.memnox'), { recursive: true });
    await writeFile(configPathFor(machine), 'approvals = "both"\n');
    expect(await readApprovalRoute(machine)).toBe(APPROVAL_ROUTE.BOTH);
  });
});

describe('a question a paired phone can answer', () => {
  async function askWithPhone(machine: string) {
    const gate = new LocalGate(ASK_MERGES as never, { agentName: 'claude-code' });
    return answerToolCall(
      merge(),
      {
        home: machine,
        agent: 'claude-code',
        runSession: undefined,
        env: {},
        personThere: false,
        now: () => NOW,
      },
      {
        authorizer: new HookAuthorizer({ gate }),
        mode: ENFORCEMENT_MODE.ENFORCE,
        sink: null,
        route: APPROVAL_ROUTE.SESSION,
        voiceThere: async () => false,
        pairedThere: async () => true,
      },
    );
  }

  it('opens no picker, since an answer on the phone could never close it', async () => {
    const machine = await home();
    const answer = await askWithPhone(machine);
    expect(answer?.ruling.effect).toBe(DECISION_EFFECT.ASK);
    expect(answer?.reply?.stdout).not.toContain('AskUserQuestion');
    expect(answer?.reply?.stdout).toContain('their paired phone');
    expect(answer?.reply?.stdout).toContain('It was also sent to your paired phone');
  });

  it('tells the agent at the turn end once the phone answer lands', async () => {
    const machine = await home();
    await askWithPhone(machine);
    const approvals = new PendingApprovals(machine);
    const [held] = await approvals.list(NOW.toISOString());
    if (held === undefined) throw new Error('the question was held');
    expect(held.alsoOn).toEqual(['paired']);
    let clock = NOW.getTime();
    const sleep = async (ms: number): Promise<void> => {
      clock += ms;
      await approvals.answer(
        held.id,
        'once',
        'person (Face ID, iPhone)',
        NOW.toISOString(),
      );
    };
    const said = await answersArrived({
      home: machine,
      sessionId: 's1',
      now: () => new Date(clock),
      waitMs: 60_000,
      sleep,
    });
    expect(said).toContain('said yes, once');
  });
});

describe('a question while the Mac voice is listening', () => {
  async function askWithVoice(
    machine: string,
    voiceWaitMs: number,
    answering?: (approvals: PendingApprovals) => Promise<void>,
  ) {
    const gate = new LocalGate(ASK_MERGES as never, { agentName: 'claude-code' });
    const approvals = new PendingApprovals(machine);
    const asking = answerToolCall(
      merge(),
      {
        home: machine,
        agent: 'claude-code',
        runSession: undefined,
        env: {},
        personThere: false,
        now: () => NOW,
      },
      {
        authorizer: new HookAuthorizer({ gate }),
        mode: ENFORCEMENT_MODE.ENFORCE,
        sink: null,
        route: APPROVAL_ROUTE.SESSION,
        voiceThere: async () => true,
        voiceWaitMs,
        pairedThere: async () => false,
      },
    );
    if (answering !== undefined) {
      // The voice answers while the call is still waiting, as Touch ID does.
      for (;;) {
        const [held] = await approvals.list(NOW.toISOString());
        if (held !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await answering(approvals);
    }
    return asking;
  }

  it('lets the call through on a spoken yes, with no picker left to click', async () => {
    const machine = await home();
    const answer = await askWithVoice(machine, 5_000, async (approvals) => {
      const [held] = await approvals.list(NOW.toISOString());
      await approvals.answer(held?.id ?? '', 'session', 'voice', NOW.toISOString());
    });
    expect(answer?.ruling.effect).toBe(DECISION_EFFECT.ALLOW);
    expect(answer?.reply?.stdout ?? '').not.toContain('AskUserQuestion');
    expect(await new PendingApprovals(machine).list(NOW.toISOString())).toEqual([]);
    // For this session, so the next one goes through without being put to anybody.
    expect((await ask(machine, APPROVAL_ROUTE.SESSION))?.ruling.effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });

  it('refuses on a spoken no', async () => {
    const machine = await home();
    const answer = await askWithVoice(machine, 5_000, async (approvals) => {
      const [held] = await approvals.list(NOW.toISOString());
      await approvals.answer(held?.id ?? '', 'deny', 'voice', NOW.toISOString());
    });
    expect(answer?.ruling.effect).toBe(DECISION_EFFECT.DENY);
  });

  it('leaves the question on the Mac rather than opening a picker it could never close', async () => {
    const machine = await home();
    const answer = await askWithVoice(machine, 50);
    expect(answer?.ruling.effect).toBe(DECISION_EFFECT.ASK);
    expect(answer?.reply?.stdout).not.toContain('AskUserQuestion');
    expect(answer?.reply?.stdout).toContain('from the Memnox Mac app');
    const [held] = await new PendingApprovals(machine).list(NOW.toISOString());
    expect(held?.alsoOn).toEqual(['mac']);
  });

  it('tells the agent at the turn end once the Mac answer lands', async () => {
    const machine = await home();
    await askWithVoice(machine, 50);
    const approvals = new PendingApprovals(machine);
    const [held] = await approvals.list(NOW.toISOString());
    if (held === undefined) throw new Error('the question was held');
    let clock = NOW.getTime();
    const sleep = async (ms: number): Promise<void> => {
      clock += ms;
      await approvals.answer(held.id, 'session', 'person (Touch ID)', NOW.toISOString());
    };
    const said = await answersArrived({
      home: machine,
      sessionId: 's1',
      now: () => new Date(clock),
      waitMs: 60_000,
      sleep,
    });
    expect(said).toContain('said yes for the rest of this session');
  });
});

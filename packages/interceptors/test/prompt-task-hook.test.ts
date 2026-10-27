import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SessionSubagents,
  SessionTasks,
  SessionTurns,
  SpokenInstructions,
  writePolicyDocumentFile,
} from '@memnox/core';
import { answerPause } from '../src/edit-pause';
import { beforePause } from '../src/in-session';
import { loadHookGate } from '../src/hook-gate-loader';
import { SESSION_MOMENT } from '../src/session-events';

describe('an ask typed into a hooked session', () => {
  it('becomes the session task, and an investigation refuses a change outside the machine', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-prompt-'));
    const rules = join(home, 'rules.toml');
    await mkdir(home, { recursive: true });
    await writePolicyDocumentFile(rules, { version: 1, policies: [] });
    const context = {
      home,
      agent: 'claude-code',
      runSession: undefined,
      pid: 1,
      cwd: home,
      now: () => new Date('2026-09-26T10:00:00.000Z'),
    };
    const said = await beforePause(
      {},
      {
        moment: SESSION_MOMENT.PROMPT,
        sessionId: 'host-1',
        prompt: 'investigate why the payments failed',
      } as never,
      context as never,
      {},
    );
    expect(said).toContain('investigation');
    expect((await new SessionTasks(home).read('host-1'))?.statement).toBe(
      'investigate why the payments failed',
    );

    const gate = await loadHookGate(
      {
        policyFiles: [rules],
        fromRegistry: false,
        agentName: 'claude-code',
        hostSessionId: 'host-1',
      },
      home,
    );
    const refund = gate?.evaluate({
      action: 'mcp.stripe.create_refund',
      toolClass: 'write',
    });
    expect(refund?.effect).toBe('deny');
    expect(
      gate?.evaluate({ action: 'mcp.stripe.list_charges', toolClass: 'read' }).effect,
    ).toBe('allow');
  });
});

describe('a turn in a hooked session', () => {
  it('writes down when the person asked and when the agent handed back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-turn-'));
    let now = new Date('2026-09-26T10:00:00.000Z');
    const context = {
      home,
      agent: 'claude-code',
      runSession: undefined,
      pid: 1,
      cwd: home,
      now: () => now,
    };
    await beforePause(
      {},
      {
        moment: SESSION_MOMENT.PROMPT,
        sessionId: 'host-2',
        prompt: 'add a cancel button',
      } as never,
      context as never,
      {},
    );
    now = new Date('2026-09-26T10:07:00.000Z');
    await beforePause(
      {},
      { moment: SESSION_MOMENT.TURN_END, sessionId: 'host-2', host: 'cursor' } as never,
      context as never,
      {},
    );
    expect(await new SessionTurns(home).all()).toEqual([
      {
        sessionId: 'host-2',
        agent: 'claude-code',
        promptAt: '2026-09-26T10:00:00.000Z',
        endedAt: '2026-09-26T10:07:00.000Z',
        // Each turn kept, so what changed while it worked can be found later.
        windows: [
          { promptAt: '2026-09-26T10:00:00.000Z', endedAt: '2026-09-26T10:07:00.000Z' },
        ],
      },
    ]);
  });
});

describe('helpers a hooked session hands work to', () => {
  it('notes the launch in its own words and each helper by its agent id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-helper-'));
    const context = {
      home,
      agent: 'claude-code',
      runSession: undefined,
      pid: 1,
      cwd: home,
      now: () => new Date('2026-09-26T10:00:00.000Z'),
    };
    const after = { moment: SESSION_MOMENT.AFTER_TOOL, sessionId: 'host-3' } as never;
    await beforePause(
      {
        session_id: 'host-3',
        tool_name: 'Agent',
        tool_input: {
          description: 'fix the flaky test',
          subagent_type: 'general-purpose',
          run_in_background: true,
        },
      },
      after,
      context as never,
      {},
    );
    await beforePause(
      {
        session_id: 'host-3',
        agent_id: 'agent_7',
        agent_type: 'general-purpose',
        tool_name: 'Edit',
      },
      after,
      context as never,
      {},
    );
    const records = await new SessionSubagents(home).of('host-3');
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'launch',
          description: 'fix the flaky test',
          background: true,
        }),
        expect.objectContaining({
          kind: 'activity',
          agentId: 'agent_7',
          lastTool: 'Edit',
          actions: 1,
        }),
      ]),
    );
  });
});

describe('an instruction the person said out loud', () => {
  it('is the next thing a Claude Code session does when its turn ends', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-spoken-'));
    const now = new Date();
    const inbox = new SpokenInstructions(home);
    const instruction = await inbox.propose({
      sessionId: 'host-3',
      agent: 'claude-code',
      message: 'push the voice branch',
      at: now.toISOString(),
    });
    await inbox.queue(instruction, now.toISOString());
    const context = { home, agent: 'claude-code', pid: 1, cwd: home, now: () => now };
    const answer = await answerPause(
      {
        moment: SESSION_MOMENT.TURN_END,
        sessionId: 'host-3',
        host: 'pre-tool-use',
      } as never,
      context as never,
    );
    const reply = JSON.parse(answer) as { decision: string; reason: string };
    expect(reply.decision).toBe('block');
    expect(reply.reason).toContain('It is their own request');
    expect(reply.reason).toContain('push the voice branch');
    // Told once: the next turn end carries on as usual.
    expect(
      await answerPause(
        {
          moment: SESSION_MOMENT.TURN_END,
          sessionId: 'host-3',
          host: 'pre-tool-use',
        } as never,
        context as never,
      ),
    ).toBe('');
  });
});

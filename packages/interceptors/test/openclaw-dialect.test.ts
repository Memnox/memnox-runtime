import { describe, expect, it } from 'vitest';
import { ACTION, DECISION_EFFECT, ENFORCEMENT_MODE, TOOL_CLASS } from '@memnox/core';
import { agentEditsOf, EDIT_HOST, endedSessionOf } from '../src/agent-edits';
import { canonicalPayload } from '../src/openclaw-payload';
import { toolCallOf } from '../src/tool-calls';
import { refusalReply, toolReply, type ToolRuling } from '../src/tool-policy';
import { readsNotesAt, SESSION_MOMENT, sessionEventOf } from '../src/session-events';

/* OpenClaw has no shell hooks, so Memnox's plugin forwards its raw events. These are the
   tool ids and argument names of OpenClaw 2026.10.4, read into the names every reader takes. */

const HOME = '/home/me';

function openClaw(
  event: string,
  tool: string | null = null,
  input: Record<string, unknown> = {},
): unknown {
  return canonicalPayload({
    hook_event_name: event,
    session_id: 'agent:main:telegram:42',
    agent_id: 'main',
    ...(tool === null ? {} : { tool_name: tool, tool_input: input }),
  });
}

const ASK: ToolRuling = {
  action: ACTION.FILESYSTEM_WRITE,
  class: TOOL_CLASS.WRITE,
  effect: DECISION_EFFECT.ASK,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'writes outside the task',
};

describe('OpenClaw before a tool', () => {
  it('rules on exec where its workdir says', () => {
    const call = toolCallOf(
      openClaw('before_tool_call', 'exec', {
        command: 'rm -rf build',
        workdir: '/work/app',
      }),
      HOME,
    );

    expect(call?.host).toBe(EDIT_HOST.OPENCLAW);
    expect(call?.shell).toBe('rm -rf build');
    expect(call?.cwd).toBe('/work/app');
    expect(call?.sessionId).toBe('agent:main:telegram:42');
  });

  it('reads a read by its path, in either spelling OpenClaw still takes', () => {
    for (const input of [
      { path: '~/.aws/credentials' },
      { file_path: '~/.aws/credentials' },
    ]) {
      const call = toolCallOf(openClaw('before_tool_call', 'read', input), HOME);
      expect(call?.requests[0]).toMatchObject({
        action: ACTION.FILESYSTEM_READ,
        target: `${HOME}/.aws/credentials`,
      });
    }
  });

  it('names an MCP tool by its server, though OpenClaw writes no mcp prefix', () => {
    const call = toolCallOf(
      openClaw('before_tool_call', 'github__merge_pull_request', { number: 7 }),
      HOME,
    );

    expect(call?.requests[0]?.action).toBe('mcp.github.merge_pull_request');
  });

  it('takes a lease on each replacement an edit makes', () => {
    const found = agentEditsOf(
      openClaw('before_tool_call', 'edit', {
        path: '/repo/a.ts',
        edits: [
          { oldText: 'a', newText: 'b' },
          { oldText: 'c', newText: 'd' },
        ],
      }),
    );

    expect(found?.host).toBe(EDIT_HOST.OPENCLAW);
    expect(found?.edits[0]).toMatchObject({
      path: '/repo/a.ts',
      change: {
        kind: 'edit',
        replacements: [
          { from: 'a', to: 'b', all: false },
          { from: 'c', to: 'd', all: false },
        ],
      },
    });
  });

  it('takes a lease on every file apply_patch names, from its input', () => {
    const found = agentEditsOf(
      openClaw('before_tool_call', 'apply_patch', {
        input: [
          '*** Begin Patch',
          '*** Update File: src/a.ts',
          '@@',
          '-x',
          '+y',
          '*** Delete File: src/old.ts',
          '*** End Patch',
        ].join('\n'),
      }),
    );

    expect(found?.edits.map((edit) => edit.path)).toEqual(['src/a.ts', 'src/old.ts']);
  });

  it('leaves a tool it does not know unruled, so OpenClaw decides it', () => {
    expect(
      toolCallOf(openClaw('before_tool_call', 'process', { action: 'kill' }), HOME),
    ).toBeNull();
  });

  it('asks through OpenClaw where a person can be asked, and blocks otherwise', () => {
    const call = toolCallOf(
      openClaw('before_tool_call', 'write', { path: '/repo/a.ts', content: 'x' }),
      HOME,
    );
    if (call === null) throw new Error('a write is a tool call');

    expect(JSON.parse(toolReply(call, ASK, true)?.stdout ?? '')).toMatchObject({
      decision: 'ask',
    });
    expect(JSON.parse(toolReply(call, ASK, false)?.stdout ?? '')).toMatchObject({
      decision: 'block',
    });
    expect(JSON.parse(refusalReply(EDIT_HOST.OPENCLAW, 'no').stdout ?? '')).toEqual({
      decision: 'block',
      reason: 'no',
    });
  });
});

describe('OpenClaw pauses', () => {
  it('records a tool that returned, and ends the session at session_end', () => {
    const after = sessionEventOf(openClaw('after_tool_call', 'exec', { command: 'ls' }));

    expect(after).toMatchObject({
      host: EDIT_HOST.OPENCLAW,
      moment: SESSION_MOMENT.AFTER_TOOL,
      tool: 'Bash',
    });
    expect(endedSessionOf(openClaw('session_end'))).toBe('agent:main:telegram:42');
  });

  it('never collects a note, since nothing it forwards is read back by OpenClaw', () => {
    expect(readsNotesAt(EDIT_HOST.OPENCLAW, SESSION_MOMENT.AFTER_TOOL)).toBe(false);
  });

  it('leaves every other host payload exactly as it came', () => {
    const claude = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { path: 'x' },
    };

    expect(canonicalPayload(claude)).toBe(claude);
  });
});

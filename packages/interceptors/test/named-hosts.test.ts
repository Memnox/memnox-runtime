import { describe, expect, it } from 'vitest';
import { ACTION, DECISION_EFFECT, ENFORCEMENT_MODE, TOOL_CLASS } from '@memnox/core';
import { agentEditsOf, agentDenial, EDIT_HOST, endedSessionOf } from '../src/agent-edits';
import { isBorrowedClaudeHook } from '../src/borrowed-hook';
import { namedHostPayload } from '../src/named-hosts';
import {
  readsNotesAt,
  SESSION_MOMENT,
  sessionAnswer,
  sessionEventOf,
} from '../src/session-events';
import { toolCallOf } from '../src/tool-calls';
import { toolReply, type ToolRuling } from '../src/tool-policy';

/* Hosts whose payload alone does not say who sent it: Copilot CLI names no event, Devin
   uses Claude Code's event names, and OpenCode only speaks through Memnox's plugin. */

const HOME = '/home/me';

const ASK: ToolRuling = {
  action: ACTION.FILESYSTEM_WRITE,
  class: TOOL_CLASS.WRITE,
  effect: DECISION_EFFECT.ASK,
  mode: ENFORCEMENT_MODE.ENFORCE,
  reason: 'writes outside the task',
};

function copilot(hostEvent: string, fields: Record<string, unknown>): unknown {
  return namedHostPayload(
    { sessionId: 'cp1', timestamp: 1, cwd: '/repo', ...fields },
    { agent: 'copilot-cli', hostEvent, env: {} },
  );
}

function devin(event: string, fields: Record<string, unknown> = {}): unknown {
  return namedHostPayload(
    { hook_event_name: event, session_id: 'dv1', ...fields },
    { agent: 'devin', env: { DEVIN_PROJECT_DIR: '/work/devin' } },
  );
}

function openCode(event: string, tool: string, input: Record<string, unknown>): unknown {
  return namedHostPayload(
    {
      hook_event_name: event,
      session_id: 'oc1',
      tool_name: tool,
      tool_input: input,
      cwd: '/repo',
    },
    { agent: 'opencode', env: {} },
  );
}

describe('GitHub Copilot CLI', () => {
  it('reads its arguments, even when they arrive as JSON text', () => {
    const call = toolCallOf(
      copilot('copilot:preToolUse', {
        toolName: 'bash',
        toolArgs: '{"command":"git push --force"}',
      }),
      HOME,
    );

    expect(call?.host).toBe(EDIT_HOST.COPILOT);
    expect(call?.shell).toBe('git push --force');
    expect(call?.sessionId).toBe('cp1');
  });

  it('takes a lease on a file it creates, by its path', () => {
    const found = agentEditsOf(
      copilot('copilot:preToolUse', {
        toolName: 'create',
        toolArgs: { path: '/repo/a.ts', file_text: 'x' },
      }),
    );

    expect(found?.host).toBe(EDIT_HOST.COPILOT);
    expect(found?.edits[0]).toMatchObject({
      path: '/repo/a.ts',
      change: { kind: 'write' },
    });
  });

  it('asks in its own words where a person is at the terminal', () => {
    const call = toolCallOf(
      copilot('copilot:preToolUse', {
        toolName: 'create',
        toolArgs: { path: '/repo/a.ts' },
      }),
      HOME,
    );
    if (call === null) throw new Error('a write is a tool call');

    expect(JSON.parse(toolReply(call, ASK, true)?.stdout ?? '')).toEqual({
      permissionDecision: 'ask',
      permissionDecisionReason: expect.stringContaining('writes outside the task'),
    });
    expect(JSON.parse(agentDenial(EDIT_HOST.COPILOT, 'held'))).toMatchObject({
      permissionDecision: 'deny',
    });
  });

  it('records what a tool returned, ends at sessionEnd, and hands it no note it drops', () => {
    const after = sessionEventOf(
      copilot('copilot:postToolUse', {
        toolName: 'bash',
        toolArgs: { command: 'ls' },
        toolResult: { resultType: 'success', textResultForLlm: 'a.ts' },
      }),
    );

    expect(after).toMatchObject({
      host: EDIT_HOST.COPILOT,
      moment: SESSION_MOMENT.AFTER_TOOL,
    });
    expect(endedSessionOf(copilot('copilot:sessionEnd', { reason: 'complete' }))).toBe(
      'cp1',
    );
    expect(readsNotesAt(EDIT_HOST.COPILOT, SESSION_MOMENT.PROMPT)).toBe(false);
  });
});

describe('Devin', () => {
  it('is told apart from Claude Code by the agent its hook names, and works in its project', () => {
    const call = toolCallOf(
      devin('PreToolUse', { tool_name: 'exec', tool_input: { command: 'rm -rf build' } }),
      HOME,
    );

    expect(call?.host).toBe(EDIT_HOST.DEVIN);
    expect(call?.shell).toBe('rm -rf build');
    expect(call?.cwd).toBe('/work/devin');
  });

  it('refuses with the block it reads, having no question of its own', () => {
    const call = toolCallOf(
      devin('PreToolUse', {
        tool_name: 'write',
        tool_input: { path: '/r/a.ts', content: 'x' },
      }),
      HOME,
    );
    if (call === null) throw new Error('a write is a tool call');

    expect(JSON.parse(toolReply(call, ASK, true)?.stdout ?? '')).toMatchObject({
      decision: 'block',
    });
  });

  it('hands a note over at a prompt and a stop, which it reads, and not after a tool', () => {
    const prompt = sessionEventOf(devin('UserPromptSubmit', { prompt: 'fix it' }));
    const stop = sessionEventOf(devin('Stop'));
    if (prompt === null || stop === null) throw new Error('both are pauses');

    expect(JSON.parse(sessionAnswer(prompt, 'a note'))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'a note',
      },
    });
    expect(JSON.parse(sessionAnswer(stop, 'a note'))).toEqual({
      decision: 'block',
      reason: 'a note',
    });
    expect(readsNotesAt(EDIT_HOST.DEVIN, SESSION_MOMENT.AFTER_TOOL)).toBe(false);
    expect(endedSessionOf(devin('SessionEnd'))).toBe('dv1');
  });
});

describe('OpenCode', () => {
  it('reads its camel-case arguments, and leases what an edit replaces', () => {
    const found = agentEditsOf(
      openCode('opencode:tool.execute.before', 'edit', {
        filePath: '/repo/a.ts',
        oldString: 'a',
        newString: 'b',
      }),
    );

    expect(found?.host).toBe(EDIT_HOST.OPENCODE);
    expect(found?.edits[0]).toMatchObject({
      path: '/repo/a.ts',
      change: { kind: 'edit', replacements: [{ from: 'a', to: 'b', all: false }] },
    });
  });

  it('refuses with a block its plugin turns into a thrown error', () => {
    const call = toolCallOf(
      openCode('opencode:tool.execute.before', 'read', {
        filePath: '~/.aws/credentials',
      }),
      HOME,
    );
    if (call === null) throw new Error('a read is a tool call');

    expect(call.requests[0]).toMatchObject({ target: `${HOME}/.aws/credentials` });
    expect(JSON.parse(toolReply(call, ASK, true)?.stdout ?? '')).toMatchObject({
      decision: 'block',
    });
  });
});

describe("Hermes, through Memnox's plugin", () => {
  function hermes(marked: boolean): unknown {
    return {
      hook_event_name: 'pre_tool_call',
      session_id: 'h1',
      tool_name: 'write_file',
      tool_input: { path: '/repo/a.ts', content: 'x' },
      extra: {},
      ...(marked ? { hermes_plugin: true } : {}),
    };
  }

  it("asks through Hermes's approval only when its plugin sent the call", () => {
    const plugin = toolCallOf(hermes(true), HOME);
    const shell = toolCallOf(hermes(false), HOME);
    if (plugin === null || shell === null) throw new Error('both are tool calls');

    expect(JSON.parse(toolReply(plugin, ASK, true)?.stdout ?? '')).toMatchObject({
      decision: 'ask',
    });
    // A shell hook cannot read an ask, so an older install still gets the block it can.
    expect(JSON.parse(toolReply(shell, ASK, true)?.stdout ?? '')).toMatchObject({
      decision: 'block',
    });
  });
});

describe("Claude Code's hook run by another agent", () => {
  const claude = { hook_event_name: 'PreToolUse', tool_name: 'Bash', session_id: 's' };

  it('stands down inside Cursor, Devin and Copilot CLI, which each have their own', () => {
    expect(
      isBorrowedClaudeHook({ ...claude, cursor_version: '2.1' }, 'claude-code', {}),
    ).toBe(true);
    expect(isBorrowedClaudeHook(claude, 'claude-code', { DEVIN_PROJECT_DIR: '/p' })).toBe(
      true,
    );
    expect(
      isBorrowedClaudeHook({ ...claude, timestamp: '2026-10-17' }, 'claude-code', {}),
    ).toBe(true);
  });

  it("keeps ruling for a Claude Code started from those agents' terminals", () => {
    /* Their markers are inherited by anything started from their terminal, so a Claude Code
       run there would otherwise go ungoverned. Claude Code's own hook variable decides. */
    const env = {
      CLAUDE_PROJECT_DIR: '/repo',
      CURSOR_PROJECT_DIR: '/repo',
      DEVIN_PROJECT_DIR: '/p',
    };

    expect(isBorrowedClaudeHook(claude, 'claude-code', env)).toBe(false);
    expect(isBorrowedClaudeHook(claude, 'claude-code', {})).toBe(false);
    expect(isBorrowedClaudeHook(claude, 'cursor', { CURSOR_PROJECT_DIR: '/r' })).toBe(
      false,
    );
  });
});

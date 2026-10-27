import { describe, expect, it } from 'vitest';
import { ACTION } from '@memnox/core';
import { agentEditsOf, agentDenial, EDIT_HOST, endedSessionOf } from '../src/agent-edits';
import { toolCallOf } from '../src/tool-calls';
import { refusalReply } from '../src/tool-policy';
import {
  readsNotesAt,
  SESSION_MOMENT,
  sessionAnswer,
  sessionEventOf,
} from '../src/session-events';

/* Hermes runs as a gateway nobody watches, and its sessions reached the ledger never:
   the vision's circuit breaker and budgets are drawn on Hermes and could not fire for it.
   Its shell hooks send these payloads, in the shape agent/shell_hooks.py writes them. */

const HOME = '/home/me';

function hermes(
  event: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    hook_event_name: event,
    tool_name: null,
    tool_input: null,
    session_id: 'sess_h1',
    cwd: '/repo',
    extra: {},
    ...fields,
  };
}

describe('Hermes before a tool', () => {
  it('rules on a terminal command where its workdir says, not where Hermes runs', () => {
    const call = toolCallOf(
      hermes('pre_tool_call', {
        tool_name: 'terminal',
        tool_input: { command: 'git push --force', workdir: '/work/api' },
      }),
      HOME,
    );

    expect(call?.host).toBe(EDIT_HOST.HERMES);
    expect(call?.shell).toBe('git push --force');
    expect(call?.cwd).toBe('/work/api');
    expect(call?.sessionId).toBe('sess_h1');
  });

  it('reads its file tools as the reads and writes a rule names', () => {
    const read = toolCallOf(
      hermes('pre_tool_call', {
        tool_name: 'read_file',
        tool_input: { path: '~/.ssh/id_ed25519' },
      }),
      HOME,
    );
    const write = toolCallOf(
      hermes('pre_tool_call', {
        tool_name: 'write_file',
        tool_input: { path: 'src/a.ts', content: 'x' },
      }),
      HOME,
    );

    expect(read?.requests[0]).toMatchObject({
      action: ACTION.FILESYSTEM_READ,
      target: `${HOME}/.ssh/id_ed25519`,
    });
    expect(write?.requests[0]).toMatchObject({
      action: ACTION.FILESYSTEM_WRITE,
      target: '/repo/src/a.ts',
    });
  });

  it('reads every page web_extract fetches, each by its host', () => {
    const call = toolCallOf(
      hermes('pre_tool_call', {
        tool_name: 'web_extract',
        tool_input: { urls: ['https://a.example.com/x', 'https://b.example.org/'] },
      }),
      HOME,
    );

    expect(call?.requests.map((each) => each.target)).toEqual([
      'a.example.com',
      'b.example.org',
    ]);
  });

  it('takes a lease on every file a V4A patch writes', () => {
    const found = agentEditsOf(
      hermes('pre_tool_call', {
        tool_name: 'patch',
        tool_input: {
          mode: 'patch',
          patch: [
            '*** Begin Patch',
            '*** Update File: src/billing.ts',
            '@@',
            '-  const limit = 3;',
            '+  const limit = 5;',
            '*** Add File: src/new.ts',
            '+export const x = 1;',
            '*** End Patch',
          ].join('\n'),
        },
      }),
    );

    expect(found?.host).toBe(EDIT_HOST.HERMES);
    expect(found?.edits.map((edit) => edit.path)).toEqual([
      'src/billing.ts',
      'src/new.ts',
    ]);
  });

  it('takes a lease on a replacement in one file', () => {
    const found = agentEditsOf(
      hermes('pre_tool_call', {
        tool_name: 'patch',
        tool_input: { path: '/repo/a.ts', old_string: 'x', new_string: 'y' },
      }),
    );

    expect(found?.edits[0]).toMatchObject({ path: '/repo/a.ts', sessionId: 'sess_h1' });
  });

  it('refuses in the block Hermes reads, both for a rule and for a lease', () => {
    expect(JSON.parse(refusalReply(EDIT_HOST.HERMES, 'not here').stdout ?? '')).toEqual({
      decision: 'block',
      reason: 'not here',
    });
    expect(
      JSON.parse(agentDenial(EDIT_HOST.HERMES, 'claude-code has these lines.')),
    ).toMatchObject({
      decision: 'block',
    });
  });
});

describe('Hermes pauses', () => {
  it('ends a session at finalize, never at the end of a turn', () => {
    /* on_session_end fires every time a turn finishes, so releasing there would let go
       of every lease a long Hermes session holds between two of its own turns. */
    expect(endedSessionOf(hermes('on_session_finalize'))).toBe('sess_h1');
    expect(endedSessionOf(hermes('on_session_end'))).toBeNull();
    expect(sessionEventOf(hermes('on_session_end'))?.moment).toBe(
      SESSION_MOMENT.TURN_END,
    );
  });

  it('records a tool that returned', () => {
    const event = sessionEventOf(
      hermes('post_tool_call', { tool_name: 'terminal', tool_input: { command: 'ls' } }),
    );

    expect(event).toMatchObject({
      host: EDIT_HOST.HERMES,
      moment: SESSION_MOMENT.AFTER_TOOL,
      tool: 'terminal',
      input: { command: 'ls' },
    });
  });

  it("reads the person's words from extra, where Hermes puts them", () => {
    const event = sessionEventOf(
      hermes('pre_llm_call', { extra: { user_message: 'fix checkout' } }),
    );

    expect(event).toMatchObject({
      moment: SESSION_MOMENT.PROMPT,
      prompt: 'fix checkout',
    });
  });

  it('hands a note over only before a model call, the one place Hermes reads one', () => {
    /* A note collected after a tool is marked delivered, and Hermes ignores what a
       post_tool_call hook prints, so it would be lost rather than late. */
    const prompt = sessionEventOf(hermes('pre_llm_call'));
    const afterTool = sessionEventOf(hermes('post_tool_call', { tool_name: 'terminal' }));
    if (prompt === null || afterTool === null) throw new Error('both are pauses');

    expect(JSON.parse(sessionAnswer(prompt, 'a note'))).toEqual({ context: 'a note' });
    expect(sessionAnswer(afterTool, 'a note')).toBe('');
    expect(readsNotesAt(EDIT_HOST.HERMES, SESSION_MOMENT.PROMPT)).toBe(true);
    expect(readsNotesAt(EDIT_HOST.HERMES, SESSION_MOMENT.AFTER_TOOL)).toBe(false);
    expect(readsNotesAt(EDIT_HOST.HERMES, SESSION_MOMENT.TURN_END)).toBe(false);
  });
});

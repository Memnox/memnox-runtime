import { describe, expect, it } from 'vitest';
import { delegationChain } from '@memnox/core';
import { activityOf, sessionEventOf } from '../src/session-events';
import { toolCallOf } from '../src/tool-calls';
import { toolEventFor } from '../src/tool-policy';

const HOME = '/home/dev';
const AT = '2026-10-03T09:00:00.000Z';

/* Claude Code sets `agent_id` and `agent_type` on a helper's own calls and leaves them
   off the main turn's. Without reading them every row in a session busy through three
   helpers reads as one agent doing everything, and `why` cannot say which one did it. */
const fromHelper = {
  hook_event_name: 'PreToolUse',
  session_id: 'ses_1',
  cwd: '/work/app',
  tool_name: 'Bash',
  tool_input: { command: 'git push --force' },
  agent_id: 'a1b2c3d4e5f6',
  agent_type: 'general-purpose',
};

describe('who a tool call was handed to', () => {
  it('reads the helper off the hook, and puts it on the verdict row', () => {
    const call = toolCallOf(fromHelper, HOME);
    expect(call?.delegation).toEqual({
      subagent: 'a1b2c3d4e5f6',
      subagentType: 'general-purpose',
    });
    if (call === null) throw new Error('expected a call');

    const row = toolEventFor(
      call,
      {
        action: 'git.push',
        class: 'destructive',
        effect: 'deny',
        mode: 'enforce',
        reason: 'force push',
      },
      { agent: 'claude-code', sessionId: 'ses_1', at: AT },
    );
    expect(row).toMatchObject({
      subagent: 'a1b2c3d4e5f6',
      subagentType: 'general-purpose',
    });
  });

  it('leaves the main turn unattributed rather than inventing a helper', () => {
    const { agent_id: _id, agent_type: _type, ...main } = fromHelper;
    expect(toolCallOf(main, HOME)?.delegation).toBeUndefined();
  });

  it('files a helper edit under the helper too', () => {
    const edit = sessionEventOf({
      hook_event_name: 'PostToolUse',
      session_id: 'ses_1',
      tool_name: 'Edit',
      tool_input: { file_path: '/work/app/src/a.ts' },
      agent_id: 'a1b2c3d4e5f6',
      agent_type: 'Explore',
    });
    if (edit === null) throw new Error('expected an event');
    const [row] = activityOf(edit, 'claude-code', '/work/app', AT);
    expect(row).toMatchObject({ subagent: 'a1b2c3d4e5f6', subagentType: 'Explore' });
  });
});

describe('the chain a row is read back as', () => {
  it('names the person, the agent and the helper, leaving out what is not known', () => {
    expect(
      delegationChain({
        agent: 'claude-code',
        principal: 'ada',
        subagent: 'a1b2c3d4e5f6',
        subagentType: 'Explore',
      }),
    ).toBe('ada > claude-code > Explore subagent a1b2c3d4');
    expect(delegationChain({ agent: 'claude-code' })).toBe('claude-code');
  });
});

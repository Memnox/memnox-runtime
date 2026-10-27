import {
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  LocalGate,
  policiesFrom,
  recommendedAnswers,
} from '@memnox/core';
import { describe, expect, it } from 'vitest';

import { HookAuthorizer } from '../src/hook-authorizer';
import { toolCallOf } from '../src/tool-calls';
import { ruleOnTool, type ToolRuling } from '../src/tool-policy';

/** One MCP database call through an editor's hook, under the rules `memnox protect` writes. */
async function hooked(tool: string, input: Record<string, unknown>): Promise<ToolRuling> {
  const call = toolCallOf(
    {
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input: input,
      session_id: 's1',
    },
    '/home/agent',
  );
  if (call === null) throw new Error('no call');
  const gate = new LocalGate(policiesFrom(recommendedAnswers()), {
    agentName: 'claude-code',
  });
  return ruleOnTool(call, {
    authorizer: new HookAuthorizer({ gate }),
    mode: ENFORCEMENT_MODE.ENFORCE,
    env: {},
  });
}

describe('a database statement through an MCP tool, at the hook', () => {
  it('holds a DELETE with no WHERE under the tool’s own name, naming the bounded one', async () => {
    const ruling = await hooked('mcp__postgres__query', { sql: 'DELETE FROM users' });

    expect(ruling.effect).toBe(DECISION_EFFECT.ASK);
    expect(ruling.action).toBe('mcp.postgres.query');
    expect(ruling.alternative?.note).toContain('users');
  });

  it('lets a bounded DELETE on a local database file through', async () => {
    const ruling = await hooked('mcp__sqlite__execute_query', {
      query: 'DELETE FROM users WHERE id = 4',
    });

    expect(ruling.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('keeps asking where the call names somebody else’s host, or names none', async () => {
    const remote = await hooked('mcp__postgres__query', {
      sql: 'DELETE FROM users WHERE id = 4',
      connectionString: 'postgresql://db.acme.io/app',
    });
    const unnamed = await hooked('mcp__postgres__query', {
      sql: 'DELETE FROM users WHERE id = 4',
    });

    expect(remote.effect).toBe(DECISION_EFFECT.ASK);
    expect(unnamed.effect).toBe(DECISION_EFFECT.ASK);
  });
});

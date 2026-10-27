import { describe, expect, it } from 'vitest';

import { requestsFor } from '../src/actions';
import { wrapClaudeAgentQuery } from '../src/claude-agent-sdk';
import { Guard } from '../src/guard';
import { guardAgentsTools } from '../src/openai-agents';
import { ToolRefused, wrapTool } from '../src/wrap';

/** A file the recommended rules refuse to read, so a refusal needs no workspace rules. */
const CREDENTIALS_FILE = '/home/agent/.aws/credentials';
import type { BundleFetch, CloudPort, HeldRaised, HeldState } from '../src/cloud';

/** A plane that is never reached in these tests: every verdict here is decided locally. */
class SilentCloud implements CloudPort {
  async bundle(): Promise<BundleFetch | null> {
    return null;
  }
  async raise(): Promise<HeldRaised> {
    throw new Error('not asked here');
  }
  async status(id: string): Promise<HeldState> {
    return { id, status: 'pending' };
  }
  async keys(): Promise<[]> {
    return [];
  }
  async record(): Promise<void> {}
  async resumedSince(): Promise<boolean> {
    return false;
  }
}

describe('a tool call as the actions a rule is written against', () => {
  it('names an MCP tool both ways the runtime does', () => {
    const actions = requestsFor('mcp__stripe__create_refund', { amount: 4200 }).map(
      (each) => each.action,
    );
    expect(actions).toEqual(['mcp.stripe.create_refund', 'mcp.create_refund']);
  });

  it('splits an MCP name at the first separator, and a hostile one at once', () => {
    const actions = requestsFor('mcp__github__repos__list', {}).map(
      (each) => each.action,
    );
    expect(actions).toEqual(['mcp.github.repos__list', 'mcp.repos__list']);
    // The shape CodeQL found could make a backtracking pattern slow, split like any other name.
    const hostile = `mcp__a__${'a__a'.repeat(50_000)}`;
    expect(requestsFor(hostile, {})[0]?.action).toBe(`mcp.a.${'a__a'.repeat(50_000)}`);
  });

  it('reads a DELETE with no WHERE inside a shell command as unbounded', () => {
    const [request] = requestsFor('Bash', {
      command: 'psql $DATABASE_URL -c "DELETE FROM orders"',
    });
    expect(request?.action).toBe('psql.delete-unbounded');
  });

  it('resolves a CLI by its verb table, as on a laptop', () => {
    const [request] = requestsFor('Bash', { command: 'gh pr merge 412 --squash' });
    expect(request?.action.startsWith('gh.')).toBe(true);
    expect(request?.action).not.toBe('shell.execute');
  });

  it('rules on a relative write as the whole path under the working directory', () => {
    const [request] = requestsFor(
      'Write',
      { file_path: 'src/app.ts' },
      { cwd: '/srv/shop' },
    );
    expect(request).toMatchObject({
      action: 'filesystem.write',
      target: '/srv/shop/src/app.ts',
    });
  });

  it('names a framework function tool under tool.', () => {
    const [request] = requestsFor('issue_refund', { order: '4417' });
    expect(request?.action).toBe('tool.issue_refund');
  });
});

describe('the Claude Agent SDK, wrapped', () => {
  it('adds Memnox beside the hooks the caller already set and refuses a call through the hook', async () => {
    const guard = new Guard(new SilentCloud(), { agent: 'support-bot' }).start();
    const own = { hooks: [async (): Promise<object> => ({})] };
    let seen: {
      options?: {
        hooks?: Record<
          string,
          { hooks: ((input: unknown) => Promise<object>)[] }[] | undefined
        >;
      };
    } = {};
    const query = wrapClaudeAgentQuery((params: typeof seen & { prompt: unknown }) => {
      seen = params;
      return 'running';
    }, guard);

    expect(
      query({ prompt: 'refund order 4417', options: { hooks: { PreToolUse: [own] } } }),
    ).toBe('running');
    const before = seen.options?.hooks?.['PreToolUse'] ?? [];
    expect(before).toHaveLength(2);
    expect(before[0]).toBe(own);

    const memnox = before[1]?.hooks[0];
    const refused = await memnox?.({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/home/agent/.aws/credentials' },
      session_id: 's1',
    });
    expect(refused).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    const allowed = await memnox?.({
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__linear__list_issues',
      tool_input: {},
      session_id: 's1',
    });
    expect(allowed).toEqual({});
  });
});

describe('any function a framework calls a tool, wrapped', () => {
  it('runs an allowed call and throws a refusal a framework can show', async () => {
    const guard = new Guard(new SilentCloud(), { agent: 'ops-bot' }).start();
    const ran: string[] = [];
    const read = wrapTool(
      guard,
      'Read',
      async (input: { file_path: string }) => {
        ran.push(input.file_path);
        return 'contents';
      },
      { session: () => 's1' },
    );
    await expect(read({ file_path: '/srv/app/README.md' })).resolves.toBe('contents');
    await expect(read({ file_path: CREDENTIALS_FILE })).rejects.toBeInstanceOf(
      ToolRefused,
    );
    expect(ran).toEqual(['/srv/app/README.md']);
  });
});

describe('the OpenAI Agents SDK, wrapped', () => {
  it('answers a refused call with the reason as the tool output, never running it', async () => {
    const guard = new Guard(new SilentCloud(), { agent: 'support-bot' }).start();
    let invoked = 0;
    const [read] = guardAgentsTools(
      [
        {
          type: 'function' as const,
          name: 'Read',
          invoke: async (_run: { id: string }, _input: string): Promise<string> => {
            invoked += 1;
            return 'contents';
          },
        },
      ],
      guard,
      { session: (run: { id: string }) => run.id },
    );
    const refused = await read?.invoke(
      { id: 'run_1' },
      JSON.stringify({ file_path: CREDENTIALS_FILE }),
    );
    expect(String(refused)).toContain('Memnox refused this');
    expect(invoked).toBe(0);
    await expect(
      read?.invoke({ id: 'run_1' }, JSON.stringify({ file_path: '/srv/app/README.md' })),
    ).resolves.toBe('contents');
    expect(invoked).toBe(1);
  });
});

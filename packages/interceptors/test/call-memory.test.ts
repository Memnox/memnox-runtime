import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMORY_SOURCE_KIND, SqliteMemoryStore } from '@memnox/core';
import { keepMcpResult } from '../src/call-memory';

const NOW = new Date('2026-10-31T09:00:00.000Z');

function after(tool: string, response: unknown): unknown {
  return { hook_event_name: 'PostToolUse', tool_name: tool, tool_response: response };
}

describe("an MCP result kept in the person's own memory", () => {
  it('keeps what an MCP server answered, by server, agent and session, and never a Memnox tool', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-call-memory-'));
    const context = { home, agent: 'claude-code', sessionId: 's9', now: () => NOW };
    expect(
      await keepMcpResult(
        after('mcp__linear__get_issue', {
          content: [{ type: 'text', text: 'Retries live in billing.' }],
        }),
        context,
      ),
    ).toBe(true);
    expect(
      await keepMcpResult(after('mcp__memnox-session__app_run', 'anything'), context),
    ).toBe(false);
    expect(await keepMcpResult(after('Read', 'a file'), context)).toBe(false);
    const store = SqliteMemoryStore.forHome(home);
    const sources = store.sources();
    store.close();
    expect(sources.map((each) => [each.kind, each.name])).toEqual([
      [MEMORY_SOURCE_KIND.MCP_CALLS, 'linear'],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { mcpToolParts, withoutLeading, withoutTrailing } from '../src/domain/plain-text';

describe('text taken apart by index', () => {
  it('drops every copy of one character at the end, and only there', () => {
    expect(withoutTrailing('src/billing///', '/')).toBe('src/billing');
    expect(withoutTrailing('/a/b', '/')).toBe('/a/b');
    expect(withoutTrailing('///', '/')).toBe('');
    expect(withoutTrailing('C:\\memnox\\bin\\\\', '\\')).toBe('C:\\memnox\\bin');
  });

  it('drops a run of any of several characters, at either end', () => {
    expect(withoutTrailing('Not now!?.', '.!?')).toBe('Not now');
    expect(withoutLeading('[[servers]]', '[')).toBe('servers]]');
    expect(withoutLeading('---', '-')).toBe('');
    expect(withoutLeading('a-b', '-')).toBe('a-b');
  });

  it('takes a long run in time linear in its length', () => {
    const run = '-'.repeat(200_000);
    expect(withoutTrailing(`a${run}`, '-')).toBe('a');
    expect(withoutLeading(`${run}a`, '-')).toBe('a');
  });

  it('splits an MCP tool name at the first separator after its server', () => {
    expect(mcpToolParts('mcp__stripe__create_refund')).toEqual({
      server: 'stripe',
      name: 'create_refund',
    });
    expect(mcpToolParts('mcp__github__repos__list')).toEqual({
      server: 'github',
      name: 'repos__list',
    });
  });

  it('takes no name for an MCP tool that is not one', () => {
    expect(mcpToolParts('Bash')).toBeNull();
    expect(mcpToolParts('mcp__stripe')).toBeNull();
    expect(mcpToolParts('mcp__stripe__')).toBeNull();
    expect(mcpToolParts('mcp____tool')).toBeNull();
  });
});

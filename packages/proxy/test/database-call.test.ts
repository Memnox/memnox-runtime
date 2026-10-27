import {
  DECISION_EFFECT,
  LocalGate,
  policiesFrom,
  recommendedAnswers,
} from '@memnox/core';
import { describe, expect, it } from 'vitest';

import { LocalGateAuthorizer } from '../src/call-authorizer';
import { readToolCall } from '../src/tool-call';

const LOCAL = [
  'npx',
  '-y',
  '@modelcontextprotocol/server-postgres',
  'postgresql://localhost/app',
];
const REMOTE = [
  'npx',
  '-y',
  '@modelcontextprotocol/server-postgres',
  'postgresql://db.acme.io/app',
];

/** The rules `memnox protect` writes when nobody changes an answer. */
function proxyFor(command: string[]): LocalGateAuthorizer {
  const gate = new LocalGate(policiesFrom(recommendedAnswers()), {
    agentName: 'claude-code',
  });
  return new LocalGateAuthorizer(gate, 'postgres', undefined, undefined, { command });
}

function query(sql: string): ReturnType<typeof readToolCall> {
  return readToolCall({ name: 'query', arguments: { sql } });
}

describe('a database statement through a proxied MCP tool, under the default rules', () => {
  it('holds a DELETE with no WHERE and names the bounded one on its table', async () => {
    const verdict = await proxyFor(LOCAL).authorize(query('DELETE FROM users'));

    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.alternative?.note).toContain('WHERE');
    expect(verdict.alternative?.note).toContain('users');
  });

  it('holds an UPDATE with no WHERE the same way', async () => {
    const verdict = await proxyFor(LOCAL).authorize(
      query("UPDATE orders SET state = 'x'"),
    );

    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.alternative?.note).toContain('orders');
  });

  it('lets a bounded DELETE on a local database through', async () => {
    const verdict = await proxyFor(LOCAL).authorize(
      query('DELETE FROM users WHERE id = 4'),
    );

    expect(verdict.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('keeps asking about a bounded DELETE on somebody else’s database', async () => {
    const remote = await proxyFor(REMOTE).authorize(
      query('DELETE FROM users WHERE id = 4'),
    );
    // Nothing in the call says whose database it is, so it is not taken to be this machine's.
    const unknown = await proxyFor(['npx', 'supabase-mcp']).authorize(
      query('DELETE FROM users WHERE id = 4'),
    );

    expect(remote.effect).toBe(DECISION_EFFECT.ASK);
    expect(unknown.effect).toBe(DECISION_EFFECT.ASK);
  });

  it('does not let an agent name its own statement to slip past the MCP rule', async () => {
    const verdict = await proxyFor(LOCAL).authorize(
      readToolCall({
        name: 'create_issue',
        arguments: { title: 'x', memnox_statement: 'insert' },
      }),
    );

    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
  });
});

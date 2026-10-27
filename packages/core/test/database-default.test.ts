import { describe, expect, it } from 'vitest';
import { DECISION_EFFECT } from '../src/constants/decision.constants';
import { alternativeFor, describeAlternative } from '../src/gate/refusal-text';
import { resolveCommand } from '../src/intercept/command-action';
import { boundedAlternative, inspectMongo, inspectSql } from '../src/intercept/sql';
import { policiesFrom, recommendedAnswers } from '../src/policy/domains';
import { PolicyEngine } from '../src/policy/policy-engine';

const CONTEXT = { agentName: 'claude-code' };
const engine = new PolicyEngine(policiesFrom(recommendedAnswers()));

/** One command line through the resolver and the baseline, as the shell seam rules it. */
function rule(args: string[], env: NodeJS.ProcessEnv = {}) {
  const resolved = resolveCommand('psql', args, env);
  const line = ['psql', ...args].join(' ');
  const verdict = engine.evaluate(
    {
      action: resolved.action,
      toolClass: String(resolved.class),
      target: resolved.target ?? line,
    },
    CONTEXT,
  );
  const alternative = alternativeFor(
    verdict.alternative,
    resolved.alternative,
    resolved.action,
  );
  return { resolved, verdict, alternative };
}

describe('the database baseline holds every row and lets a bounded write through', () => {
  it('asks about a DELETE with no WHERE and names the table in the way forward', () => {
    const { resolved, verdict, alternative } = rule(['-c', 'DELETE FROM orders']);
    expect(resolved.action).toBe('psql.delete-unbounded');
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.rule?.name).toBe('database-ask');
    const instead = describeAlternative(alternative ?? { action: '', note: '' });
    expect(instead).toContain('Instead:');
    expect(instead).toContain('a WHERE to the DELETE on orders');
    expect(instead).toContain('only the test orders');
  });

  it('does not hold the same delete bounded to the test orders', () => {
    const { resolved, verdict } = rule([
      '-c',
      "DELETE FROM orders WHERE customer_email LIKE '%@test.example'",
    ]);
    expect(resolved.action).toBe('psql.delete');
    expect(verdict.effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it('asks about TRUNCATE, DROP and an UPDATE of every row', () => {
    for (const statement of [
      'TRUNCATE orders',
      'DROP TABLE orders',
      'UPDATE orders SET status = 1',
    ]) {
      expect(rule(['-c', statement]).verdict.effect, statement).toBe(DECISION_EFFECT.ASK);
    }
  });

  it('still asks about a schema change and a session nothing could read', () => {
    expect(rule(['-c', 'ALTER TABLE orders ADD COLUMN x int']).verdict.effect).toBe(
      DECISION_EFFECT.ASK,
    );
    expect(rule(['-d', 'app']).verdict.effect).toBe(DECISION_EFFECT.ASK);
  });

  it('asks about a bounded write on a database another host runs', () => {
    const { verdict } = rule([
      '-h',
      'db.prod.example.com',
      '-c',
      'DELETE FROM orders WHERE id = 1',
    ]);
    expect(verdict.effect).toBe(DECISION_EFFECT.ASK);
    expect(verdict.rule?.name).toBe('remote-database-ask');
  });

  it('lets a read through', () => {
    expect(rule(['-c', 'SELECT * FROM orders']).verdict.effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });
});

describe('the way forward from a statement that takes every row', () => {
  it('names a schema qualified table as written', () => {
    expect(inspectSql('DELETE FROM shop.orders').table).toBe('shop.orders');
    expect(inspectSql('TRUNCATE TABLE IF_ONLY').table).toBe('IF_ONLY');
    expect(inspectSql('DROP TABLE IF EXISTS orders').table).toBe('orders');
  });

  it('leaves out a quoted name rather than guessing at it', () => {
    expect(inspectSql('DELETE FROM "Orders"').table).toBeUndefined();
    expect(boundedAlternative(inspectSql('DELETE FROM "Orders"'))).toContain(
      'on that table',
    );
  });

  it('speaks of a filter to mongosh', () => {
    const finding = inspectMongo('db.orders.deleteMany({})');
    expect(finding.table).toBe('orders');
    expect(boundedAlternative(finding, 'mongo')).toContain('add a filter');
  });

  it('names nothing for a bounded write, which needs no redirect', () => {
    expect(boundedAlternative(inspectSql('DELETE FROM orders WHERE id = 1'))).toBeNull();
  });
});

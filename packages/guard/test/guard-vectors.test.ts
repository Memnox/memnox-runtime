import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PolicyEngine,
  policiesFromBundle,
  type EvaluationResult,
  type PublishedBundle,
} from '@memnox/core/engine';

import { requestsFor } from '../src/actions';

/**
 * The decisions every guard must reach on the same bundle, written to `vectors/guard-decisions.json`
 * so the Python guard is held to the TypeScript one. Run with MEMNOX_WRITE_VECTORS=1 to rewrite it.
 */

const COMMITTED = fileURLToPath(
  new URL('../../../vectors/guard-decisions.json', import.meta.url),
);

const STRICTNESS: Readonly<Record<string, number>> = { allow: 0, ask: 1, deny: 2 };

// A fixed seed, since an Ed25519 signature over the same bytes with the same key never changes.
const SEED = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');

const BUNDLE: PublishedBundle = {
  hash: 'vectors-1',
  rules: [
    {
      id: 'no-refunds',
      effect: 'deny',
      match: 'mcp.stripe.create_refund',
      reason: 'refunds go through finance',
    },
    {
      id: 'ask-linear',
      effect: 'ask',
      match: 'mcp.linear.*',
      reason: 'a person checks tracker changes',
    },
    { id: 'reads-run', effect: 'allow', match: 'mcp.*.list_*' },
    {
      id: 'support-no-mail',
      effect: 'deny',
      match: 'tool.send_email',
      agents: ['support-bot'],
    },
    { id: 'ask-exports', effect: 'ask', match: 'tool.export_*', targets: ['!internal'] },
    {
      id: 'no-deploys',
      effect: 'deny',
      match: 'tool.deploy',
      unless: [{ agents: ['release-bot'] }],
    },
    {
      id: 'watch-cleanup',
      effect: 'deny',
      match: 'tool.cleanup',
      decision: { effect: 'deny', mode: 'observe' },
    },
    {
      id: 'admins-wipe',
      effect: 'allow',
      match: 'tool.wipe',
      conditions: { roles: ['admin'] },
    },
    { id: 'no-wipe', effect: 'ask', match: 'tool.wipe' },
  ],
};

interface DecisionVector {
  name: string;
  agent: string;
  tool: string;
  input: Record<string, unknown>;
  effect: string;
  rule: string | null;
}

const CASES: Omit<DecisionVector, 'effect' | 'rule'>[] = [
  {
    name: 'a denied refund',
    agent: 'support-bot',
    tool: 'mcp__stripe__create_refund',
    input: { amount: 4200 },
  },
  {
    name: 'case does not slip a rule',
    agent: 'support-bot',
    tool: 'mcp__Stripe__Create_Refund',
    input: {},
  },
  {
    name: 'a tracker write asks',
    agent: 'support-bot',
    tool: 'mcp__linear__create_issue',
    input: { title: 'x' },
  },
  {
    name: 'the stricter of two rules wins',
    agent: 'support-bot',
    tool: 'mcp__linear__list_issues',
    input: {},
  },
  {
    name: 'a read elsewhere runs',
    agent: 'support-bot',
    tool: 'mcp__github__list_repos',
    input: {},
  },
  {
    name: 'a rule for one agent',
    agent: 'support-bot',
    tool: 'send_email',
    input: { to: 'a' },
  },
  {
    name: 'and not for another',
    agent: 'sales-bot',
    tool: 'send_email',
    input: { to: 'a' },
  },
  {
    name: 'an invisible character is not a bypass',
    agent: 'support-bot',
    tool: 'send_email​',
    input: {},
  },
  {
    name: 'an exclusion only list still holds',
    agent: 'sales-bot',
    tool: 'export_report',
    input: {},
  },
  {
    name: 'a carve out lets its agent through',
    agent: 'release-bot',
    tool: 'deploy',
    input: {},
  },
  { name: 'and nobody else', agent: 'ci-bot', tool: 'deploy', input: {} },
  { name: 'an observed rule never decides', agent: 'ci-bot', tool: 'cleanup', input: {} },
  {
    name: 'a role nobody reported matches nothing',
    agent: 'ci-bot',
    tool: 'wipe',
    input: {},
  },
  {
    name: 'nothing matched runs',
    agent: 'ci-bot',
    tool: 'lookup_order',
    input: { order: '4417' },
  },
];

function decided(
  engine: PolicyEngine,
  agent: string,
  tool: string,
  input: Record<string, unknown>,
): EvaluationResult | null {
  const results = requestsFor(tool, input).map((request) =>
    engine.evaluate({ ...request, principal: agent }, { agentName: agent }),
  );
  return results.reduce<EvaluationResult | null>(
    (worst, next) =>
      worst === null || (STRICTNESS[next.effect] ?? 0) > (STRICTNESS[worst.effect] ?? 0)
        ? next
        : worst,
    null,
  );
}

function vectors(): string {
  const engine = new PolicyEngine(policiesFromBundle(BUNDLE));
  const decisions: DecisionVector[] = CASES.map((each) => {
    const result = decided(engine, each.agent, each.tool, each.input);
    return { ...each, effect: result?.effect ?? 'allow', rule: result?.rule?.id ?? null };
  });
  const body = JSON.stringify(BUNDLE);
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, SEED]),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = {
    keyId: 'k-vectors',
    publicKey: createPublicKey(key)
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    body,
    signature: `k-vectors:${sign(null, Buffer.from(body, 'utf8'), key).toString('base64')}`,
  };
  return `${JSON.stringify({ version: 1, bundle: BUNDLE, signature, decisions }, null, 2)}\n`;
}

describe('the shared guard decision vectors', () => {
  it('match the committed file, so the Python guard is held to the same decisions', () => {
    const fresh = vectors();
    if (process.env['MEMNOX_WRITE_VECTORS'] === '1') writeFileSync(COMMITTED, fresh);
    expect(readFileSync(COMMITTED, 'utf8')).toBe(fresh);
  });
});

import { describe, expect, it } from 'vitest';
import { DECISION_EFFECT, LocalGate, type Policy } from '@memnox/core';
import { LocalGateAuthorizer } from '../src/call-authorizer';

/** A rule scoped to one project decides an MCP call only in the project the proxy was started in. */
describe('the proxy naming its project', () => {
  const rule: Policy = {
    name: 'billing-keeps-github-read-only',
    project: 'billing-pack',
    match: { actions: ['*'], targets: ['github'] },
    decision: {
      effect: DECISION_EFFECT.DENY,
      reason: 'billing changes go through release',
    },
  };
  const gate = new LocalGate([rule], { agentName: 'claude-code' });
  const call = { name: 'create_issue', arguments: {} };

  it('lets the rule decide a call made in that project', async () => {
    const inBilling = new LocalGateAuthorizer(
      gate,
      'github',
      'ses_mcp',
      undefined,
      {},
      'billing-pack',
    );
    expect((await inBilling.authorize(call)).effect).toBe(DECISION_EFFECT.DENY);
  });

  it('leaves a call made anywhere else to the rest of the rules', async () => {
    const elsewhere = new LocalGateAuthorizer(gate, 'github', 'ses_mcp');
    expect((await elsewhere.authorize(call)).effect).toBe(DECISION_EFFECT.ALLOW);
  });

  it("lets a rule held to a repository's folders decide a call made there", async () => {
    const repository = new LocalGate(
      [
        {
          name: 'backend-profile-keeps-github-read-only',
          match: {
            actions: ['*'],
            targets: ['github'],
            workingDirectories: ['/work/billing', '/work/billing/*'],
          },
          decision: { effect: DECISION_EFFECT.DENY, reason: 'from the profile' },
        },
      ],
      { agentName: 'claude-code' },
    );
    const started = (cwd: string): LocalGateAuthorizer =>
      new LocalGateAuthorizer(repository, 'github', 'ses_mcp', undefined, { cwd });
    expect((await started('/work/billing/api').authorize(call)).effect).toBe(
      DECISION_EFFECT.DENY,
    );
    expect((await started('/work/other').authorize(call)).effect).toBe(
      DECISION_EFFECT.ALLOW,
    );
  });
});

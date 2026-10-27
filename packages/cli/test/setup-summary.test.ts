import { describe, expect, it } from 'vitest';
import { describePlane } from '../src/commands/setup/summary';

describe('where an agent onboarded elsewhere belongs', () => {
  it('never calls another workspace yours, even when its id is too long to read', () => {
    const elsewhere = describePlane({
      workspaceId: '261d19cf-8925-4e71-9cfd-dc78475c4c4b',
      baseUrl: 'https://api.memnox.com',
    });
    expect(elsewhere).toBe('under another workspace, 261d19cf at https://api.memnox.com');
    expect(describePlane({ workspaceId: 'acme' })).toBe('under the workspace acme');
    expect(describePlane({})).toBe('under another workspace');
  });
});

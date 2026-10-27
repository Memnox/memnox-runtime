import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askBroker } from '@memnox/interceptors';
import { describe, expect, it } from 'vitest';
import { startBroker } from '../src/commands/run/credential-broker';

/* The two halves over a real socket: what the interceptor in front of `gh` is handed,
   and what anything asking for a binary nobody mapped is handed, which is nothing. */
describe('the session credential broker', () => {
  it('hands each binary only its own variables, and leaves no socket behind', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-broker-'));
    const broker = await startBroker(home, 'ses_1', {
      GITHUB_TOKEN: 'ghp_1',
      AWS_SECRET_ACCESS_KEY: 'secret',
    });
    try {
      expect(await askBroker(broker.path, 'gh')).toEqual({ GITHUB_TOKEN: 'ghp_1' });
      expect(await askBroker(broker.path, 'curl')).toEqual({});
      expect(await askBroker(broker.path, '../gh')).toEqual({});
    } finally {
      await broker.close();
    }
    expect(existsSync(broker.path)).toBe(false);
    // Asked after it closed, the answer is nothing rather than a hang.
    expect(await askBroker(broker.path, 'gh', 100)).toEqual({});
  });
});

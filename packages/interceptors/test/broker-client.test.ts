import { BROKER_VAR } from '@memnox/core';
import { describe, expect, it } from 'vitest';
import { brokeredEnvironment, variablesIn } from '../src/broker-client';

describe('the environment a fronted binary runs with', () => {
  it('adds what the broker hands this binary, and drops the broker’s address', async () => {
    const asked: string[] = [];
    const env = await brokeredEnvironment(
      { PATH: '/usr/bin', [BROKER_VAR]: '/s.sock' },
      'gh',
      async (path, binary) => {
        asked.push(`${path} ${binary}`);
        return { GITHUB_TOKEN: 'ghp_1' };
      },
    );
    expect(asked).toEqual(['/s.sock gh']);
    expect(env).toEqual({ PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_1' });
  });

  it('asks nobody when the session holds nothing', async () => {
    const env = { PATH: '/usr/bin' };
    expect(
      await brokeredEnvironment(env, 'gh', async () => {
        throw new Error('should not ask');
      }),
    ).toBe(env);
  });
});

describe('a reply from the broker', () => {
  it('keeps string values and refuses anything malformed', () => {
    expect(variablesIn('{"variables":{"A":"1","B":2}}')).toEqual({ A: '1' });
    expect(variablesIn('{"variables":null}')).toEqual({});
    expect(variablesIn('garbage')).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import {
  nodeSecretStore,
  SECRET_SERVICE,
  type StoreRunner,
} from '../src/mcp/node-secret-store';

interface Call {
  command: string;
  args: readonly string[];
  input?: string;
}

function recording(answer: { code: number; stdout: string } = { code: 0, stdout: '' }): {
  calls: Call[];
  run: StoreRunner;
} {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command, args, input) => {
      calls.push({ command, args, ...(input === undefined ? {} : { input }) });
      return answer;
    },
  };
}

// Assembled at runtime so no literal credential sits in the repository.
const VALUE = ['ghp', 'example', 'value'].join('_');

describe('the OS secret store', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    it(`never puts the value in the arguments on ${platform}`, async () => {
      const { calls, run } = recording();
      await nodeSecretStore('/home/me', platform, run).set('github-token', VALUE);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.join(' ')).not.toContain(VALUE);
      expect(calls[0]?.input).toContain(VALUE);
    });
  }

  it('files every secret under Memnox’s own service on the keychain', async () => {
    const { calls, run } = recording({ code: 0, stdout: `${VALUE}\n` });
    const value = await nodeSecretStore('/home/me', 'darwin', run).get('github-token');
    expect(value).toBe(VALUE);
    expect(calls[0]?.args).toEqual([
      'find-generic-password',
      '-s',
      SECRET_SERVICE,
      '-a',
      'github-token',
      '-w',
    ]);
  });

  it('reads a secret it does not hold as absent rather than empty', async () => {
    const { run } = recording({ code: 44, stdout: '' });
    expect(
      await nodeSecretStore('/home/me', 'linux', run).get('github-token'),
    ).toBeUndefined();
  });

  it('refuses a name that could reach a shell or a path', async () => {
    const { calls, run } = recording();
    await expect(
      nodeSecretStore('/home/me', 'win32', run).set('../evil', VALUE),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

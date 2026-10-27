import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionHost } from '@memnox/core';
import { proxyUrlFor, type EgressProxy } from '@memnox/interceptors';
import { DaemonEgress } from '../src/daemon/egress';
import { proxyEnvironment } from '../src/commands/run/network';
import { proxyPortIn, strandedEgressPorts } from '../src/daemon/stranded-egress';

const SESSION = 'ses_347ad990-ffa';

/** The environment a run gave its agent, as `ps -E` prints it after the command. */
function environmentFor(port: number, sessionId = SESSION): string {
  const variables = proxyEnvironment(
    proxyUrlFor(port, { sessionId, agent: 'claude-code' }),
  );
  const pairs = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
  return ['/usr/local/bin/claude', 'PATH=/usr/bin', ...pairs].join(' ');
}

function host(sessionId: string, pid: number, ended = false): SessionHost {
  return {
    sessionId,
    agent: 'claude-code',
    pid,
    seenAt: '2026-10-04T17:00:00.000Z',
    ...(ended ? { endedAt: '2026-10-04T17:30:00.000Z' } : {}),
  };
}

describe('proxyPortIn', () => {
  it('reads the port a run wrote for this session', () => {
    expect(proxyPortIn(environmentFor(51234), SESSION)).toBe(51234);
  });

  it('reads a NUL separated environment, as Linux keeps it', () => {
    const environ = environmentFor(51234).split(' ').join('\0');
    expect(proxyPortIn(environ, SESSION)).toBe(51234);
  });

  it('ignores a proxy that names another session or somebody else', () => {
    expect(proxyPortIn(environmentFor(51234, 'ses_other'), SESSION)).toBeNull();
    const sandbox = 'HTTPS_PROXY=http://srt.abc:secret@localhost:53681';
    expect(proxyPortIn(sandbox, SESSION)).toBeNull();
    expect(proxyPortIn('PATH=/usr/bin', SESSION)).toBeNull();
  });
});

describe('strandedEgressPorts', () => {
  it('names each live run session port once, and skips ended, dead and foreign sessions', async () => {
    const environments = new Map<number, string>([
      [10, environmentFor(51234)],
      [11, environmentFor(51234, 'ses_aaaa')],
      [12, environmentFor(52000, 'ses_bbbb')],
      [13, environmentFor(53000, 'ses_cccc')],
      [14, environmentFor(54000, 'agent-own-id')],
    ]);
    const ports = await strandedEgressPorts('/nowhere', {
      hosts: async () => [
        host(SESSION, 10),
        host('ses_aaaa', 11),
        host('ses_bbbb', 12, true),
        host('ses_cccc', 13),
        host('agent-own-id', 14),
      ],
      alive: (pid) => pid !== 13,
      environmentOf: (pid) => environments.get(pid) ?? null,
    });
    expect(ports).toEqual([51234]);
  });
});

describe('a daemon that comes back on another port', () => {
  it('also listens where agents already running were pointed, and closes it on stop', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stranded-'));
    const tried: number[] = [];
    const closed: number[] = [];
    const said: string[] = [];
    const egress = new DaemonEgress(home, {
      log: (message) => void said.push(message),
      stranded: async () => [40123, 51234, 52000],
      start: async (options): Promise<EgressProxy> => {
        tried.push(options.port);
        // A run's own relay holds its port, so that one will not bind.
        if (options.port === 52000) throw new Error('EADDRINUSE');
        const port = options.port === 0 ? 40123 : options.port;
        return { port, close: async () => void closed.push(port) };
      },
    });
    expect(await egress.start()).toBe(40123);
    expect(tried).toEqual([0, 51234, 52000]);
    expect(said.some((line) => line.includes('51234'))).toBe(true);
    await egress.stop();
    expect(closed.sort()).toEqual([40123, 51234]);
  });

  it('starts anyway when the running sessions cannot be read', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-stranded-'));
    const egress = new DaemonEgress(home, {
      log: () => undefined,
      stranded: async () => {
        throw new Error('ps is missing');
      },
      start: async () => ({ port: 40123, close: async () => undefined }),
    });
    expect(await egress.start()).toBe(40123);
  });
});

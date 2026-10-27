import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  EXIT,
  REMOTE_OUTCOME,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerDevicesCommand } from '../src/commands/devices.command';
import { registerPairCommand } from '../src/commands/pair.command';
import type { DaemonDial } from '../src/remote/daemon-dial';
import { plainStyle } from '../src/style';

const LINK = 'memnox://pair?d=eyJ2IjoxfQ';

/** A daemon that answers each method from a script, and streams pair-pending as told. */
class ScriptedDaemon implements DaemonDial {
  readonly asked: DaemonRequest[] = [];
  accepts: DaemonResponse[] = [];
  devices: DaemonResponse = { id: 1, ok: true, devices: [] };
  begun: DaemonResponse = {
    id: 2,
    ok: true,
    outcome: REMOTE_OUTCOME.PAIRING,
    pairing: { id: 'pair_1', qr: LINK, approver: 'local-shell' },
  };
  pending: DaemonResponse[] = [
    { id: 4, ok: true, pairing: { id: 'pair_1', state: 'waiting' } },
    {
      id: 4,
      ok: true,
      pairing: {
        id: 'pair_1',
        state: 'answered',
        phone: { name: 'iPhone', fingerprint: 'fp' },
      },
    },
  ];

  ask(request: DaemonRequest): Promise<DaemonResponse | null> {
    this.asked.push(request);
    if (request.method === DAEMON_METHOD.DEVICES_LIST)
      return Promise.resolve(this.devices);
    if (request.method === DAEMON_METHOD.PAIR_BEGIN) return Promise.resolve(this.begun);
    if (request.method === DAEMON_METHOD.PAIR_ACCEPT)
      return Promise.resolve(this.accepts.shift() ?? null);
    return Promise.resolve({ id: request.id, ok: true });
  }

  follow(request: DaemonRequest, each: (response: DaemonResponse) => void): () => void {
    this.asked.push(request);
    for (const response of this.pending) each(response);
    return () => undefined;
  }
}

async function pair(
  daemon: ScriptedDaemon,
  typed: (string | null)[],
  options: { env?: NodeJS.ProcessEnv; interactive?: boolean } = {},
): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerPairCommand(program, new CliContext(out, plainStyle), {
    home: () => '/nowhere',
    dial: () => daemon,
    askLine: () => Promise.resolve(typed.shift() ?? null),
    env: options.env ?? {},
    interactive: () => options.interactive ?? true,
    machineName: () => 'hostinger',
  });
  await program.parseAsync(['pair'], { from: 'user' });
  return out;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('memnox pair', () => {
  it('draws a QR and the link, then pairs on the digits the person types', async () => {
    const daemon = new ScriptedDaemon();
    daemon.accepts = [
      {
        id: 10,
        ok: true,
        outcome: REMOTE_OUTCOME.PAIRED,
        device: {
          id: 'dev_1',
          name: 'iPhone',
          kind: 'phone',
          fingerprint: 'fp',
          capabilities: ['see', 'ask', 'answer', 'steer'],
          pairedAt: '2026-10-06T00:00:00.000Z',
        },
      },
    ];

    const out = await pair(daemon, ['123 456']);

    expect(out.lines).toContain(LINK);
    expect(out.lines.filter((line) => line.includes('█')).length).toBeGreaterThan(10);
    expect(
      daemon.asked.find((each) => each.method === DAEMON_METHOD.PAIR_BEGIN)?.name,
    ).toBe('hostinger');
    expect(
      daemon.asked.find((each) => each.method === DAEMON_METHOD.PAIR_ACCEPT)?.code,
    ).toBe('123 456');
    expect([...out.lines, ...out.notes].join('\n')).toContain('Paired iPhone');
    expect(process.exitCode).toBe(EXIT.OK);
  });

  it('asks again while the daemon has tries left, and stops when it closes the pairing', async () => {
    const daemon = new ScriptedDaemon();
    daemon.accepts = [
      { id: 10, ok: false, reason: 'not those. 2 tries left.', triesLeft: 2 },
      { id: 11, ok: false, reason: 'closed.', triesLeft: 0 },
    ];

    const out = await pair(daemon, ['000000', '111111', '222222']);

    const accepts = daemon.asked.filter(
      (each) => each.method === DAEMON_METHOD.PAIR_ACCEPT,
    );
    expect(accepts.map((each) => each.code)).toEqual(['000000', '111111']);
    expect([...out.lines, ...out.notes].join('\n')).toContain('closed.');
    expect(process.exitCode).toBe(EXIT.FAILED);
  });

  it('refuses under an agent session, and without a terminal to type into', async () => {
    const underAgent = new ScriptedDaemon();
    await pair(underAgent, [], { env: { MEMNOX_SESSION: 'ses_1' } });
    const piped = new ScriptedDaemon();
    const out = await pair(piped, [], { interactive: false });

    expect(underAgent.asked).toEqual([]);
    expect(piped.asked).toEqual([]);
    expect([...out.lines, ...out.notes].join('\n')).toContain('never under an agent');
    expect(process.exitCode).toBe(EXIT.FAILED);
  });

  it('sends a Mac with Touch ID to its own app rather than opening a pairing', async () => {
    const daemon = new ScriptedDaemon();
    daemon.devices = {
      id: 1,
      ok: true,
      devices: [
        {
          id: 'this-mac',
          name: 'this Mac',
          kind: 'mac',
          fingerprint: 'f',
          capabilities: [],
          pairedAt: '2026-10-06T00:00:00.000Z',
        },
      ],
    };

    const out = await pair(daemon, []);

    expect(daemon.asked.map((each) => each.method)).toEqual([DAEMON_METHOD.DEVICES_LIST]);
    expect([...out.lines, ...out.notes].join('\n')).toContain('Touch ID');
  });

  it('declines the pairing when the person types nothing', async () => {
    const daemon = new ScriptedDaemon();

    await pair(daemon, ['']);

    expect(daemon.asked.at(-1)?.method).toBe(DAEMON_METHOD.PAIR_DECLINE);
    expect(process.exitCode).toBe(EXIT.FAILED);
  });
});

describe('memnox devices', () => {
  it('lists each device with what it may do', async () => {
    const daemon = new ScriptedDaemon();
    daemon.devices = {
      id: 1,
      ok: true,
      devices: [
        {
          id: 'dev_1',
          name: 'iPhone',
          kind: 'phone',
          fingerprint: 'f',
          capabilities: ['see', 'answer'],
          pairedAt: '2026-10-06T00:00:00.000Z',
        },
      ],
    };
    const out = new RecordedOutput();
    const program = new Command();
    registerDevicesCommand(program, new CliContext(out, plainStyle), {
      home: () => '/nowhere',
      dial: () => daemon,
    });

    await program.parseAsync(['devices'], { from: 'user' });

    expect(out.text).toContain('dev_1');
    expect(out.text).toContain('see, answer');
  });
});

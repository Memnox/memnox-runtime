/**
 * `memnox devices`: the phones and Macs paired with this machine, and what each may do. On a
 * machine with no Mac key the shell is where a device is given more; with one, the Mac app is.
 */

import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  DAEMON_METHOD,
  EXIT,
  REMOTE_CAPABILITY,
  type DaemonRequest,
  type DeviceWire,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import { socketDial, type DaemonDial } from '../remote/daemon-dial';

interface DevicesDeps {
  home: () => string;
  dial: (home: string) => DaemonDial;
}

const NO_DAEMON =
  'The Memnox daemon is not answering here. Start it with memnox daemon --install.';

const CAPABILITIES = Object.values(REMOTE_CAPABILITY).join(', ');

export function registerDevicesCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<DevicesDeps> = {},
): void {
  const deps: DevicesDeps = { home: homedir, dial: socketDial, ...overrides };
  const run = async (work: () => Promise<number>): Promise<void> => {
    context.flow.open('devices');
    process.exitCode = await work();
    context.flow.end();
  };
  const list = (options: { json?: boolean }): Promise<void> =>
    run(() => runList(context, deps, options.json === true));
  const change = (request: Omit<DaemonRequest, 'id'>): Promise<void> =>
    // Spreading a type with a method key loses the key's literal type, so the id is put back here.
    run(() => runChange(context, deps, { id: 1, ...request } as DaemonRequest));
  const devices = program
    .command('devices')
    .description('The phones and Macs paired with this machine, and what each may do')
    .option('--json', 'print them as JSON')
    .action(list);
  devices
    .command('list')
    .description('List every paired device')
    .option('--json', 'print them as JSON')
    .action(list);
  devices
    .command('revoke <device>')
    .description('Take a device away at once; its live connection closes')
    .action((deviceId: string) =>
      change({ method: DAEMON_METHOD.DEVICE_REVOKE, deviceId }),
    );
  devices
    .command('grant <device> <capability>')
    .description(`Let a device do one more thing: ${CAPABILITIES}`)
    .action((deviceId: string, capability: string) =>
      change({ method: DAEMON_METHOD.DEVICE_GRANT, deviceId, capability }),
    );
  devices
    .command('ungrant <device> <capability>')
    .description('Take one capability back from a device')
    .action((deviceId: string, capability: string) =>
      change({ method: DAEMON_METHOD.DEVICE_UNGRANT, deviceId, capability }),
    );
}

async function runList(
  context: CliContext,
  deps: DevicesDeps,
  json: boolean,
): Promise<number> {
  const answer = await deps
    .dial(deps.home())
    .ask({ id: 1, method: DAEMON_METHOD.DEVICES_LIST });
  if (answer === null) {
    context.flow.fail(NO_DAEMON);
    return EXIT.FAILED;
  }
  const devices = answer.devices ?? [];
  if (json) {
    context.out.json(devices);
    return EXIT.OK;
  }
  if (devices.length === 0) {
    context.flow.close('No device is paired with this machine.');
    context.flow.hint('memnox pair   pairs a phone or a Mac');
    return EXIT.OK;
  }
  context.flow.table('Paired', ['id', 'name', 'kind', 'may'], devices.map(cellsOf));
  context.flow.close(`${devices.length} paired.`);
  return EXIT.OK;
}

async function runChange(
  context: CliContext,
  deps: DevicesDeps,
  request: DaemonRequest,
): Promise<number> {
  const answer = await deps.dial(deps.home()).ask(request);
  if (answer === null || !answer.ok) {
    context.flow.fail(answer?.reason ?? answer?.error ?? NO_DAEMON);
    return EXIT.FAILED;
  }
  const device = answer.device;
  context.flow.close(
    device === undefined
      ? `${request.deviceId ?? 'The device'} ${answer.outcome ?? 'changed'}.`
      : `${device.name} may now: ${mayOf(device)}.`,
  );
  return EXIT.OK;
}

function cellsOf(device: DeviceWire): string[] {
  return [device.id, device.name, device.kind, mayOf(device)];
}

function mayOf(device: DeviceWire): string {
  return device.revokedAt === undefined
    ? device.capabilities.join(', ')
    : 'nothing, revoked';
}

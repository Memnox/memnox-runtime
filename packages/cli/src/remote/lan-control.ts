import { randomBytes } from 'node:crypto';
import { readJsonFile, writeJsonFile, type LanStatus } from '@memnox/core';
import { lanIdentityPath } from '../memnox-paths';

/**
 * What this machine is called on the local network, and the one door the lan methods and a signed
 * proposal use to reach the daemon's live listener, keyed by home so two daemons in one test never meet.
 */

const INSTANCE_PREFIX = 'memnox-';
const MACHINE_PREFIX = 'lan_';

/** Random, made once, and nothing else: no host name, no person, no account. */
interface LanIdentity {
  /** The Bonjour instance and host name. */
  instance: string;
  /** Names the machine in a QR where no account names it. */
  machineId: string;
}

export async function lanIdentity(home: string): Promise<LanIdentity> {
  const path = lanIdentityPath(home);
  const kept = await readJsonFile<Partial<LanIdentity>>(path);
  if (typeof kept?.instance === 'string' && typeof kept.machineId === 'string')
    return { instance: kept.instance, machineId: kept.machineId };
  const made = {
    instance: `${INSTANCE_PREFIX}${randomBytes(4).toString('hex')}`,
    machineId: `${MACHINE_PREFIX}${randomBytes(9).toString('base64url')}`,
  };
  await writeJsonFile(path, made);
  return made;
}

/** The daemon's listener as the lan methods see it. */
interface LanControl {
  status(): Promise<LanStatus>;
  /** Reads the setting again and opens or closes the listener to match it. */
  refresh(): Promise<void>;
}

const running = new Map<string, LanControl>();

/** Kept until the returned function is called, which the endpoint does as it closes. */
export function registerLan(home: string, control: LanControl): () => void {
  running.set(home, control);
  return () => {
    if (running.get(home) === control) running.delete(home);
  };
}

/** The live listener for this home, or null where no daemon runs one. */
export function lanControl(home: string): LanControl | null {
  return running.get(home) ?? null;
}

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import type { DeviceWire } from '../daemon/remote';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import {
  ALL_REMOTE_CAPABILITIES,
  REMOTE_CAPABILITY,
  type RemoteCapability,
} from './capabilities';
import { ConfirmKeys, verifiesSigned, type ConfirmKey } from './confirm-key';

/**
 * Every key this machine trusts to sign for its person: the Mac's own, trusted on first use and
 * still kept in `confirm-key.json`, and each phone paired since, with what it may do.
 */

export const DEVICES_FILE = 'devices.json';

/** The Mac's own key, mirrored from `confirm-key.json`, which stays the one place it is registered. */
export const THIS_MAC = 'this-mac';

export const DEVICE_KIND = {
  MAC: 'mac',
  PHONE: 'phone',
  /** A Mac reaching this machine through the relay, as a phone does, rather than over its socket. */
  DESKTOP: 'desktop',
} as const;

export type DeviceKind = (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];

/** What let a pairing through: the Mac's own Touch ID, or a person at a shell typing the device's digits. */
export const PAIR_APPROVER = {
  MAC_KEY: 'mac-key',
  /** A machine with no Mac key, such as a server reached over SSH, where the shell is the root of trust. */
  LOCAL_SHELL: 'local-shell',
} as const;

export type PairApprover = (typeof PAIR_APPROVER)[keyof typeof PAIR_APPROVER];

const REGISTRY_VERSION = 1;

export interface DeviceRecord {
  id: string;
  name: string;
  kind: DeviceKind;
  /** The base64 X9.63 P-256 point its Secure Enclave signs with. */
  signingPoint: string;
  /** The base64 X25519 key its Noise handshakes prove; the Mac has none, since it is local. */
  noiseStatic?: string;
  capabilities: RemoteCapability[];
  pairedAt: string;
  revokedAt?: string;
  /** The relay mailbox its tunnel uses, and the token the cloud minted for it. */
  mailbox?: string;
  relayTokenId?: string;
  /** Absent on a device paired before this was kept, which a Mac key approved. */
  approvedBy?: PairApprover;
}

interface Registry {
  version: number;
  devices: DeviceRecord[];
}

export function devicesPathFor(home: string): string {
  return join(home, MEMNOX_HOME, DEVICES_FILE);
}

/** Base64url of SHA-256 over the signing point then the Noise key, the same on every screen. */
export function deviceFingerprint(signingPoint: string, noiseStatic?: string): string {
  const parts = [Buffer.from(signingPoint, 'base64')];
  if (noiseStatic !== undefined) parts.push(Buffer.from(noiseStatic, 'base64'));
  return createHash('sha256').update(Buffer.concat(parts)).digest('base64url');
}

/** The registry entry as the apps see it, with no key in it. */
export function deviceWire(record: DeviceRecord): DeviceWire {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    fingerprint: deviceFingerprint(record.signingPoint, record.noiseStatic),
    capabilities: [...record.capabilities],
    pairedAt: record.pairedAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
    ...(record.approvedBy === undefined ? {} : { approvedBy: record.approvedBy }),
  };
}

/** Who the ledger says answered: Touch ID at the Mac or on a named remote Mac, Face ID on a named phone. */
export function answeredBy(record: DeviceRecord): string {
  if (record.kind === DEVICE_KIND.MAC) return 'person (Touch ID)';
  if (record.kind === DEVICE_KIND.DESKTOP) return `person (Touch ID, ${record.name})`;
  return `person (Face ID, ${record.name})`;
}

export function holds(record: DeviceRecord, capability: RemoteCapability): boolean {
  return record.revokedAt === undefined && record.capabilities.includes(capability);
}

/** Whether a paired device away from this Mac may answer held calls, so one can land there. */
export async function pairedCanAnswer(home: string): Promise<boolean> {
  const devices = await new Devices(home).all();
  return devices.some(
    (each) => each.kind !== DEVICE_KIND.MAC && holds(each, REMOTE_CAPABILITY.ANSWER),
  );
}

export class Devices {
  private readonly path: string;
  private readonly keys: ConfirmKeys;

  constructor(home: string) {
    this.path = devicesPathFor(home);
    this.keys = new ConfirmKeys(home);
  }

  /** Every device, the Mac first, after bringing its entry in line with the key on file. */
  async all(): Promise<DeviceRecord[]> {
    const registry = await this.read();
    const synced = withMac(registry.devices, await this.keys.read());
    if (JSON.stringify(synced) !== JSON.stringify(registry.devices)) {
      await this.write(synced);
    }
    return synced;
  }

  async find(id: string): Promise<DeviceRecord | null> {
    return (await this.all()).find((each) => each.id === id) ?? null;
  }

  /** The live device a completed handshake proved, or null for a key never paired or since revoked. */
  async byNoiseStatic(noiseStatic: string): Promise<DeviceRecord | null> {
    const found = (await this.all()).find((each) => each.noiseStatic === noiseStatic);
    return found === undefined || found.revokedAt !== undefined ? null : found;
  }

  /** The live device whose key signed these words, so a verification names who answered. */
  async signerOf(message: string, signature: string): Promise<DeviceRecord | null> {
    const live = (await this.all()).filter((each) => each.revokedAt === undefined);
    return (
      live.find((each) => verifiesSigned(each.signingPoint, message, signature)) ?? null
    );
  }

  async add(record: DeviceRecord): Promise<void> {
    const rest = (await this.all()).filter((each) => each.id !== record.id);
    await this.write([...rest, record]);
  }

  /** Marked rather than deleted, so the list still says when it went; the Mac's own key is never revoked here. */
  async revoke(id: string, at: string): Promise<DeviceRecord | null> {
    const devices = await this.all();
    const found = devices.find((each) => each.id === id);
    if (found === undefined || found.kind === DEVICE_KIND.MAC) return null;
    const revoked: DeviceRecord = { ...found, revokedAt: found.revokedAt ?? at };
    await this.write(devices.map((each) => (each.id === id ? revoked : each)));
    return revoked;
  }

  async grant(id: string, capability: RemoteCapability): Promise<DeviceRecord | null> {
    const devices = await this.all();
    const found = devices.find((each) => each.id === id);
    if (found === undefined || found.revokedAt !== undefined) return null;
    if (found.capabilities.includes(capability)) return found;
    const granted: DeviceRecord = {
      ...found,
      capabilities: [...found.capabilities, capability],
    };
    await this.write(devices.map((each) => (each.id === id ? granted : each)));
    return granted;
  }

  /** The Mac's own entry always holds everything, since it follows the key on file. */
  async ungrant(id: string, capability: RemoteCapability): Promise<DeviceRecord | null> {
    const devices = await this.all();
    const found = devices.find((each) => each.id === id);
    if (found === undefined || found.kind === DEVICE_KIND.MAC) return null;
    const ungranted: DeviceRecord = {
      ...found,
      capabilities: found.capabilities.filter((each) => each !== capability),
    };
    await this.write(devices.map((each) => (each.id === id ? ungranted : each)));
    return ungranted;
  }

  private async read(): Promise<Registry> {
    const found = await readJsonFile<Partial<Registry>>(this.path);
    const devices = Array.isArray(found?.devices) ? found.devices : [];
    return { version: REGISTRY_VERSION, devices };
  }

  private async write(devices: readonly DeviceRecord[]): Promise<void> {
    await writeJsonFile(this.path, { version: REGISTRY_VERSION, devices });
  }
}

/** The Mac's entry follows `confirm-key.json`: added when a key is there, gone when it was forgotten. */
function withMac(
  devices: readonly DeviceRecord[],
  key: ConfirmKey | null,
): DeviceRecord[] {
  const phones = devices.filter((each) => each.id !== THIS_MAC);
  if (key === null) return phones;
  const mac: DeviceRecord = {
    id: THIS_MAC,
    name: 'this Mac',
    kind: DEVICE_KIND.MAC,
    signingPoint: key.point,
    capabilities: [...ALL_REMOTE_CAPABILITIES],
    pairedAt: key.registeredAt,
  };
  return [mac, ...phones];
}

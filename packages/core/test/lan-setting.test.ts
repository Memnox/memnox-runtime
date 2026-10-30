import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configKeys,
  configPathFor,
  DAEMON_METHOD,
  loadOrCreateConfig,
  parseConfig,
  PROPOSAL_KIND,
  proposalCapability,
  readLanSetting,
  remoteCapabilityFor,
  REMOTE_CAPABILITY,
  renderConfig,
  saveLanSetting,
} from '../src/index';

/** The local network stays off until the person turns it on, and a phone can only ever look at it. */

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-lan-setting-'));
}

describe('the local network setting', () => {
  it('is off where nothing says otherwise, and off on a fresh config', async () => {
    const dir = await home();
    expect(await readLanSetting(dir)).toBe(false);
    expect((await loadOrCreateConfig(dir)).lan).toBeUndefined();
    expect(await readLanSetting(dir)).toBe(false);
  });

  it('turns on and off again, keeping every other setting', async () => {
    const dir = await home();
    const before = await loadOrCreateConfig(dir);
    await saveLanSetting(dir, true);
    expect(await readLanSetting(dir)).toBe(true);
    expect(await readFile(configPathFor(dir), 'utf8')).toContain('lan = true');
    await saveLanSetting(dir, false);
    expect(await readLanSetting(dir)).toBe(false);
    expect(await loadOrCreateConfig(dir)).toEqual(before);
  });

  it('round trips, and reads anything but true as off', () => {
    const on = { ...parseConfig(''), lan: true as const };
    expect(parseConfig(renderConfig(on)).lan).toBe(true);
    expect(parseConfig('lan = yes').lan).toBeUndefined();
  });

  it('is no key memnox config set can change, since only a signed proposal turns it on', () => {
    expect(configKeys()).not.toContain('lan');
  });

  it('lets a phone see it, never set it, and never sign it on', () => {
    expect(remoteCapabilityFor(DAEMON_METHOD.LAN_STATUS)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.LAN_SET)).toBeNull();
    expect(proposalCapability({ kind: PROPOSAL_KIND.LAN, on: true })).toBeNull();
  });
});

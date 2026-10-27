import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_METHOD } from '../src/daemon/protocol';
import { pairMessage } from '../src/daemon/remote';
import {
  ALL_REMOTE_CAPABILITIES,
  driveCovers,
  PER_SUBJECT,
  proposalCapability,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  startsSession,
} from '../src/gate/capabilities';
import { ConfirmKeys } from '../src/gate/confirm-key';
import {
  answeredBy,
  DEVICE_KIND,
  deviceFingerprint,
  Devices,
  devicesPathFor,
  deviceWire,
  THIS_MAC,
  type DeviceRecord,
} from '../src/gate/devices';
import { HOLD_ANSWER } from '../src/gate/hold';
import { PROPOSAL_KIND } from '../src/gate/proposals';

const NOW = '2026-10-05T10:00:00.000Z';

function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-devices-'));
}

function key(): { point: string; signs: (message: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    point: spki.subarray(spki.length - 65).toString('base64'),
    signs: (message) =>
      sign('sha256', Buffer.from(message), privateKey).toString('base64'),
  };
}

function phone(signingPoint: string): DeviceRecord {
  return {
    id: 'dev_1',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint,
    noiseStatic: Buffer.alloc(32, 3).toString('base64'),
    capabilities: [REMOTE_CAPABILITY.SEE, REMOTE_CAPABILITY.ANSWER],
    pairedAt: NOW,
  };
}

describe('the device registry', () => {
  it('migrates the confirmation key as this-mac with every capability', async () => {
    const at = await home();
    const mac = key();
    await new ConfirmKeys(at).register(mac.point, NOW);

    const devices = await new Devices(at).all();

    expect(devices).toEqual([
      expect.objectContaining({
        id: THIS_MAC,
        kind: DEVICE_KIND.MAC,
        signingPoint: mac.point,
        pairedAt: NOW,
        capabilities: [...ALL_REMOTE_CAPABILITIES],
      }),
    ]);
    const written = JSON.parse(await readFile(devicesPathFor(at), 'utf8')) as {
      devices: DeviceRecord[];
    };
    expect(written.devices.map((each) => each.id)).toEqual([THIS_MAC]);
  });

  it('keeps register-key trusted on first use, so a second key never replaces the Mac', async () => {
    const at = await home();
    const first = key();
    await new ConfirmKeys(at).register(first.point, NOW);
    expect(await new ConfirmKeys(at).register(key().point, NOW)).toHaveProperty(
      'alreadyRegistered',
    );
    expect((await new Devices(at).find(THIS_MAC))?.signingPoint).toBe(first.point);
  });

  it('keeps a paired phone when the Mac key is forgotten, and drops only the Mac', async () => {
    const at = await home();
    const devices = new Devices(at);
    await new ConfirmKeys(at).register(key().point, NOW);
    await devices.add(phone(key().point));
    await new ConfirmKeys(at).forget();

    expect((await devices.all()).map((each) => each.id)).toEqual(['dev_1']);
  });

  it('resolves who signed, and never a revoked device', async () => {
    const at = await home();
    const devices = new Devices(at);
    const theirs = key();
    await devices.add(phone(theirs.point));
    const signature = theirs.signs('memnox-confirm:v1:apr_1:once');

    expect((await devices.signerOf('memnox-confirm:v1:apr_1:once', signature))?.id).toBe(
      'dev_1',
    );
    await devices.revoke('dev_1', NOW);
    expect(await devices.signerOf('memnox-confirm:v1:apr_1:once', signature)).toBeNull();
    expect(
      await devices.byNoiseStatic(Buffer.alloc(32, 3).toString('base64')),
    ).toBeNull();
  });

  it('never revokes the Mac from here, and grants only a live device', async () => {
    const at = await home();
    const devices = new Devices(at);
    await new ConfirmKeys(at).register(key().point, NOW);
    await devices.add(phone(key().point));

    expect(await devices.revoke(THIS_MAC, NOW)).toBeNull();
    expect((await devices.grant('dev_1', REMOTE_CAPABILITY.MAC))?.capabilities).toContain(
      'mac',
    );
    await devices.revoke('dev_1', NOW);
    expect(await devices.grant('dev_1', REMOTE_CAPABILITY.RULES)).toBeNull();
  });

  it('takes one capability back from a phone, never from the Mac', async () => {
    const at = await home();
    const devices = new Devices(at);
    await new ConfirmKeys(at).register(key().point, NOW);
    await devices.add(phone(key().point));
    await devices.grant('dev_1', REMOTE_CAPABILITY.MAC);

    const ungranted = await devices.ungrant('dev_1', REMOTE_CAPABILITY.MAC);

    expect(ungranted?.capabilities).not.toContain('mac');
    expect((await devices.find('dev_1'))?.capabilities).toEqual(ungranted?.capabilities);
    expect(await devices.ungrant(THIS_MAC, REMOTE_CAPABILITY.SEE)).toBeNull();
    expect(await devices.ungrant('dev_9', REMOTE_CAPABILITY.SEE)).toBeNull();
  });

  it('shows a device with its fingerprint and no key, and names it in the ledger', () => {
    const point = key().point;
    const wire = deviceWire(phone(point));

    expect(wire).not.toHaveProperty('signingPoint');
    expect(wire.fingerprint).toBe(
      deviceFingerprint(point, Buffer.alloc(32, 3).toString('base64')),
    );
    expect(answeredBy(phone(point))).toBe('person (Face ID, iPhone)');
    expect(pairMessage('pair_1', wire.fingerprint)).toBe(
      `memnox-pair:v1:pair_1:${wire.fingerprint}`,
    );
  });
});

describe('the capability table', () => {
  it('lets a phone see and ask, and keeps pairing and every core method local', () => {
    expect(remoteCapabilityFor(DAEMON_METHOD.SESSIONS_LIST)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.ASK)).toBe('ask');
    expect(remoteCapabilityFor(DAEMON_METHOD.CONFIRM)).toBe(PER_SUBJECT);
    expect(remoteCapabilityFor(DAEMON_METHOD.DRIVE)).toBe('mac');
    expect(remoteCapabilityFor(DAEMON_METHOD.VOICE_CHOICE)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.VOICE_CHOICE, 'af_bella')).toBeNull();
    expect(remoteCapabilityFor(DAEMON_METHOD.FILES_LIST)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.SPEAK)).toBe('ask');
    expect(remoteCapabilityFor(DAEMON_METHOD.SPEAK, 'bm_george')).toBe('ask');
    expect(remoteCapabilityFor(DAEMON_METHOD.DELIVERED)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.FOLLOW_UP)).toBe('steer');
    expect(remoteCapabilityFor(DAEMON_METHOD.VOICE_RELEASE)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.CONNECTIONS_LIST)).toBe('see');
    for (const local of [
      DAEMON_METHOD.PAIR_BEGIN,
      DAEMON_METHOD.PAIR_ACCEPT,
      DAEMON_METHOD.DEVICE_GRANT,
      DAEMON_METHOD.DEVICE_REVOKE,
      DAEMON_METHOD.DEVICE_UNGRANT,
      DAEMON_METHOD.REGISTER_KEY,
      DAEMON_METHOD.EVALUATE,
      DAEMON_METHOD.HOLD,
    ]) {
      expect(remoteCapabilityFor(local), local).toBeNull();
    }
  });

  it('asks the right capability of each proposal, and none for a command a phone may not run', () => {
    expect(
      proposalCapability({
        kind: PROPOSAL_KIND.ANSWER,
        pendingId: 'apr_1',
        answer: HOLD_ANSWER.ONCE,
      }),
    ).toBe('answer');
    expect(proposalCapability({ kind: PROPOSAL_KIND.RESUME, sessionId: 's' })).toBe(
      'steer',
    );
    expect(proposalCapability({ kind: PROPOSAL_KIND.COMMAND, argv: ['freeze'] })).toBe(
      'steer',
    );
    expect(
      proposalCapability({ kind: PROPOSAL_KIND.COMMAND, argv: ['login'] }),
    ).toBeNull();
    expect(
      proposalCapability({
        kind: PROPOSAL_KIND.REWIND,
        repository: '/r',
        milestone: 'm',
      }),
    ).toBe('rewind');
  });

  it("lets a drive cover only that phone's Mac proposals", () => {
    const event = {
      kind: 'show',
      subject: 'dsp_1',
      agent: 'claude-code',
      summary: 's',
      at: NOW,
    } as const;
    const mac = { kind: PROPOSAL_KIND.MAC, deviceId: 'dev_1', event };

    expect(driveCovers(mac, 'dev_1')).toBe(true);
    expect(driveCovers(mac, 'dev_2')).toBe(false);
    expect(
      driveCovers(
        { kind: PROPOSAL_KIND.ANSWER, pendingId: 'apr_1', answer: HOLD_ANSWER.ONCE },
        'dev_1',
      ),
    ).toBe(false);
    expect(
      driveCovers({ kind: PROPOSAL_KIND.RULES, file: '/f', rules: [] }, 'dev_1'),
    ).toBe(false);
  });

  it('lets a phone sign a show that starts a session, and never drive one', () => {
    const show = {
      kind: 'show',
      subject: 'dsp_1',
      agent: 'claude-code',
      summary: 's',
      at: NOW,
    } as const;
    const launch = { ...show, display: 'launch', sessionId: 'stt_1' } as const;
    const appStart = { ...show, display: 'app', sessionId: 'stt_2' } as const;
    const newChat = {
      ...show,
      display: 'app',
      sessionId: 'app_codex',
      via: 'new-chat',
    } as const;
    const typed = { ...show, display: 'app', sessionId: 'app_codex' } as const;

    for (const event of [launch, appStart, newChat]) {
      expect(startsSession(event), event.display).toBe(true);
      const mac = { kind: PROPOSAL_KIND.MAC, deviceId: 'dev_1', event };
      expect(proposalCapability(mac)).toBe(REMOTE_CAPABILITY.MAC);
      expect(driveCovers(mac, 'dev_1')).toBe(false);
    }
    expect(startsSession(typed)).toBe(false);
    expect(
      proposalCapability({ kind: PROPOSAL_KIND.MAC, deviceId: 'dev_1', event: typed }),
    ).toBe('mac');
  });
});

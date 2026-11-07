import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifiesSigned, writeAccount } from '@memnox/core';
import {
  claimDeviceSpace,
  deviceSpaceWorkZeros,
  ensureDeviceSpace,
  pointOf,
  proofDigest,
  readDeviceSpace,
  relayMachine,
  type DeviceSpace,
} from '../src/sync/device-space';
import { ACCOUNT_REQUIRED } from '../src/sync/cloud-account';
import {
  connectionsOf,
  findPersonalTools,
  runPersonalTool,
} from '../src/sync/personal-work';

/**
 * A Mac nobody signed in on: it registers its own personal space once to browse and list as, runs
 * nothing through it, and hands it to the person's account when they sign in.
 */

const BASE = 'https://api.memnox.test';

interface Sent {
  url: string;
  method: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

/** Answers every request from the table by path, keeping what was sent. */
function fakeCloud(answers: Record<string, { status: number; body: unknown }>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    sent.push({
      url: url.pathname,
      method: init.method ?? 'GET',
      ...(headers['authorization'] === undefined
        ? {}
        : { authorization: headers['authorization'] }),
      ...(typeof init.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    });
    const answer = answers[url.pathname] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-space-'));
  await mkdir(join(home, '.memnox'), { recursive: true });
  return home;
}

/** A space as registering leaves one, with a real signing key so signatures can be checked. */
async function keptSpace(
  home: string,
  extra: Partial<DeviceSpace> = {},
): Promise<{ point: string }> {
  const signing = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const space: DeviceSpace = {
    version: 1,
    baseUrl: BASE,
    workspaceId: 'dsp_1',
    machineId: 'mac_space',
    token: 'mch_space',
    privateKey: 'unused',
    signingKey: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    deviceId: 'pdv_1',
    personId: 'per_space',
    registeredAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
  await writeFile(join(home, '.memnox', 'device-space.json'), JSON.stringify(space));
  return { point: pointOf(signing.publicKey) };
}

const REGISTERED = {
  workspaceId: 'dsp_1',
  machineId: 'mac_space',
  token: 'mch_space',
  deviceId: 'pdv_1',
  personId: 'per_space',
};

describe('registering a personal space with no account', () => {
  it('sends both public keys with a proof of work, keeps the credential, and registers once', async () => {
    const home = await freshHome();
    const sent = fakeCloud({ '/v1/device-spaces': { status: 201, body: REGISTERED } });

    const [one, two] = await Promise.all([
      ensureDeviceSpace(home, BASE),
      ensureDeviceSpace(home, BASE),
    ]);
    const again = await ensureDeviceSpace(home, BASE);

    expect(sent).toHaveLength(1);
    const body = sent[0]?.body ?? {};
    expect(sent[0]?.authorization).toBeUndefined();
    expect(String(body['publicKey'])).toContain('BEGIN PUBLIC KEY');
    expect(Buffer.from(String(body['signingPoint']), 'base64')).toHaveLength(65);
    expect(
      proofDigest(String(body['signingPoint']), String(body['nonce'])).startsWith(
        '0'.repeat(deviceSpaceWorkZeros()),
      ),
    ).toBe(true);
    expect(one?.token).toBe('mch_space');
    expect(two?.machineId).toBe('mac_space');
    expect(again?.deviceId).toBe('pdv_1');
    const kept = await readFile(join(home, '.memnox', 'device-space.json'), 'utf8');
    expect(kept).toContain('BEGIN PRIVATE KEY');
  });

  it('keeps nothing when the cloud refuses, so the next need tries again', async () => {
    const home = await freshHome();
    fakeCloud({ '/v1/device-spaces': { status: 429, body: { error: 'too_many' } } });

    expect(await ensureDeviceSpace(home, BASE)).toBeNull();
    expect(await readDeviceSpace(home)).toBeNull();
  });
});

describe('acting as the person through the space', () => {
  it('finds tools as the space, on its own credential, registering on first need', async () => {
    const home = await freshHome();
    process.env['MEMNOX_CLOUD_URL'] = BASE;
    const sent = fakeCloud({
      '/v1/device-spaces': { status: 201, body: REGISTERED },
      '/v1/workspaces/dsp_1/me/work/tools': {
        status: 200,
        body: { tools: [], accounts: [], signInFirst: ['gmail'] },
      },
    });
    try {
      const found = await findPersonalTools(home, 'send an email');
      expect(found.ok && found.value.signInFirst).toEqual(['gmail']);
      expect(sent.map((each) => each.url)).toEqual([
        '/v1/device-spaces',
        '/v1/workspaces/dsp_1/me/work/tools',
      ]);
      expect(sent[1]?.authorization).toBe('Bearer mch_space');
    } finally {
      process.env['MEMNOX_CLOUD_URL'] = 'http://127.0.0.1:9';
    }
  });

  it('runs nothing as the space, a confirmed send included, and says to sign in to Memnox Cloud', async () => {
    const home = await freshHome();
    await keptSpace(home);
    const sent = fakeCloud({
      '/v1/workspaces/dsp_1/me/work/run': {
        status: 200,
        body: { workClass: 'act', data: {} },
      },
    });

    const ran = await runPersonalTool(
      home,
      'GMAIL_SEND_EMAIL',
      '{"to":"sam@example.com"}',
      {
        proposalId: 'prp_1',
      },
    );

    expect(ran).toMatchObject({ ok: false, code: ACCOUNT_REQUIRED });
    expect(ran.ok ? '' : ran.said).toMatch(/needs a Memnox Cloud account/);
    expect(ran.ok ? '' : ran.said).toMatch(/memnox_sign_in/);
    expect(sent).toEqual([]);
  });

  it("lists the space's connections without a person signed in", async () => {
    const home = await freshHome();
    await keptSpace(home);
    fakeCloud({
      '/v1/workspaces/dsp_1/me/grants': {
        status: 200,
        body: [{ id: 'g1', toolkit: 'notion', status: 'ACTIVE', enabled: true }],
      },
    });

    expect(await connectionsOf(home)).toEqual({
      ok: true,
      value: [{ toolkit: 'notion', connected: true }],
    });
  });
});

describe('claiming the space on sign in', () => {
  it('hands the space to the person, moves its mailboxes to the enrolled machine, and the relay follows', async () => {
    const home = await freshHome();
    const { point } = await keptSpace(home, { relay: true });
    await writeFile(
      join(home, '.memnox', 'person.json'),
      JSON.stringify({
        baseUrl: BASE,
        token: 'per_token',
        personId: 'per_1',
        name: 'Sam',
        workspaceId: 'ws_1',
        deviceId: 'dev_1',
        privateKey: 'unused',
      }),
    );
    const account = {
      version: 1,
      baseUrl: BASE,
      workspaceId: 'ws_1',
      machineId: 'mac_1',
      token: 'mch_test',
      privateKey: 'unused',
      enrolledAt: '2026-10-01T00:00:00.000Z',
    };
    await writeAccount(home, account);
    expect((await relayMachine(home, null))?.machineId).toBe('mac_space');
    const sent = fakeCloud({
      '/v1/workspaces/ws_1/me/device-claims': {
        status: 200,
        body: { claimed: true, connections: 2, mailboxes: 1 },
      },
    });

    const claimed = await claimDeviceSpace(home);
    const repeated = await claimDeviceSpace(home);

    expect(claimed).toEqual({ claimed: true, connections: 2, mailboxes: 1 });
    expect(repeated).toEqual({ claimed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.authorization).toBe('Bearer per_token');
    const body = sent[0]?.body ?? {};
    expect(body).toMatchObject({
      deviceSpaceId: 'dsp_1',
      deviceMachineId: 'mac_space',
      machineId: 'mac_1',
    });
    expect(
      verifiesSigned(
        point,
        'memnox-confirm:v1:device-claim:dsp_1:ws_1',
        String(body['signature']),
      ),
    ).toBe(true);
    expect((await relayMachine(home, null))?.machineId).toBe('mac_1');
  });

  it('claims nothing with nobody signed in', async () => {
    const home = await freshHome();
    await keptSpace(home);
    const sent = fakeCloud({});

    expect(await claimDeviceSpace(home)).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe('which machine the relay dials as', () => {
  it('keeps an account with no relaying space, and takes a space only when pairing asks', async () => {
    const home = await freshHome();
    expect(await relayMachine(home, null)).toBeNull();
    await keptSpace(home);
    expect(await relayMachine(home, null)).toBeNull();
    const made = await relayMachine(home, async () => readDeviceSpace(home));
    expect(made?.machineId).toBe('mac_space');
    expect((await readDeviceSpace(home))?.relay).toBe(true);
  });
});

describe('the work a registration does', () => {
  it('asks the cloud its five zeros unless the environment names fewer', () => {
    expect(deviceSpaceWorkZeros({})).toBe(5);
    expect(deviceSpaceWorkZeros({ MEMNOX_DEVICE_SPACE_WORK_ZEROS: '2' })).toBe(2);
    expect(deviceSpaceWorkZeros({ MEMNOX_DEVICE_SPACE_WORK_ZEROS: '9' })).toBe(5);
    expect(deviceSpaceWorkZeros({ MEMNOX_DEVICE_SPACE_WORK_ZEROS: 'none' })).toBe(5);
  });
});

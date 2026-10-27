import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinWithToken, machineKeypair } from '../src/sync/enrol';

const BASE = 'https://api.memnox.test';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answering(status: number, body: unknown): { path: string; body: unknown }[] {
  const sent: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    sent.push({
      path: new URL(String(url)).pathname,
      body: JSON.parse(String(init.body)) as unknown,
    });
    return new Response(JSON.stringify(body), { status });
  });
  return sent;
}

describe('joining with a token from the console', () => {
  it("sends the token with this machine's own public key and class, never a private key", async () => {
    const keys = machineKeypair();
    const sent = answering(201, {
      machineId: 'mch_1',
      token: 'mch_secret',
      mode: 'enforce',
      workspaceId: 'ws_1',
      ownerPersonId: 'usr_ana',
    });

    const collected = await joinWithToken(
      {
        baseUrl: BASE,
        joinToken: 'mjt_once',
        machineClass: 'server',
        label: 'build-box',
      },
      keys.publicKey,
    );

    expect(collected).toMatchObject({ machineId: 'mch_1', ownerPersonId: 'usr_ana' });
    expect(sent[0]?.path).toBe('/v1/machines/join');
    expect(sent[0]?.body).toMatchObject({
      token: 'mjt_once',
      machineClass: 'server',
      label: 'build-box',
      publicKey: keys.publicKey,
    });
    expect(JSON.stringify(sent[0]?.body)).not.toContain('PRIVATE KEY');
  });

  it('says plainly that a used, expired or revoked token needs a new one', async () => {
    answering(410, { error: 'gone' });

    await expect(
      joinWithToken({ baseUrl: BASE, joinToken: 'mjt_used' }, machineKeypair().publicKey),
    ).rejects.toThrow('Make a new one in the console');
  });
});

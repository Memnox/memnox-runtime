import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  DEVICE_KIND,
  Devices,
  followUpMessage,
  PHONE_DEFAULT_CAPABILITIES,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SpokenInstructions,
  type DaemonRequest,
  type DeviceRecord,
  type RemoteCapability,
} from '@memnox/core';
import type { RemotePrincipal } from '../src/daemon/confirm';
import { followUpAnswer, type FollowUpDeps } from '../src/daemon/follow-up';
import { personKey, type PersonKey } from './phone-harness';

/**
 * Words typed on a phone into one session: they reach it as they are, and only under that phone's
 * Face ID over exactly that session and those words.
 */

const NOW = '2026-10-15T10:00:00.000Z';
const SESSION = 'ses_follow';
const WORDS = 'Archive a new build for App Store Connect so I can test';

interface Phone {
  home: string;
  key: PersonKey;
  principal: RemotePrincipal;
  sent: string[];
  deps: FollowUpDeps;
}

async function phone(
  capabilities: readonly RemoteCapability[] = PHONE_DEFAULT_CAPABILITIES,
  how = 'queued',
): Promise<Phone> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-follow-up-'));
  const key = personKey();
  const device: DeviceRecord = {
    id: 'dev_phone',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint: key.point,
    noiseStatic: Buffer.alloc(32, 7).toString('base64'),
    capabilities: [...capabilities],
    pairedAt: NOW,
  };
  await new Devices(home).add(device);
  const sent: string[] = [];
  const deps: FollowUpDeps = {
    home,
    now: () => NOW,
    agentOf: async (sessionId) => (sessionId === SESSION ? 'claude-code' : null),
    send: async (instruction) => {
      sent.push(instruction);
      return { sent: true, how };
    },
  };
  return { home, key, principal: { device, driving: false }, sent, deps };
}

function request(fields: Partial<DaemonRequest>): DaemonRequest {
  return {
    id: 7,
    method: DAEMON_METHOD.FOLLOW_UP,
    sessionId: SESSION,
    said: WORDS,
    ...fields,
  };
}

describe('a follow up typed on a phone', () => {
  it('needs steer from afar, which a phone holds once paired', () => {
    expect(remoteCapabilityFor(DAEMON_METHOD.FOLLOW_UP)).toBe(REMOTE_CAPABILITY.STEER);
    expect(PHONE_DEFAULT_CAPABILITIES).toContain(REMOTE_CAPABILITY.STEER);
  });

  it('hands the words to the session as they are once that phone signed them', async () => {
    const p = await phone();
    const signature = p.key.signs(followUpMessage(SESSION, WORDS));
    const answer = await followUpAnswer(request({ signature }), p.deps, p.principal);
    expect(answer).toEqual({ id: 7, ok: true, outcome: 'queued' });
    expect(p.sent).toHaveLength(1);
    const kept = await new SpokenInstructions(p.home).take(p.sent[0] ?? '', NOW);
    expect(kept).toMatchObject({
      sessionId: SESSION,
      agent: 'claude-code',
      message: WORDS,
    });
  });

  it('refuses words with no signature, and sends nothing', async () => {
    const p = await phone();
    const answer = await followUpAnswer(request({}), p.deps, p.principal);
    expect(answer.ok).toBe(false);
    expect(answer.reason).toContain('Face ID on iPhone');
    expect(p.sent).toEqual([]);
  });

  it('refuses a signature over other words or another session', async () => {
    const p = await phone();
    const otherWords = p.key.signs(followUpMessage(SESSION, 'git push --force'));
    const otherSession = p.key.signs(followUpMessage('ses_other', WORDS));
    expect(
      (await followUpAnswer(request({ signature: otherWords }), p.deps, p.principal)).ok,
    ).toBe(false);
    expect(
      (await followUpAnswer(request({ signature: otherSession }), p.deps, p.principal))
        .ok,
    ).toBe(false);
    expect(p.sent).toEqual([]);
  });

  it('refuses a phone that signed but no longer holds steer', async () => {
    const p = await phone([REMOTE_CAPABILITY.SEE, REMOTE_CAPABILITY.ASK]);
    const signature = p.key.signs(followUpMessage(SESSION, WORDS));
    const answer = await followUpAnswer(request({ signature }), p.deps, p.principal);
    expect(answer.ok).toBe(false);
    expect(p.sent).toEqual([]);
  });

  it('refuses empty words and a session this machine does not have', async () => {
    const p = await phone();
    const blank = p.key.signs(followUpMessage(SESSION, '  '));
    expect(
      (
        await followUpAnswer(
          request({ said: '  ', signature: blank }),
          p.deps,
          p.principal,
        )
      ).ok,
    ).toBe(false);
    const gone = p.key.signs(followUpMessage('ses_gone', WORDS));
    const answer = await followUpAnswer(
      request({ sessionId: 'ses_gone', signature: gone }),
      p.deps,
      p.principal,
    );
    expect(answer.reason).toContain('not on this Mac');
    expect(p.sent).toEqual([]);
  });

  it('says a prefilled editor box as typed, and a failed delivery as refused with its reason', async () => {
    const typed = await phone(PHONE_DEFAULT_CAPABILITIES, 'prefilled');
    const signature = typed.key.signs(followUpMessage(SESSION, WORDS));
    expect(
      (await followUpAnswer(request({ signature }), typed.deps, typed.principal)).outcome,
    ).toBe('typed');
    const failed = await phone();
    failed.deps.send = async () => ({
      sent: false,
      how: 'failed',
      why: 'the tab is gone',
    });
    const again = failed.key.signs(followUpMessage(SESSION, WORDS));
    const answer = await followUpAnswer(
      request({ signature: again }),
      failed.deps,
      failed.principal,
    );
    expect(answer).toMatchObject({ ok: false, reason: 'the tab is gone' });
  });

  it('says words typed into the desktop app a session lives in as typed', async () => {
    const p = await phone(PHONE_DEFAULT_CAPABILITIES, 'typed in its app');
    const signature = p.key.signs(followUpMessage(SESSION, WORDS));
    const answer = await followUpAnswer(request({ signature }), p.deps, p.principal);
    expect(answer).toMatchObject({ ok: true, outcome: 'typed' });
  });

  it('takes a signature from a trusted device at the Mac on the local socket', async () => {
    const p = await phone();
    const signature = p.key.signs(followUpMessage(SESSION, WORDS));
    expect((await followUpAnswer(request({ signature }), p.deps)).ok).toBe(true);
    expect((await followUpAnswer(request({}), p.deps)).reason).toContain(
      'Touch ID on this Mac',
    );
  });
});

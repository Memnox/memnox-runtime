import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_KIND,
  Devices,
  PendingApprovals,
  PROPOSAL_KIND,
  Proposals,
  type DeviceRecord,
  type HoldRequest,
} from '@memnox/core';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import { answeringPhone } from '../src/remote/answer-on';
import { PhoneWakes } from '../src/remote/wake';

const NOW = '2026-10-24T19:40:36.000Z';

function phone(
  id: string,
  pairedAt: string,
  more: Partial<DeviceRecord> = {},
): DeviceRecord {
  return {
    id,
    name: `phone ${id}`,
    kind: DEVICE_KIND.PHONE,
    signingPoint: 'point',
    capabilities: ['see', 'ask', 'answer', 'steer'],
    pairedAt,
    mailbox: `box_${id}`,
    ...more,
  };
}

const HELD: HoldRequest = {
  sessionId: 'ses_shop',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

describe('the phone a yes waits on', () => {
  it('is the phone paired last that may answer it', () => {
    const devices = [
      phone('a', '2026-10-01T00:00:00.000Z'),
      phone('b', '2026-10-02T00:00:00.000Z'),
    ];
    expect(answeringPhone(devices, 'answer')).toEqual({ deviceId: 'b', name: 'phone b' });
  });

  it('is the phone named first when that one may answer it', () => {
    const devices = [
      phone('a', '2026-10-01T00:00:00.000Z'),
      phone('b', '2026-10-02T00:00:00.000Z'),
    ];
    expect(answeringPhone(devices, 'answer', 'a')?.deviceId).toBe('a');
  });

  it('is nobody once the phone is unpaired, lacks what it takes, or only the Mac may answer', () => {
    const revoked = [phone('a', NOW, { revokedAt: NOW })];
    expect(answeringPhone(revoked, 'answer')).toBeNull();
    expect(answeringPhone([phone('a', NOW)], 'rules')).toBeNull();
    expect(answeringPhone([phone('a', NOW)], null)).toBeNull();
    const desktop = [phone('a', NOW, { kind: DEVICE_KIND.DESKTOP })];
    expect(answeringPhone(desktop, 'answer')).toBeNull();
  });
});

describe('what waits, while a phone is paired', () => {
  it('names that phone on a held call, so the Mac leaves the yes to its Face ID', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answer-on-'));
    await new Devices(home).add(phone('dev_1', NOW));
    await new PendingApprovals(home).raise(HELD, NOW, 120_000);

    const [event] = await new WaitingFeed(home).current(NOW);
    expect(event?.answerOn).toEqual({ deviceId: 'dev_1', name: 'phone dev_1' });
  });

  it('names nobody with no phone paired, so the Mac asks Touch ID as before', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answer-on-'));
    await new PendingApprovals(home).raise(HELD, NOW, 120_000);

    const [event] = await new WaitingFeed(home).current(NOW);
    expect(event?.answerOn).toBeUndefined();
  });

  it('names the asking phone as the origin of a Mac proposal, whoever holds the voice', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answer-on-'));
    await new Devices(home).add(
      phone('dev_1', NOW, { capabilities: ['see', 'answer', 'mac'] }),
    );
    await new Devices(home).add(phone('dev_2', '2026-10-25T00:00:00.000Z'));
    await new Proposals(home).propose({
      change: {
        kind: PROPOSAL_KIND.MAC,
        deviceId: 'dev_1',
        event: {
          kind: 'show',
          subject: 'dsp_1',
          agent: 'claude-code',
          summary: 'Fix the vulnerabilities',
          at: NOW,
          display: 'type',
        },
      },
      rationale: 'Type into Claude Code on your Mac',
      proposedBy: 'memnox',
      at: NOW,
      ttlMs: 120_000,
    });

    const [event] = await new WaitingFeed(home).current(NOW);
    expect(event).toMatchObject({
      kind: 'proposal',
      origin: { deviceId: 'dev_1' },
      answerOn: { deviceId: 'dev_1' },
    });
  });

  it('names the phone on any proposal it may answer, such as resuming a session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-answer-on-'));
    await new Devices(home).add(phone('dev_1', NOW));
    await new Proposals(home).propose({
      change: { kind: PROPOSAL_KIND.RESUME, sessionId: 'ses_1' },
      rationale: 'resume it',
      proposedBy: 'memnox',
      at: NOW,
      ttlMs: 60_000,
    });

    const [event] = await new WaitingFeed(home).current(NOW);
    expect(event?.answerOn?.deviceId).toBe('dev_1');
  });
});

describe('waking a phone', () => {
  const at = Date.parse(NOW);

  it('wakes it later for what arrived inside the spacing, rather than never', () => {
    const wakes = new PhoneWakes();
    const phones = [phone('a', NOW)];
    const away = { live: (): boolean => false };
    expect(wakes.due(['prp_1'], phones, { ...away, now: at })).toHaveLength(1);
    expect(
      wakes.due(['prp_1', 'prp_2'], phones, { ...away, now: at + 1_000 }),
    ).toHaveLength(0);
    expect(
      wakes.due(['prp_1', 'prp_2'], phones, { ...away, now: at + 61_000 }),
    ).toHaveLength(1);
    expect(
      wakes.due(['prp_1', 'prp_2'], phones, { ...away, now: at + 200_000 }),
    ).toHaveLength(0);
  });

  it('never wakes a phone whose app hears it on its own stream', () => {
    const wakes = new PhoneWakes();
    const phones = [phone('a', NOW)];
    expect(wakes.due(['prp_1'], phones, { live: () => true, now: at })).toHaveLength(0);
    expect(
      wakes.due(['prp_1'], phones, { live: () => false, now: at + 1_000 }),
    ).toHaveLength(0);
  });
});

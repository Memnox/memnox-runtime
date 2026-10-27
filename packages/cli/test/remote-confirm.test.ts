import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  confirmationMessage,
  DEVICE_KIND,
  Devices,
  driveMessage,
  FileGrants,
  HOLD_ANSWER,
  HOLD_OUTCOME,
  HoldService,
  PendingApprovals,
  PHONE_DEFAULT_CAPABILITIES,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  REMOTE_CAPABILITY,
  RoutedHoldPrompt,
  type DaemonEvent,
  type DeviceRecord,
  type DrivenBy,
  type HoldRequest,
  type HoldResult,
} from '@memnox/core';
import { confirmAnswer, type RemotePrincipal } from '../src/daemon/confirm';
import { DriveGrants, driveRefusal } from '../src/remote/drive';
import { withEvents } from '../src/event-store';
import { personKey, type PersonKey } from './phone-harness';

/**
 * A phone's answer to what is held on the Mac. A yes is always signed by that phone's own key,
 * the inside the session exception is the Mac's alone, and a drive covers only Mac proposals.
 */

const NOW = '2026-10-05T10:00:00.000Z';
const TEN_SECONDS = 10_000;

const PUSH: HoldRequest = {
  sessionId: 'ses_phone',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

const INSIDE: HoldRequest = {
  ...PUSH,
  operation: 'filesystem.delete',
  withinSession: true,
};

const SHOW: DaemonEvent = {
  kind: 'show',
  subject: 'dsp_1',
  agent: 'claude-code',
  summary: 'run the tests',
  at: NOW,
  display: 'type',
  needsMac: true,
};

interface Held {
  home: string;
  id: string;
  result: Promise<HoldResult>;
  phone: PersonKey;
  device: DeviceRecord;
}

async function held(request: HoldRequest = PUSH): Promise<Held> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-remote-confirm-'));
  const phone = personKey();
  const device: DeviceRecord = {
    id: 'dev_phone',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint: phone.point,
    noiseStatic: Buffer.alloc(32, 5).toString('base64'),
    capabilities: [...PHONE_DEFAULT_CAPABILITIES],
    pairedAt: NOW,
  };
  await new Devices(home).add(device);
  const approvals = new PendingApprovals(home);
  const service = new HoldService(
    new RoutedHoldPrompt({ approvals, pollMs: 10 }),
    TEN_SECONDS,
    new FileGrants(home),
  );
  const result = service.hold(request);
  const id = await raised(approvals);
  return { home, id, result, phone, device };
}

async function raised(approvals: PendingApprovals): Promise<string> {
  for (let tries = 0; tries < 200; tries += 1) {
    const [first] = await approvals.list(new Date().toISOString());
    if (first !== undefined) return first.id;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('the call was never held');
}

function from(device: DeviceRecord, driving = false): RemotePrincipal {
  return { device, driving };
}

function now(): string {
  return new Date().toISOString();
}

describe('a yes from a paired phone', () => {
  it('lets the call through when that phone signed it, and records which phone', async () => {
    const call = await held();
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      signature: call.phone.signs(confirmationMessage(call.id, HOLD_ANSWER.ONCE)),
      at: now(),
      principal: from(call.device),
    });

    expect(said).toEqual({ ok: true, outcome: HOLD_ANSWER.ONCE });
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.ALLOWED });
    const rows = await withEvents(call.home, (store) =>
      store.query({ sessionId: PUSH.sessionId, limit: 10 }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        actorType: 'human',
        authorizedBy: 'person (Face ID, iPhone)',
      }),
    );
  });

  it('refuses an unsigned yes from a phone even for a call inside its session', async () => {
    const call = await held(INSIDE);
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      at: now(),
      principal: from(call.device),
    });

    expect(said).toMatchObject({ ok: false, refused: true });
    expect((await new PendingApprovals(call.home).read(call.id))?.answer).toBeUndefined();
  });

  it('refuses a yes signed by a different key than the phone it came from', async () => {
    const call = await held();
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      signature: personKey().signs(confirmationMessage(call.id, HOLD_ANSWER.ONCE)),
      at: now(),
      principal: from(call.device),
    });

    expect(said.ok).toBe(false);
  });

  it('takes a no from a phone with no signature', async () => {
    const call = await held();
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.DENY,
      at: now(),
      principal: from(call.device),
    });

    expect(said.ok).toBe(true);
    expect(await call.result).toMatchObject({ outcome: HOLD_OUTCOME.DENIED });
  });

  it('refuses a revoked phone, however well it signed', async () => {
    const call = await held();
    const revoked = await new Devices(call.home).revoke(call.device.id, NOW);
    const said = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      signature: call.phone.signs(confirmationMessage(call.id, HOLD_ANSWER.ONCE)),
      at: now(),
      principal: from(revoked ?? call.device),
    });

    expect(said).toMatchObject({ ok: false, refused: true });
  });

  it('refuses a rule proposal from a phone that was never given rules', async () => {
    const call = await held();
    const proposal = await new Proposals(call.home).propose({
      change: {
        kind: PROPOSAL_KIND.RULES,
        file: join(call.home, 'memnox.policies.toml'),
        rules: [],
      },
      rationale: 'always allow pushes',
      proposedBy: 'memnox',
      at: now(),
      ttlMs: TEN_SECONDS,
    });
    const said = await confirmAnswer(call.home, {
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: call.phone.signs(
        confirmationMessage(proposal.id, PROPOSAL_ANSWER.CONFIRMED),
      ),
      at: now(),
      principal: from(call.device),
    });

    expect(said).toMatchObject({ ok: false, refused: true });
    expect((await new Proposals(call.home).read(proposal.id))?.answer).toBeUndefined();
  });
});

describe('driving the Mac from a phone', () => {
  function withMac(device: DeviceRecord): DeviceRecord {
    return { ...device, capabilities: [...device.capabilities, REMOTE_CAPABILITY.MAC] };
  }

  it('needs mac, a signature over exactly that time, and at most fifteen minutes', async () => {
    const call = await held();
    const device = withMac(call.device);
    const soon = '2026-10-05T10:10:00.000Z';
    const tooLate = '2026-10-05T10:30:00.000Z';

    expect(
      driveRefusal(
        call.device,
        { until: soon, signature: call.phone.signs(driveMessage(device.id, soon)) },
        NOW,
      ),
    ).toContain('may not');
    expect(driveRefusal(device, { until: soon }, NOW)).toContain('Face ID');
    expect(
      driveRefusal(
        device,
        { until: tooLate, signature: call.phone.signs(driveMessage(device.id, tooLate)) },
        NOW,
      ),
    ).toContain('fifteen');
    expect(
      driveRefusal(
        device,
        { until: NOW, signature: call.phone.signs(driveMessage(device.id, NOW)) },
        NOW,
      ),
    ).not.toBeNull();
    expect(
      driveRefusal(
        device,
        { until: soon, signature: call.phone.signs(driveMessage(device.id, soon)) },
        NOW,
      ),
    ).toBeNull();
  });

  it("runs that phone's Mac proposal unsigned while driving, and never a held call", async () => {
    const call = await held();
    const device = withMac(call.device);
    const proposals = new Proposals(call.home);
    const mac = await proposals.propose({
      change: { kind: PROPOSAL_KIND.MAC, deviceId: device.id, event: SHOW },
      rationale: 'type into Claude Code',
      proposedBy: 'memnox',
      at: now(),
      ttlMs: TEN_SECONDS,
    });

    const notDriving = await confirmAnswer(call.home, {
      subject: mac.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      at: now(),
      principal: from(device),
    });
    const heldCall = await confirmAnswer(call.home, {
      subject: call.id,
      answer: HOLD_ANSWER.ONCE,
      at: now(),
      principal: from(device, true),
    });
    const driven = await confirmAnswer(call.home, {
      subject: mac.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      at: now(),
      principal: from(device, true),
    });

    expect(notDriving).toMatchObject({ ok: false, refused: true });
    expect(heldCall).toMatchObject({ ok: false, refused: true });
    expect(driven).toEqual({
      ok: true,
      outcome: PROPOSAL_ANSWER.CONFIRMED,
      release: { event: SHOW, deviceId: device.id },
    });
    expect((await proposals.read(mac.id))?.answeredBy).toBe(
      'person (driving from iPhone)',
    );
  });

  it('ends a grant at its time, on a stop, and says so both times with no until', () => {
    let clock = NOW;
    const told: DrivenBy[] = [];
    const grants = new DriveGrants(
      () => clock,
      (drivenBy) => void told.push(drivenBy),
    );
    const device = withMac({
      id: 'dev_phone',
      name: 'iPhone',
      kind: DEVICE_KIND.PHONE,
      signingPoint: '',
      capabilities: [],
      pairedAt: NOW,
    });

    grants.start(device, '2026-10-05T10:15:00.000Z');
    expect(grants.driving(device.id)).toBe(true);
    clock = '2026-10-05T10:15:00.001Z';
    expect(grants.driving(device.id)).toBe(false);
    grants.start(device, '2026-10-05T10:20:00.000Z');
    expect(grants.stop(device.id)).toBe(true);
    expect(grants.stop(device.id)).toBe(false);
    grants.close();

    const stop = { deviceId: 'dev_phone', name: 'iPhone' };
    expect(told).toEqual([
      { ...stop, until: '2026-10-05T10:15:00.000Z' },
      stop,
      { ...stop, until: '2026-10-05T10:20:00.000Z' },
      stop,
    ]);
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  confirmationMessage,
  DAEMON_EVENT,
  DEVICE_KIND,
  Devices,
  PHONE_DEFAULT_CAPABILITIES,
  Proposals,
  type DeviceRecord,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import {
  keepTeamCalls,
  teamCallsContext,
  teamCallsNow,
} from '../src/daemon/team-calls-store';
import { WaitingFeed } from '../src/daemon/waiting-feed';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { proposeAnswerTool } from '../src/session-tools/propose-tools';
import { personKey } from './phone-harness';

/**
 * A team's question answered out loud: the voice only writes the answer down, and the device the
 * person asked from carries it out with the workspace, a yes signed there and a no sent as it is.
 */

const NOW = new Date('2026-10-06T10:00:00.000Z');
const CALL = {
  id: 'apr_team1',
  label: "Codex on build-box, from Ana's team",
  what: 'push to main',
};

async function setUp(): Promise<{
  deps: SessionToolDeps;
  device: DeviceRecord;
  sign: (m: string) => string;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-team-voice-'));
  const phone = personKey();
  const device: DeviceRecord = {
    id: 'dev_phone',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint: phone.point,
    noiseStatic: Buffer.alloc(32, 5).toString('base64'),
    capabilities: [...PHONE_DEFAULT_CAPABILITIES],
    pairedAt: NOW.toISOString(),
  };
  await new Devices(home).add(device);
  await keepTeamCalls(home, [CALL], NOW.toISOString());
  const deps: SessionToolDeps = {
    home,
    cwd: home,
    agent: 'memnox-operator',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
  return { deps, device, sign: (message) => phone.signs(message) };
}

describe("answering a team's question by voice", () => {
  it('writes it down as a team answer the device carries out, never answering it here', async () => {
    const { deps } = await setUp();

    const said = (await proposeAnswerTool(deps, { call: CALL.id, answer: 'once' })) as {
      proposed: string;
    };

    const proposal = await new Proposals(deps.home).read(said.proposed);
    expect(proposal?.change).toEqual({
      kind: 'team',
      callId: CALL.id,
      answer: 'once',
      label: CALL.label,
    });
    const events = await new WaitingFeed(deps.home).current(NOW.toISOString());
    const shown = events.find((each) => each.kind === DAEMON_EVENT.PROPOSAL);
    expect(shown?.teamAnswer).toEqual({
      callId: CALL.id,
      answer: 'once',
      label: CALL.label,
    });
  });

  it('takes a signed confirmation for a yes, and a no with no signature at all', async () => {
    const { deps, device, sign } = await setUp();
    const yes = (await proposeAnswerTool(deps, { call: CALL.id, answer: 'once' })) as {
      proposed: string;
    };
    const no = (await proposeAnswerTool(deps, { call: CALL.id, answer: 'deny' })) as {
      proposed: string;
    };
    const principal = { device, driving: false };
    const at = NOW.toISOString();

    const unsignedYes = await confirmAnswer(deps.home, {
      subject: yes.proposed,
      answer: 'confirmed',
      at,
      principal,
    });
    const signedYes = await confirmAnswer(deps.home, {
      subject: yes.proposed,
      answer: 'confirmed',
      signature: sign(confirmationMessage(yes.proposed, 'confirmed')),
      at,
      principal,
    });
    const unsignedNo = await confirmAnswer(deps.home, {
      subject: no.proposed,
      answer: 'confirmed',
      at,
      principal,
    });

    expect(unsignedYes.ok).toBe(false);
    expect(signedYes).toMatchObject({ ok: true, outcome: 'confirmed' });
    expect(unsignedNo).toMatchObject({ ok: true, outcome: 'confirmed' });
  });

  it('forgets the team questions a device named once they are stale, and words them for the voice', async () => {
    const { deps } = await setUp();
    const later = new Date(NOW.getTime() + 11 * 60_000).toISOString();

    expect(await teamCallsNow(deps.home, NOW.toISOString())).toEqual([CALL]);
    expect(await teamCallsNow(deps.home, later)).toEqual([]);
    expect(teamCallsContext([CALL])).toContain(`team call id ${CALL.id}`);
    expect(teamCallsContext([])).toBe('');
  });
});

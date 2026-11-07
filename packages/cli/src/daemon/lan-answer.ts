import {
  LAN_METHOD,
  minutesToMs,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  readLanSetting,
  saveLanSetting,
  type DaemonRequest,
  type DaemonResponse,
  type LanStatus,
  type ProposedChange,
} from '@memnox/core';
import { lanControl } from '../remote/lan-control';

/**
 * The local network methods. Turning it off only narrows who reaches this machine, so it is done at
 * once; turning it on widens that, so it is a proposal the Mac signs, and never asked from a phone.
 */

const LAN_METHODS: readonly string[] = Object.values(LAN_METHOD);

/** Who proposed it, as the card names it: the settings page, on the person's own request. */
const PROPOSED_BY = 'agt_memnox-lan';
const PROPOSAL_TTL_MS = minutesToMs(5);

export function isLanMethod(method: string): boolean {
  return LAN_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function lanAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered => {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: reason, reason };
  });
  return { id: request.id, ...answered };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  if (request.method === LAN_METHOD.LAN_STATUS)
    return { ok: true, lan: await lanStatus(home) };
  if (request.lanOn === undefined) {
    const reason = 'lan-set needs lanOn, true or false.';
    return { ok: false, error: reason, reason };
  }
  if (!request.lanOn) {
    await saveLanSetting(home, false);
    await lanControl(home)?.refresh();
    return { ok: true, lan: await lanStatus(home) };
  }
  if (await readLanSetting(home)) return { ok: true, lan: await lanStatus(home) };
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.LAN, on: true },
    rationale: 'Let paired phones reach this machine on the local network',
    proposedBy: PROPOSED_BY,
    at: now.toISOString(),
    ttlMs: PROPOSAL_TTL_MS,
  });
  return { ok: true, proposed: proposal.id, lan: await lanStatus(home) };
}

/** The live listener's word where a daemon runs one, else the setting alone with nothing listening. */
async function lanStatus(home: string): Promise<LanStatus> {
  const control = lanControl(home);
  if (control !== null) return control.status();
  return {
    on: await readLanSetting(home),
    listening: false,
    addresses: [],
    advertised: false,
    reachable: [],
  };
}

/** A signed yes to listening, carried out and the listener opened. Null where the proposal is another. */
export async function applyLanProposal(
  home: string,
  change: ProposedChange,
): Promise<{ ok: true; outcome: string } | null> {
  if (change.kind !== PROPOSAL_KIND.LAN) return null;
  await saveLanSetting(home, true);
  await lanControl(home)?.refresh();
  return { ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED };
}

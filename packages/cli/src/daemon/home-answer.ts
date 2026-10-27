import { hostname } from 'node:os';
import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  delegations,
  handable,
  HOME_METHOD,
  LEDGER_SCAN_LIMIT,
  promotable,
  type DaemonRequest,
  type DaemonResponse,
  type Delegation,
  type HomeToday,
  type HomeView,
  type HomeWorking,
  type MemnoxEvent,
  type SessionCard,
} from '@memnox/core';
import { withEvents } from '../event-store';
import { codexStandingLately, needsYouOf, readChanged } from '../needs-you';
import { proposeRuleTool } from '../session-tools/propose-tools';
import type { SessionViews } from './session-view';

/**
 * The home every surface opens on, gathered here once so the Mac, the iPhone and the terminal
 * show the same blocks from the same record: waiting, working, today, ready, not covered, and
 * what needs the person.
 */

const HOME_METHODS: readonly string[] = Object.values(HOME_METHOD);

/** How far back the record is read for what could be handed over, as `memnox next` reads it. */
const READY_WINDOW_MS = 30 * 24 * 60 * 60_000;

const WORKING = 'working';

export function isHomeMethod(method: string): boolean {
  return HOME_METHODS.includes(method);
}

type Views = Pick<SessionViews, 'list' | 'deps'>;

/** The few facts the status screen reads, handed in so this module never imports a command. */
export interface HomeStatus {
  mode: string;
  waiting: number;
  agents: number;
  hooked: readonly string[];
  /** Hookable agents found here and not hooked yet; an agent no hook exists for is never counted. */
  unhooked: readonly string[];
  dormant: readonly unknown[];
}

interface HomeInput {
  views: Views;
  now: Date;
  status: (home: string) => Promise<HomeStatus>;
}

export async function homeAnswer(
  home: string,
  request: DaemonRequest,
  input: HomeInput,
): Promise<DaemonResponse> {
  if (request.method === HOME_METHOD.HAND_OVER) return handOver(request, input);
  return { id: request.id, ok: true, home: await readHome(home, input) };
}

/** The five blocks, from the status screen, the sessions and the ledger. */
export async function readHome(home: string, input: HomeInput): Promise<HomeView> {
  const { views, now } = input;
  const [status, cards, events] = await Promise.all([
    input.status(home),
    views.list().catch((): SessionCard[] => []),
    eventsSince(home, new Date(now.getTime() - READY_WINDOW_MS)),
  ]);
  const ready = readyOf(events);
  const needsYou = needsYouOf(
    await readChanged(home),
    events,
    codexStandingLately(home, now.getTime()),
  );
  return {
    machine: hostname(),
    mode: status.mode,
    waiting: status.waiting,
    working: cards
      .filter((card) => card.state === WORKING || card.thinking)
      .map(workingOf),
    today: todayOf(events, now),
    ...(ready === undefined ? {} : { ready: readyView(ready) }),
    notCovered: {
      unprotected: status.unhooked.length,
      dormant: status.dormant.length,
    },
    ...(needsYou.length === 0 ? {} : { needsYou }),
  };
}

/** The ready suggestion as a rule proposal; nothing is allowed until the person signs it. */
async function handOver(
  request: DaemonRequest,
  { views, now }: HomeInput,
): Promise<DaemonResponse> {
  const deps = views.deps();
  const events = await eventsSince(deps.home, new Date(now.getTime() - READY_WINDOW_MS));
  const found = promotable(delegations(events)).find(
    (each) => each.action === request.action && handable(each),
  );
  if (found === undefined) {
    const reason = `${request.action ?? 'That'} is not ready to hand over.`;
    return { id: request.id, ok: false, error: reason, reason };
  }
  const proposed = (await proposeRuleTool(deps, {
    action: found.action,
    effect: DECISION_EFFECT.ALLOW,
    reason: found.because,
    ...(found.targets.length === 0 ? {} : { paths: found.targets.join(', ') }),
  })) as { proposed?: string; refused?: string };
  if (proposed.proposed === undefined) {
    const reason = proposed.refused ?? 'The rule could not be proposed.';
    return { id: request.id, ok: false, error: reason, reason };
  }
  return { id: request.id, ok: true, proposed: proposed.proposed };
}

async function eventsSince(home: string, since: Date): Promise<MemnoxEvent[]> {
  return withEvents(home, (store) =>
    store.query({ since: since.toISOString(), limit: LEDGER_SCAN_LIMIT }),
  );
}

function readyOf(events: readonly MemnoxEvent[]): Delegation | undefined {
  return promotable(delegations(events)).find((each) => handable(each));
}

function readyView(ready: Delegation): HomeView['ready'] {
  return {
    action: ready.action,
    approvals: ready.approvals,
    targets: [...ready.targets],
    because: ready.because,
  };
}

/** Since local midnight: what agents did, what asked, what a person allowed, what was refused. */
function todayOf(events: readonly MemnoxEvent[], now: Date): HomeToday {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = events.filter((event) => event.at >= midnight.toISOString());
  const said = (event: MemnoxEvent): string => event.shadowEffect ?? event.effect;
  return {
    actions: today.filter((event) => event.actorType !== ACTOR_TYPE.HUMAN).length,
    asked: today.filter((event) => said(event) === DECISION_EFFECT.ASK).length,
    allowed: today.filter(
      (event) =>
        event.actorType === ACTOR_TYPE.HUMAN && event.effect === DECISION_EFFECT.ALLOW,
    ).length,
    refused: today.filter((event) => said(event) === DECISION_EFFECT.DENY).length,
  };
}

function workingOf(card: SessionCard): HomeWorking {
  return {
    sessionId: card.sessionId,
    agent: card.agent,
    agentName: card.agentName,
    ...(card.task === undefined ? {} : { task: card.task }),
    ...(card.repository === undefined ? {} : { repository: card.repository }),
  };
}

import {
  ACTIVITY_KIND,
  ACTIVITY_METHOD,
  DECISION_EFFECT,
  type ActivityFilter,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { exportActivity, readActivityPage } from '../studio/activity-read';
import { readDecision } from '../studio/decision-read';

/**
 * The activity screen's methods, every one a read: a page of the ledger, one decision whole, and
 * a period exported signed. Names only, never arguments, output or a file's contents.
 */

const ACTIVITY_METHODS: readonly string[] = Object.values(ACTIVITY_METHOD);
const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);
const KINDS: readonly string[] = Object.values(ACTIVITY_KIND);
const TEXT_FIELDS = ['agent', 'text', 'since', 'until'] as const;

export function isActivityMethod(method: string): boolean {
  return ACTIVITY_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

export async function activityAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  return { id: request.id, ...answered };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  if (request.method === ACTIVITY_METHOD.DECISION) {
    const id = request.decisionId;
    if (id === undefined || id === '') return refused('Name the decision, by its id.');
    const decision = await readDecision(home, id);
    return decision === null
      ? refused(`No action ${id} on this machine.`)
      : { ok: true, decision };
  }
  const filter = filterFrom(request.activityFilter);
  if (filter === null)
    return refused('The filter names an effect, a kind or a field it cannot hold.');
  if (request.method === ACTIVITY_METHOD.ACTIVITY_EXPORT)
    return { ok: true, activityBundle: await exportActivity(home, filter, now) };
  const activity = await readActivityPage(home, {
    filter,
    ...(request.activityCursor === undefined ? {} : { cursor: request.activityCursor }),
    ...(typeof request.activityLimit === 'number'
      ? { limit: request.activityLimit }
      : {}),
  });
  return { ok: true, activity };
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

/** The filter as a screen sent it, which is untrusted JSON until every field is checked. */
function filterFrom(value: unknown): ActivityFilter | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { effect, kind } = raw;
  if (effect !== undefined && (typeof effect !== 'string' || !EFFECTS.includes(effect)))
    return null;
  if (kind !== undefined && (typeof kind !== 'string' || !KINDS.includes(kind)))
    return null;
  const filter: ActivityFilter = {
    // Casts are safe: each was checked against its own list just above.
    ...(effect === undefined ? {} : { effect: effect as ActivityFilter['effect'] }),
    ...(kind === undefined ? {} : { kind: kind as ActivityFilter['kind'] }),
  };
  for (const field of TEXT_FIELDS) {
    const text = raw[field];
    if (text === undefined) continue;
    if (typeof text !== 'string') return null;
    filter[field] = text;
  }
  return filter;
}

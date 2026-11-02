import type { ToolConnection } from '@memnox/core';

/** The person's sign ins as the cloud lists them, folded into one connection per app for a screen. */

/** One of the person's sign ins as the workspace lists it under `me/grants`. */
export interface PersonGrant {
  id: string;
  toolkit: string;
  status?: string;
  enabled?: boolean;
  /** When it was made, sent by a cloud new enough to say. */
  connectedAt?: string;
}

/** The cloud's word for a sign in that works right now. */
const GRANT_ACTIVE = 'active';

/**
 * One entry per toolkit, connected when any of its sign ins is active and enabled, sorted by toolkit,
 * dated by the earliest of its working sign ins, since that is how long it has been connected.
 */
export function connectionsFrom(grants: readonly PersonGrant[]): ToolConnection[] {
  const byToolkit = new Map<string, { connected: boolean; since?: string }>();
  for (const grant of grants) {
    if (typeof grant.toolkit !== 'string' || grant.toolkit === '') continue;
    const toolkit = grant.toolkit.toLowerCase();
    const live = grant.status?.toLowerCase() === GRANT_ACTIVE && grant.enabled === true;
    const held = byToolkit.get(toolkit) ?? { connected: false };
    const at = live ? dateOf(grant.connectedAt) : undefined;
    const since =
      at !== undefined && (held.since === undefined || at < held.since) ? at : held.since;
    byToolkit.set(toolkit, {
      connected: held.connected || live,
      ...(since === undefined ? {} : { since }),
    });
  }
  return [...byToolkit.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([toolkit, { connected, since }]) => ({
      toolkit,
      connected,
      ...(since === undefined ? {} : { connectedAt: since }),
    }));
}

/** The instant as the cloud wrote it, normalised so two compare as text; undefined for anything that is no date. */
function dateOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

import { CHECK, CHECK_NAME, type HealthCheck } from './health.constants';

/**
 * Whether Codex runs Memnox's hooks, as Codex itself reports them. Codex trusts a hook by a
 * hash of its entry, so a rewrite of the command leaves a hook it silently no longer runs.
 */
export const CODEX_HOOK_TRUST = {
  /** Codex is not on this machine, or Memnox's hook is not in its hooks file. */
  ABSENT: 'absent',
  /** Codex could not be asked: not on PATH, too old for the question, or no answer in time. */
  UNKNOWN: 'unknown',
  TRUSTED: 'trusted',
  /** In the file, and Codex lists it as untrusted or disabled. */
  UNTRUSTED: 'untrusted',
  /** In the file, and Codex lists none of it, which is its hooks feature turned off. */
  NOT_LOADED: 'not-loaded',
} as const;

export type CodexHookTrust = (typeof CODEX_HOOK_TRUST)[keyof typeof CODEX_HOOK_TRUST];

export interface CodexHookStanding {
  trust: CodexHookTrust;
  /** The events whose Memnox hook Codex will not run, by Codex's own names. */
  untrusted?: readonly string[];
}

/** The trust states Codex reports for a hook it will run. */
const RUNS: readonly unknown[] = ['trusted', 'managed'];

/**
 * What Codex's `hooks/list` answer says about the hooks whose command names `marker`.
 * Read defensively: the answer is Codex's, and only the fields asked about are trusted.
 */
export function codexHookStandingOf(result: unknown, marker: string): CodexHookStanding {
  const data = (result as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { trust: CODEX_HOOK_TRUST.UNKNOWN };
  const ours = data
    .flatMap((entry) => {
      const hooks = (entry as { hooks?: unknown } | null)?.hooks;
      return Array.isArray(hooks) ? hooks : [];
    })
    .map((hook) => (hook ?? {}) as Record<string, unknown>)
    .filter(
      (hook) => typeof hook['command'] === 'string' && hook['command'].includes(marker),
    );
  if (ours.length === 0) return { trust: CODEX_HOOK_TRUST.NOT_LOADED };
  const untrusted = ours
    .filter((hook) => hook['enabled'] !== true || !RUNS.includes(hook['trustStatus']))
    .map((hook) =>
      typeof hook['eventName'] === 'string' ? hook['eventName'] : 'a hook',
    );
  return untrusted.length === 0
    ? { trust: CODEX_HOOK_TRUST.TRUSTED }
    : { trust: CODEX_HOOK_TRUST.UNTRUSTED, untrusted: [...new Set(untrusted)] };
}

/** Whether Codex will run what is in its hooks file, which only Codex can say. */
export function codexHooksCheck(standing: CodexHookStanding): HealthCheck {
  const name = CHECK_NAME.CODEX_HOOKS;
  switch (standing.trust) {
    case CODEX_HOOK_TRUST.ABSENT:
      return { name, state: CHECK.OK, detail: 'no Memnox hook in Codex to check' };
    case CODEX_HOOK_TRUST.TRUSTED:
      return { name, state: CHECK.OK, detail: 'Codex trusts and runs every Memnox hook' };
    case CODEX_HOOK_TRUST.UNKNOWN:
      return {
        name,
        state: CHECK.INERT,
        detail: 'Codex could not be asked whether it runs the Memnox hooks',
        fix: 'open Codex and check /hooks lists the Memnox hooks as trusted',
      };
    case CODEX_HOOK_TRUST.NOT_LOADED:
      return {
        name,
        state: CHECK.BROKEN,
        detail:
          'the Memnox hooks are in ~/.codex/hooks.json and Codex loads none of them',
        fix: 'turn on hooks in Codex, then approve the Memnox hooks in /hooks',
      };
    case CODEX_HOOK_TRUST.UNTRUSTED:
      return {
        name,
        state: CHECK.BROKEN,
        // Never approved, or approved before its entry changed: Codex runs neither.
        detail: `Codex does not run the Memnox hook on ${(standing.untrusted ?? []).join(', ')} until it is approved again`,
        fix: 'open Codex and approve the Memnox hooks in /hooks',
      };
  }
}

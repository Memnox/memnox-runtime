/** The states and names every `doctor --wiring` line is built from. */

export const CHECK = {
  OK: 'ok',
  /** Working, but not doing the thing somebody installed it for. */
  INERT: 'inert',
  /** Broken in a way that stops governance. */
  BROKEN: 'broken',
} as const;

export type CheckState = (typeof CHECK)[keyof typeof CHECK];

export const CHECK_NAME = {
  CONFIG: 'config',
  RULES: 'rules',
  INTERCEPTORS: 'interceptors',
  PATH: 'path',
  PROXY: 'proxy',
  DAEMON: 'daemon',
  LEDGER: 'ledger',
  /**
   * What stops work without a rule saying so: a paused session, a spent allowance, a held
   * path and an unanswered question. None appears in `why`, and all four look alike.
   */
  HOLDS: 'holds',
  /** Where Claude Code's hook lives, since one in the user's own file is one a local edit removes. */
  HOOKS: 'hooks',
  /** Whether Codex runs Memnox's hooks, since it skips one whose entry changed after it was trusted. */
  CODEX_HOOKS: 'codex-hooks',
} as const;

export type CheckName = (typeof CHECK_NAME)[keyof typeof CHECK_NAME];

export interface HealthCheck {
  name: CheckName;
  state: CheckState;
  /** What is true, in one line. */
  detail: string;
  /** The command that fixes it. Absent only when there is nothing to fix. */
  fix?: string;
}

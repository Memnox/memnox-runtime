import { fieldsOf } from './hook-payload';
import { DEFAULT_AGENT_NAME } from './tool-hook.constants';

/**
 * Cursor, Devin and Copilot CLI also run the hooks in Claude Code's settings, so Claude
 * Code's entry fires inside them beside their own. Ruling there would rule each call twice
 * and file one of the rows under the wrong agent, so that entry stands down.
 */

/** Set by Claude Code for every hook it runs, and by nothing else. */
const CLAUDE_HOOK_VAR = 'CLAUDE_PROJECT_DIR';

/** What Cursor and Devin set for the hooks they run, both of which read Claude Code's settings. */
const OTHER_HOST_VARS: readonly string[] = [
  'CURSOR_VERSION',
  'CURSOR_PROJECT_DIR',
  'DEVIN_PROJECT_DIR',
];

/** A field only Cursor's hook payloads carry. */
const CURSOR_PAYLOAD_FIELD = 'cursor_version';

/**
 * Copilot CLI stamps every payload with when it fired, and also runs the hooks in a
 * repository's Claude Code settings; Claude Code sends no such field.
 */
const COPILOT_PAYLOAD_FIELD = 'timestamp';

/**
 * Whether this is Claude Code's entry being run by another host. Their terminal markers are
 * not enough, since a Claude Code started from their terminal inherits them; Claude Code's
 * own hook variable is what tells its runs apart.
 */
export function isBorrowedClaudeHook(
  payload: unknown,
  agent: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (agent !== DEFAULT_AGENT_NAME) return false;
  const hook = fieldsOf(payload);
  if (typeof hook?.[CURSOR_PAYLOAD_FIELD] === 'string') return true;
  if ((env[CLAUDE_HOOK_VAR] ?? '') !== '') return false;
  if (hook?.[COPILOT_PAYLOAD_FIELD] !== undefined) return true;
  return OTHER_HOST_VARS.some((name) => (env[name] ?? '') !== '');
}

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COPILOT_AGENT,
  COPILOT_EVENT,
  DEVIN_AGENT,
  EDIT_HOOK_BINARY,
  EDIT_HOOK_EVENT,
  HOST_EVENT_FLAG,
} from '@memnox/interceptors';
import {
  installSettingsHook,
  namedHookArgv,
  namedHookCommand,
  removeSettingsHook,
  type HookEvent,
} from './claude-hook';

/**
 * The policy hook in GitHub Copilot CLI, in a hooks file of Memnox's own, and in Devin,
 * whose settings take Claude Code's shape. Copilot names no event in its payload, so each
 * of its entries names the event it is installed for.
 */

/** Copilot reads every file in its hooks directory, so Memnox owns one and touches no other. */
export const COPILOT_HOOKS = join('.copilot', 'hooks', 'memnox.json');
const COPILOT_HOME_VAR = 'COPILOT_HOME';
const COPILOT_HOOKS_VERSION = 1;
/** Copilot lets a call through when a hook times out, so this is generous rather than tight. */
const COPILOT_TIMEOUT_SEC = 60;

/** Copilot's event names, each with the Memnox name its entry passes on. */
const COPILOT_EVENTS: Readonly<Record<string, string>> = {
  preToolUse: COPILOT_EVENT.PRE_TOOL,
  postToolUse: COPILOT_EVENT.POST_TOOL,
  userPromptSubmitted: COPILOT_EVENT.PROMPT,
  agentStop: COPILOT_EVENT.TURN_END,
  sessionEnd: COPILOT_EVENT.SESSION_END,
};

/** Devin's settings file, which takes hooks in Claude Code's shape under `hooks`. */
export const DEVIN_SETTINGS = join('.config', 'devin', 'config.json');

/** Before a tool, after one, at a prompt and a stop, and when the session ends. */
const DEVIN_EVENTS: readonly HookEvent[] = [
  { event: EDIT_HOOK_EVENT.PRE_TOOL_USE },
  { event: EDIT_HOOK_EVENT.POST_TOOL_USE },
  { event: EDIT_HOOK_EVENT.USER_PROMPT_SUBMIT },
  { event: EDIT_HOOK_EVENT.STOP },
  { event: EDIT_HOOK_EVENT.SESSION_END },
];

function copilotHooksPath(home: string, env: NodeJS.ProcessEnv): string {
  const own = env[COPILOT_HOME_VAR];
  return own !== undefined && own.trim() !== ''
    ? join(own.trim(), 'hooks', 'memnox.json')
    : join(home, COPILOT_HOOKS);
}

/** PowerShell's call of the same argv, each word quoted the way PowerShell reads it. */
function powershellOf(argv: readonly string[]): string {
  return `& ${argv.map((word) => `'${word.replace(/'/g, "''")}'`).join(' ')}`;
}

/** The whole hooks file, which Memnox owns. */
export function copilotHooksFile(): unknown {
  const hooks: Record<string, unknown[]> = {};
  for (const [event, named] of Object.entries(COPILOT_EVENTS)) {
    const argv = [...namedHookArgv(COPILOT_AGENT), HOST_EVENT_FLAG, named];
    const shell = `${namedHookCommand(COPILOT_AGENT)} ${HOST_EVENT_FLAG} ${named}`;
    hooks[event] = [
      {
        type: 'command',
        // Copilot runs only the key for the platform it is on, so both are written, and the
        // bash line is also how the keeper recognises a current install on any platform.
        bash: shell,
        powershell: powershellOf(argv),
        timeoutSec: COPILOT_TIMEOUT_SEC,
      },
    ];
  }
  return { version: COPILOT_HOOKS_VERSION, hooks };
}

/** The hooks file written, only where Copilot CLI is installed. */
export async function installCopilotHook(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const path = copilotHooksPath(home, env);
  const copilotHome = join(path, '..', '..');
  if (!existsSync(copilotHome)) return false;
  const next = `${JSON.stringify(copilotHooksFile(), null, 2)}\n`;
  const current = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (current !== next) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, next, 'utf8');
  }
  return true;
}

/** Memnox's hooks file deleted, and only that file. True when it was there. */
export async function removeCopilotHook(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const path = copilotHooksPath(home, env);
  if (!existsSync(path)) return false;
  // The name is Memnox's, but a file that does not run the hook is not one it wrote.
  if (!(await readFile(path, 'utf8')).includes(EDIT_HOOK_BINARY)) return false;
  await rm(path, { force: true });
  return true;
}

export async function installDevinHook(home: string): Promise<boolean> {
  return installSettingsHook(
    join(home, DEVIN_SETTINGS),
    namedHookCommand(DEVIN_AGENT),
    DEVIN_EVENTS,
  );
}

export async function removeDevinHook(home: string): Promise<boolean> {
  return removeSettingsHook(join(home, DEVIN_SETTINGS));
}

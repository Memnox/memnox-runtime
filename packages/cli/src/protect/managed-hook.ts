import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DISCOVERED_AGENT_KIND,
  HOOK_SEAT,
  MEMNOX_HOME,
  type HookSeat,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import { markHook } from '../keeper/kept';
import {
  CLAUDE_SETTINGS,
  claudeEvents,
  EVERY_TOOL,
  holdsPolicyHook,
  installClaudeHook,
  namedHookCommand,
  removeClaudeHook,
  withEditHook,
  withoutEditHook,
} from './claude-hook';
import { writeHookLauncher } from './hook-launcher';
import { jsonText } from './json-config';

/**
 * Claude Code's managed settings: root-owned and read ahead of every file a session can
 * write, so a hook there cannot be edited away. Memnox never runs as root: where it cannot
 * write the file it stages it and names the command, so what lands there is read first.
 */
const MANAGED_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: '/Library/Application Support/ClaudeCode/managed-settings.json',
  linux: '/etc/claude-code/managed-settings.json',
};

/** Set only when this turned the user's own hooks off, so a revert never undoes a choice it did not make. */
const EXCLUSIVE_MARKER = '_memnoxExclusive';
const ONLY_MANAGED_HOOKS = 'allowManagedHooksOnly';

/** Where a file that needs root is written first, for a person to install. */
const STAGED = join('managed', 'claude-code', 'managed-settings.json');

type Settings = Record<string, unknown>;

export function managedSettingsPath(
  platform: NodeJS.Platform = process.platform,
): string | null {
  return MANAGED_PATHS[platform] ?? null;
}

/**
 * The hook added, and with `exclusive` every user, project and plugin hook switched off,
 * which also means one a cloned repository ships can never run ahead of this one.
 */
export function withManagedHook(
  settings: Settings,
  command: string,
  exclusive: boolean,
): Settings {
  const hooked: Settings = withEditHook(settings, command, claudeEvents(EVERY_TOOL));
  if (!exclusive || hooked[ONLY_MANAGED_HOOKS] === true) return hooked;
  return { ...hooked, [ONLY_MANAGED_HOOKS]: true, [EXCLUSIVE_MARKER]: true };
}

/** Our hook taken out, and the exclusive switch with it only where this put it there. */
export function withoutManagedHook(settings: Settings): Settings {
  const unhooked: Settings = withoutEditHook(settings);
  if (unhooked[EXCLUSIVE_MARKER] !== true) return unhooked;
  const { [EXCLUSIVE_MARKER]: _marker, [ONLY_MANAGED_HOOKS]: _only, ...rest } = unhooked;
  return rest;
}

/** Where the hook sits, read off the two files' text. */
export function hookSeatOf(user: string | null, managed: string | null): HookSeat {
  const agent = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
  const inUser = user !== null && holdsPolicyHook(user, agent);
  const inManaged = managed !== null && holdsPolicyHook(managed, agent);
  if (inUser && inManaged) return HOOK_SEAT.BOTH;
  if (inManaged) return HOOK_SEAT.MANAGED;
  if (inUser) return HOOK_SEAT.USER;
  return HOOK_SEAT.NONE;
}

interface ManagedSeams {
  home: () => string;
  /** The managed file, injected so a test never needs root. */
  target: () => string | null;
}

const DEFAULT_SEAMS: ManagedSeams = {
  home: homedir,
  target: () => managedSettingsPath(),
};

interface ManagedOptions {
  reverting: boolean;
  exclusive: boolean;
}

/**
 * Moves the hook into managed settings, or back out to the user's own. Run twice when
 * the file needs root: once to stage it, and once after it is installed, which is when
 * the user-level copy is taken out, so no moment passes with neither in place.
 */
export async function runManagedHook(
  context: CliContext,
  options: ManagedOptions,
  seams: ManagedSeams = DEFAULT_SEAMS,
): Promise<void> {
  const target = seams.target();
  if (target === null) {
    throw new Error(
      `Claude Code has no managed settings file on ${process.platform}, so the hook stays in your own settings.`,
    );
  }
  const home = seams.home();
  await writeHookLauncher(home);
  const raw = await readOrNull(target);
  const current = parseManaged(target, raw);
  const next = options.reverting
    ? withoutManagedHook(current)
    : withManagedHook(
        current,
        namedHookCommand(DISCOVERED_AGENT_KIND.CLAUDE_CODE),
        options.exclusive,
      );
  const text = jsonText(next);
  const inPlace = raw === text || (await writeIfAllowed(target, text));

  if (!inPlace) {
    const staged = join(home, MEMNOX_HOME, STAGED);
    await mkdir(dirname(staged), { recursive: true, mode: 0o700 });
    await writeFile(staged, text, { mode: 0o600 });
    renderStaged(context, target, staged, options.reverting);
    return;
  }
  await settleUserCopy(home, options.reverting);
  renderInPlace(context, target, options);
}

/** The user-level copy goes once the managed one is live, and comes back once it is gone. */
async function settleUserCopy(home: string, reverting: boolean): Promise<void> {
  if (reverting) {
    await installClaudeHook(home);
    await markHook(home, 'Claude Code', true);
    return;
  }
  await removeClaudeHook(home);
  // Declined for the keeper, which would otherwise put the user copy back on its next pass.
  await markHook(home, 'Claude Code', false);
}

async function writeIfAllowed(path: string, text: string): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { mode: 0o644 });
    return true;
  } catch (error) {
    if (isPermission(error)) return false;
    throw error;
  }
}

function isPermission(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return code === 'EACCES' || code === 'EPERM';
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // Absent is the ordinary case: nobody has managed this machine's Claude Code yet.
    return null;
  }
}

function parseManaged(path: string, raw: string | null): Settings {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not plain JSON, so it was left alone.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not hold a settings object, so it was left alone.`);
  }
  // Somebody else's file, usually an MDM profile's: only `hooks` is touched.
  return parsed as Settings;
}

function renderStaged(
  context: CliContext,
  target: string,
  staged: string,
  reverting: boolean,
): void {
  const { flow } = context;
  flow.rows('Staged', [
    { label: 'for', value: target },
    { label: 'written to', value: staged },
  ]);
  flow.close(
    `${target} is owned by root, so nothing was installed. Read the staged file, then run:`,
  );
  flow.hint(`sudo mkdir -p "${dirname(target)}"`);
  flow.hint(`sudo install -m 0644 "${staged}" "${target}"`);
  flow.hint(
    `Then run "memnox protect --${reverting ? 'revert-managed' : 'managed'}" again, which ` +
      (reverting
        ? 'puts the hook back in your own settings.'
        : `takes the copy in ~/${CLAUDE_SETTINGS} out so no call is ruled on twice.`),
  );
}

function renderInPlace(
  context: CliContext,
  target: string,
  options: ManagedOptions,
): void {
  const { flow } = context;
  if (options.reverting) {
    flow.rows('Removed', [{ label: 'from', value: target }]);
    flow.close(
      `The hook is back in ~/${CLAUDE_SETTINGS}, where a local edit can remove it.`,
    );
    return;
  }
  flow.rows('Installed', [
    { label: 'where', value: target },
    {
      label: 'user hooks',
      value: options.exclusive
        ? 'off: only managed hooks run, so none a repository ships can'
        : 'still run beside this one',
    },
  ]);
  flow.close(
    'Claude Code reads this hook ahead of every file a session can write, so the agent cannot edit it away.',
  );
  flow.hint('Undo with "memnox protect --revert-managed".');
}

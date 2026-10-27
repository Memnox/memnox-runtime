import { basename, join } from 'node:path';
import { digest } from '../domain/digest';
import type { MachineReader } from './ports';

/**
 * Hooks as capabilities. A hook runs a command as this user on an agent's event, outside
 * the agent's own permission prompt, so a plugin that installs forty of them has granted
 * forty programs a seat in every session without one question being asked.
 */

/** The products whose hook files are read here, as their events are recorded under. */
export const HOOK_HOST = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex-cli',
  GEMINI: 'gemini-cli',
  CURSOR: 'cursor',
  WINDSURF: 'windsurf',
} as const;

export type HookHost = (typeof HOOK_HOST)[keyof typeof HOOK_HOST];

export interface DiscoveredHook {
  /** Stable across scans while the file says the same thing, so drift is a comparison. */
  id: string;
  host: HookHost;
  event: string;
  matcher?: string;
  /** The program it runs, by name. Never the line, which can carry a token. */
  program: string;
  /** A hash of the whole command, so a changed line is seen without keeping it. */
  digest: string;
  declaredIn: string;
  /** The plugin that installed it, as `name@marketplace`, when one did. */
  plugin?: string;
  /** It runs before something happens and can refuse it. */
  gate: boolean;
  /** What it prints is handed to the model as context, which is a prompt nobody reviewed. */
  feedsModel: boolean;
  /** Memnox's own hook, which is the seam rather than something to govern. */
  own: boolean;
}

/** One hook as the published inventory schema states it, kept beside the type it checks. */
export const INVENTORY_HOOK_SCHEMA = {
  type: 'object',
  required: [
    'id',
    'host',
    'event',
    'program',
    'digest',
    'declaredIn',
    'gate',
    'feedsModel',
    'own',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    host: { enum: Object.values(HOOK_HOST) },
    event: { type: 'string' },
    matcher: { type: 'string' },
    program: { type: 'string' },
    digest: { type: 'string' },
    declaredIn: { type: 'string' },
    plugin: { type: 'string' },
    gate: { type: 'boolean' },
    feedsModel: { type: 'boolean' },
    own: { type: 'boolean' },
  },
} as const;

/** Events read by name, lowercased, since each product spells the same moment its own way. */
const GATE_PREFIXES: readonly string[] = ['pre', 'before'];
const GATE_EVENTS: readonly string[] = [
  'userpromptsubmit',
  'permissionrequest',
  'stop',
  'subagentstop',
];
const CONTEXT_EVENTS: readonly string[] = [
  'sessionstart',
  'userpromptsubmit',
  'beforeagent',
];

/** Interpreters whose script argument is the thing worth naming. */
const INTERPRETERS: readonly string[] = [
  'node',
  'bun',
  'deno',
  'python',
  'python3',
  'ruby',
  'bash',
  'sh',
  'zsh',
  'npx',
  'bunx',
  'uvx',
  'pnpm',
  'npm',
];

/** Flags after which the rest is inline code, which is never named. */
const INLINE_CODE_FLAGS: readonly string[] = ['-c', '-e', '--eval'];

const OWN_MARKER = 'memnox';

/** Claude Code's settings files, most specific first, as it reads them. */
function claudeSettingsFiles(home: string, projectDirs: readonly string[]): string[] {
  return [
    ...projectDirs.flatMap((dir) => [
      join(dir, '.claude', 'settings.local.json'),
      join(dir, '.claude', 'settings.json'),
    ]),
    join(home, '.claude', 'settings.json'),
  ];
}

/** Files in the settings shape: event to a list of matcher groups, each holding commands. */
function nestedHookFiles(
  home: string,
  projectDirs: readonly string[],
): { path: string; host: HookHost }[] {
  return [
    ...claudeSettingsFiles(home, projectDirs).map((path) => ({
      path,
      host: HOOK_HOST.CLAUDE_CODE,
    })),
    { path: join(home, '.codex', 'hooks.json'), host: HOOK_HOST.CODEX },
    { path: join(home, '.gemini', 'settings.json'), host: HOOK_HOST.GEMINI },
  ];
}

/** Files in the flat shape Cursor and Windsurf share: event to a list of commands. */
function flatHookFiles(
  home: string,
  projectDirs: readonly string[],
): { path: string; host: HookHost }[] {
  return [
    { path: join(home, '.cursor', 'hooks.json'), host: HOOK_HOST.CURSOR },
    ...projectDirs.map((dir) => ({
      path: join(dir, '.cursor', 'hooks.json'),
      host: HOOK_HOST.CURSOR,
    })),
    { path: join(home, '.codeium', 'windsurf', 'hooks.json'), host: HOOK_HOST.WINDSURF },
  ];
}

/**
 * Every hook the agents here will run, including those a Claude Code plugin brought. A
 * plugin is counted only when a settings file enables it, because one sitting in a
 * marketplace checkout runs nothing.
 */
export async function discoverHooks(
  reader: MachineReader,
  projectDirs: readonly string[] = [],
): Promise<DiscoveredHook[]> {
  const home = reader.homeDir();
  const found: DiscoveredHook[] = [];
  for (const { path, host } of nestedHookFiles(home, projectDirs)) {
    const parsed = jsonObjectAt(await reader.read(path));
    if (parsed !== null) found.push(...nestedHooks(parsed, { host, declaredIn: path }));
  }
  for (const { path, host } of flatHookFiles(home, projectDirs)) {
    const parsed = jsonObjectAt(await reader.read(path));
    if (parsed !== null) found.push(...flatHooks(parsed, { host, declaredIn: path }));
  }
  found.push(...(await pluginHooks(reader, projectDirs)));
  return dedupe(found);
}

interface HookOrigin {
  host: HookHost;
  declaredIn: string;
  plugin?: string;
}

function nestedHooks(
  config: Record<string, unknown>,
  origin: HookOrigin,
): DiscoveredHook[] {
  const hooks = config['hooks'];
  if (!isRecord(hooks)) return [];
  const found: DiscoveredHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group)) continue;
      const matcher = textField(group, 'matcher');
      const entries = group['hooks'];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const command = isRecord(entry) ? textField(entry, 'command') : null;
        if (command !== null) found.push(hookOf(origin, event, matcher, command));
      }
    }
  }
  return found;
}

function flatHooks(
  config: Record<string, unknown>,
  origin: HookOrigin,
): DiscoveredHook[] {
  const hooks = config['hooks'];
  if (!isRecord(hooks)) return [];
  const found: DiscoveredHook[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const command = textField(entry, 'command');
      if (command !== null) {
        found.push(hookOf(origin, event, textField(entry, 'matcher'), command));
      }
    }
  }
  return found;
}

function hookOf(
  origin: HookOrigin,
  event: string,
  matcher: string | null,
  command: string,
): DiscoveredHook {
  const normal = event.toLowerCase().replace(/[^a-z]/g, '');
  return {
    id: `hook_${digest([origin.declaredIn, event, matcher ?? '', command].join('\u0000'))}`,
    host: origin.host,
    event,
    ...(matcher === null || matcher === '' ? {} : { matcher }),
    program: programOf(command),
    digest: digest(command),
    declaredIn: origin.declaredIn,
    ...(origin.plugin === undefined ? {} : { plugin: origin.plugin }),
    gate:
      GATE_EVENTS.includes(normal) ||
      GATE_PREFIXES.some((prefix) => normal.startsWith(prefix)),
    feedsModel: CONTEXT_EVENTS.includes(normal),
    own: command.toLowerCase().includes(OWN_MARKER),
  };
}

/**
 * The program a command line runs, and the script when the program is an interpreter.
 * Leading `NAME=value` assignments are skipped unread, because that is where a token sits.
 */
export function programOf(command: string): string {
  const words = command
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^["']|["']$/g, ''))
    .filter((word) => word !== '');
  const start = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (start === -1) return 'unknown';
  const program = basename(words[start] ?? 'unknown');
  if (!INTERPRETERS.includes(program)) return program;
  for (const word of words.slice(start + 1)) {
    if (INLINE_CODE_FLAGS.includes(word)) return program;
    if (word.startsWith('-')) continue;
    // A scoped package is a name rather than a path, and its scope is half of it.
    return `${program} ${word.startsWith('@') ? word : basename(word)}`;
  }
  return program;
}

/**
 * Plugins enabled in any Claude Code settings file, each read where the product keeps
 * it: an installed copy under `cache`, or the marketplace checkout itself.
 */
async function pluginHooks(
  reader: MachineReader,
  projectDirs: readonly string[],
): Promise<DiscoveredHook[]> {
  const home = reader.homeDir();
  const enabled = await enabledPlugins(reader, claudeSettingsFiles(home, projectDirs));
  const plugins = join(home, '.claude', 'plugins');
  const found: DiscoveredHook[] = [];
  for (const key of enabled) {
    const [name, marketplace] = key.split('@');
    if (name === undefined || marketplace === undefined) continue;
    const path = await pluginHookFile(reader, plugins, name, marketplace);
    if (path === null) continue;
    const parsed = jsonObjectAt(await reader.read(path));
    if (parsed === null) continue;
    found.push(
      ...nestedHooks(parsed, {
        host: HOOK_HOST.CLAUDE_CODE,
        declaredIn: path,
        plugin: key,
      }),
    );
  }
  return found;
}

const PLUGIN_HOOK_FILE = join('hooks', 'hooks.json');

/** The newest installed version's hook file, or the marketplace checkout's, or null. */
async function pluginHookFile(
  reader: MachineReader,
  plugins: string,
  name: string,
  marketplace: string,
): Promise<string | null> {
  const cached = join(plugins, 'cache', marketplace, name);
  // The first segment, since a lister may hand back descendants rather than children.
  const versions = [...new Set((await reader.list(cached)).map(firstSegment))].sort(
    (a, b) => b.localeCompare(a, undefined, { numeric: true }),
  );
  for (const version of versions) {
    const path = join(cached, version, PLUGIN_HOOK_FILE);
    if (await reader.exists(path)) return path;
  }
  const checkout = join(plugins, 'marketplaces', marketplace, 'plugins', name);
  const path = join(checkout, PLUGIN_HOOK_FILE);
  return (await reader.exists(path)) ? path : null;
}

/** `name@marketplace` keys set to true, in any file, since Claude Code merges them. */
async function enabledPlugins(
  reader: MachineReader,
  files: readonly string[],
): Promise<string[]> {
  const enabled = new Set<string>();
  for (const path of files) {
    const parsed = jsonObjectAt(await reader.read(path));
    const plugins = parsed === null ? null : parsed['enabledPlugins'];
    if (!isRecord(plugins)) continue;
    for (const [key, on] of Object.entries(plugins)) {
      if (on === true) enabled.add(key);
    }
  }
  return [...enabled].sort();
}

/** One row per hook, since a project file can repeat the user's. */
function dedupe(hooks: readonly DiscoveredHook[]): DiscoveredHook[] {
  const seen = new Set<string>();
  return hooks.filter((hook) => {
    if (seen.has(hook.id)) return false;
    seen.add(hook.id);
    return true;
  });
}

/** Hooks somebody other than Memnox put there, which are the ones a person has to read. */
export function foreignHooks(hooks: readonly DiscoveredHook[]): DiscoveredHook[] {
  return hooks.filter((hook) => !hook.own);
}

/** One line of counts under the total, the way the scan prints every other kind of reach. */
export function describeHooks(hooks: readonly DiscoveredHook[]): string {
  const foreign = foreignHooks(hooks);
  const parts = ['each runs as you, and no permission prompt sees it'];
  const gates = foreign.filter((hook) => hook.gate).length;
  if (gates > 0) parts.push(`${gates} can stop a tool call`);
  const feeding = foreign.filter((hook) => hook.feedsModel).length;
  if (feeding > 0) parts.push(`${feeding} write into what the model reads`);
  const plugins = new Set(foreign.flatMap((hook) => hook.plugin ?? []));
  if (plugins.size > 0) parts.push(`from ${[...plugins].join(', ')}`);
  return parts.join(' · ');
}

function firstSegment(entry: string): string {
  return entry.split(/[\\/]/)[0] ?? entry;
}

function jsonObjectAt(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // A file that does not parse is not evidence either way.
    return null;
  }
}

function textField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

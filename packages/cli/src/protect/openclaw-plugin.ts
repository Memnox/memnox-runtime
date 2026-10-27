import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import { DISCOVERED_AGENT_KIND } from '@memnox/core';
import { OPENCLAW_EVENT } from '@memnox/interceptors';
import { formattingOf } from '../agents/managed-json';
import { namedHookArgv, namedHookCommand } from './claude-hook';
import { AGENT_PLUGIN, filledPlugin } from './agent-plugin-template';
import { BACKUP_SUFFIX } from './json-config';
import {
  skimJson5,
  stringOf,
  withInserts,
  withoutInserts,
  type Json5Insert,
  type Json5Span,
} from './json5-spans';

/**
 * OpenClaw runs hooks only as plugins inside its own process, so Memnox writes one: a file
 * that hands each tool call and session to the same hook every other agent runs, and turns
 * the answer into OpenClaw's own block or its own approval.
 */

const OPENCLAW_DIR = '.openclaw';
export const OPENCLAW_CONFIG = join(OPENCLAW_DIR, 'openclaw.json');
/** The same config under the extension OpenClaw also reads, where somebody wrote it as JSON5. */
const OPENCLAW_CONFIG_JSON5 = join(OPENCLAW_DIR, 'openclaw.json5');
/** Where OpenClaw is told to read its config from instead, which wins over both. */
const CONFIG_PATH_VAR = 'OPENCLAW_CONFIG_PATH';

/** The config OpenClaw reads: the one it was pointed at, then whichever of its two names exists. */
export function openClawConfigPath(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const pointed = env[CONFIG_PATH_VAR];
  if (pointed !== undefined && pointed.trim() !== '') return pointed.trim();
  const json5 = join(home, OPENCLAW_CONFIG_JSON5);
  return !existsSync(join(home, OPENCLAW_CONFIG)) && existsSync(json5)
    ? json5
    : join(home, OPENCLAW_CONFIG);
}
/** A directory of its own, because a manifest beside a single-file plugin is read in its place. */
export const OPENCLAW_PLUGIN = join(OPENCLAW_DIR, 'memnox', 'memnox.mjs');
/** OpenClaw reads a single file's id from its name, so the two must agree. */
const PLUGIN_ID = 'memnox';

/** The longest a question routed to a person may hold a call, as Hermes allows. */
const BEFORE_TOOL_TIMEOUT_MS = 300_000;
/** The plugin stops waiting a little sooner, so OpenClaw never times the hook out first. */
const PLUGIN_WAIT_MS = 290_000;

/** The plugin, with the hook it runs written in, as OpenClaw loads it: plain ESM, no SDK. */
export function openClawPluginSource(
  argv: readonly string[] = namedHookArgv(DISCOVERED_AGENT_KIND.OPENCLAW),
  command: string = namedHookCommand(DISCOVERED_AGENT_KIND.OPENCLAW),
): string {
  return filledPlugin(AGENT_PLUGIN.OPENCLAW, {
    ARGV: JSON.stringify(argv),
    COMMAND: JSON.stringify(command),
    WAIT_MS: String(PLUGIN_WAIT_MS),
    TIMEOUT_MS: String(BEFORE_TOOL_TIMEOUT_MS),
    EVENTS: JSON.stringify(OPENCLAW_EVENT),
    PLUGIN_ID: JSON.stringify(PLUGIN_ID),
  });
}

interface PluginsConfig {
  allow?: unknown;
  load?: { paths?: unknown };
}

/** The parsed config, tolerant of comments and trailing commas, or null where it will not parse. */
function parsedConfig(raw: string): { plugins?: PluginsConfig } | null {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || parsed === null || typeof parsed !== 'object') return null;
  // Narrowed to an object on the line above.
  return parsed as { plugins?: PluginsConfig };
}

function stringsIn(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === 'string')
    : [];
}

function edited(raw: string, path: (string | number)[], value: unknown): string {
  return applyEdits(
    raw,
    modify(raw, path, value, { formattingOptions: formattingOf(raw) }),
  );
}

/**
 * The config loading and enabling the plugin, and naming it in an allowlist where one is
 * kept, since a non-empty `plugins.allow` turns off every plugin it does not list. JSON
 * with comments is edited by span; JSON5 gets marked insertions. Null where neither reads it.
 */
export function withOpenClawPlugin(raw: string, pluginPath: string): string | null {
  const config = parsedConfig(raw);
  if (config === null) return withJson5Plugin(raw, pluginPath);
  const paths = stringsIn(config.plugins?.load?.paths);
  let next = raw;
  if (!paths.includes(pluginPath)) {
    next = edited(next, ['plugins', 'load', 'paths'], [...paths, pluginPath]);
  }
  next = edited(next, ['plugins', 'entries', PLUGIN_ID, 'enabled'], true);
  const allow = stringsIn(config.plugins?.allow);
  if (allow.length > 0 && !allow.includes(PLUGIN_ID)) {
    next = edited(next, ['plugins', 'allow'], [...allow, PLUGIN_ID]);
  }
  return next;
}

const ENABLED_ENTRY = `${PLUGIN_ID}: { enabled: true }`;

/**
 * The same keys written into JSON5 as marked text, each placed first inside the object or
 * array it belongs in. An entry the person already wrote for the plugin is left as written.
 */
function withJson5Plugin(raw: string, pluginPath: string): string | null {
  const root = skimJson5(raw);
  if (root?.members === undefined) return null;
  const path = JSON.stringify(pluginPath);
  const plugins = root.members.get('plugins');
  if (plugins === undefined) {
    const body = `plugins: { load: { paths: [${path}] }, entries: { ${ENABLED_ENTRY} } }`;
    return withInserts(raw, [{ container: root, body }]);
  }
  if (plugins.members === undefined) return null;
  const load = loadInserts(raw, plugins, pluginPath);
  const entries = entryInserts(plugins);
  if (load === null || entries === null) return null;
  return withInserts(raw, [...load, ...entries, ...allowInserts(raw, plugins)]);
}

/** The plugin's path among the ones OpenClaw loads, or null where `load` is not an object. */
function loadInserts(
  raw: string,
  plugins: Json5Span,
  pluginPath: string,
): Json5Insert[] | null {
  const path = JSON.stringify(pluginPath);
  const load = plugins.members?.get('load');
  if (load === undefined)
    return [{ container: plugins, body: `load: { paths: [${path}] }` }];
  if (load.members === undefined) return null;
  const paths = load.members.get('paths');
  if (paths === undefined) return [{ container: load, body: `paths: [${path}]` }];
  if (paths.items === undefined) return null;
  return stringsAt(raw, paths).includes(pluginPath)
    ? []
    : [{ container: paths, body: path }];
}

/** The plugin's entry, left as written where the person already has one. */
function entryInserts(plugins: Json5Span): Json5Insert[] | null {
  const entries = plugins.members?.get('entries');
  if (entries === undefined) {
    return [{ container: plugins, body: `entries: { ${ENABLED_ENTRY} }` }];
  }
  if (entries.members === undefined) return null;
  return entries.members.has(PLUGIN_ID)
    ? []
    : [{ container: entries, body: ENABLED_ENTRY }];
}

/** Its name in an allowlist that is there, since one turns off every plugin it does not list. */
function allowInserts(raw: string, plugins: Json5Span): Json5Insert[] {
  const allow = plugins.members?.get('allow');
  if (allow?.items === undefined || allow.items.length === 0) return [];
  if (stringsAt(raw, allow).includes(PLUGIN_ID)) return [];
  return [{ container: allow, body: JSON.stringify(PLUGIN_ID) }];
}

function stringsAt(raw: string, span: Json5Span): string[] {
  return (span.items ?? [])
    .map((item) => stringOf(raw, item))
    .filter((each): each is string => each !== null);
}

/**
 * The config with everything this added taken out: the marked JSON5 text, then the path,
 * entry and allowlist name in a file JSON with comments can still edit.
 */
export function withoutOpenClawPlugin(raw: string, pluginPath: string): string | null {
  const unmarked = withoutInserts(raw);
  const config = parsedConfig(unmarked);
  if (config === null) return skimJson5(unmarked) === null ? null : unmarked;
  let next = unmarked;
  const paths = stringsIn(config.plugins?.load?.paths);
  if (paths.includes(pluginPath)) {
    next = edited(
      next,
      ['plugins', 'load', 'paths'],
      paths.filter((each) => each !== pluginPath),
    );
  }
  next = edited(next, ['plugins', 'entries', PLUGIN_ID], undefined);
  const allow = stringsIn(config.plugins?.allow);
  if (allow.includes(PLUGIN_ID)) {
    next = edited(
      next,
      ['plugins', 'allow'],
      allow.filter((each) => each !== PLUGIN_ID),
    );
  }
  return next;
}

/** The plugin written and loaded, only where OpenClaw is installed. */
export async function installOpenClawPlugin(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!existsSync(join(home, OPENCLAW_DIR))) return false;
  const configPath = openClawConfigPath(home, env);
  const pluginPath = join(home, OPENCLAW_PLUGIN);
  const raw = existsSync(configPath) ? await readFile(configPath, 'utf8') : '{}\n';
  const next = withOpenClawPlugin(raw, pluginPath);
  // Neither JSON nor JSON5 this reads with certainty, so left as it is rather than guessed at.
  if (next === null) return false;
  await mkdir(join(home, OPENCLAW_DIR, 'memnox'), { recursive: true });
  await writeFile(pluginPath, openClawPluginSource(), 'utf8');
  if (next !== raw) {
    if (existsSync(configPath))
      await writeFile(`${configPath}${BACKUP_SUFFIX}`, raw, 'utf8');
    await writeFile(configPath, next, 'utf8');
  }
  return true;
}

/** The plugin unloaded and deleted; true when anything was there to take out. */
export async function removeOpenClawPlugin(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const configPath = openClawConfigPath(home, env);
  const pluginPath = join(home, OPENCLAW_PLUGIN);
  const hadPlugin = existsSync(pluginPath);
  await rm(join(home, OPENCLAW_DIR, 'memnox'), { recursive: true, force: true });
  if (!existsSync(configPath)) return hadPlugin;
  const raw = await readFile(configPath, 'utf8');
  const next = withoutOpenClawPlugin(raw, pluginPath);
  if (next === null || next === raw) return hadPlugin;
  await writeFile(configPath, next, 'utf8');
  return true;
}

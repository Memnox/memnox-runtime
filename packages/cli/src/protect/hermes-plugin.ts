import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSeq, parseDocument, YAMLSeq } from 'yaml';
import { DISCOVERED_AGENT_KIND } from '@memnox/core';
import { EDIT_HOOK_BINARY, HERMES_EVENT } from '@memnox/interceptors';
import { AGENT_PLUGIN, filledPlugin } from './agent-plugin-template';
import { namedHookArgv, namedHookCommand } from './claude-hook';
import { HERMES_CONFIG, removeHermesHook } from './hermes-hook';
import { BACKUP_SUFFIX } from './json-config';

/**
 * The policy hook in Hermes as a plugin of its own, rather than shell hooks: a plugin's
 * `pre_tool_call` can hand a call to Hermes's own approval, which puts Memnox's question to
 * its person, and it needs no shell-hook allowlist for a gateway nobody is watching.
 */

const PLUGINS_DIR = join('.hermes', 'plugins');
const PLUGIN_NAME = 'memnox';
export const HERMES_PLUGIN = join(PLUGINS_DIR, PLUGIN_NAME, '__init__.py');
const HERMES_MANIFEST = join(PLUGINS_DIR, PLUGIN_NAME, 'plugin.yaml');
const MANIFEST_FILE = 'plugin.yaml';

/** Hermes stops waiting on a plugin's `pre_tool_call` at 30 seconds and refuses the call. */
const PLUGIN_WAIT_SECONDS = 25;

/** Padding off, or the default rewrites `["a"]` as `[ "a" ]` on lines nothing here touched. */
const WRITE = { flowCollectionPadding: false } as const;

const MANIFEST = `name: ${PLUGIN_NAME}
version: "1.0.0"
description: "Rules on every tool call and records each session in the Memnox ledger."
author: "Memnox"
hooks:
  - ${HERMES_EVENT.PRE_TOOL_CALL}
  - ${HERMES_EVENT.POST_TOOL_CALL}
  - ${HERMES_EVENT.PRE_LLM_CALL}
  - ${HERMES_EVENT.TURN_END}
  - ${HERMES_EVENT.SESSION_FINALIZE}
`;

/** The plugin with the hook it runs written in, as Hermes imports it: plain Python, no deps. */
export function hermesPluginSource(
  argv: readonly string[] = namedHookArgv(DISCOVERED_AGENT_KIND.HERMES),
  command: string = namedHookCommand(DISCOVERED_AGENT_KIND.HERMES),
): string {
  // JSON's strings and lists of strings are Python literals as they stand.
  return filledPlugin(AGENT_PLUGIN.HERMES, {
    ARGV: JSON.stringify(argv),
    COMMAND: JSON.stringify(command),
    WAIT_SECONDS: String(PLUGIN_WAIT_SECONDS),
  });
}

/**
 * The config with the plugin enabled. A missing `plugins.enabled` is Hermes grandfathering
 * every installed plugin in, so the list written names each of them, or the first one it
 * creates would turn off everything the person already runs. Null where it will not parse.
 */
export function withPluginEnabled(
  raw: string,
  installed: readonly string[],
): string | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  const enabled = doc.getIn(['plugins', 'enabled']);
  if (isSeq(enabled)) {
    if (enabled.items.some((item) => String(item) === PLUGIN_NAME)) return raw;
    enabled.add(PLUGIN_NAME);
    return doc.toString(WRITE);
  }
  const list = new YAMLSeq();
  for (const name of [...new Set([...installed, PLUGIN_NAME])]) list.add(name);
  doc.setIn(['plugins', 'enabled'], list);
  return doc.toString(WRITE);
}

/** The config with the plugin no longer enabled, and nothing else changed. */
export function withPluginDisabled(raw: string): string | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  const enabled = doc.getIn(['plugins', 'enabled']);
  if (!isSeq(enabled)) return raw;
  const kept = enabled.items.filter((item) => String(item) !== PLUGIN_NAME);
  if (kept.length === enabled.items.length) return raw;
  enabled.items = kept;
  return doc.toString(WRITE);
}

/** The user plugins already installed, each a directory with a manifest. */
async function installedPlugins(home: string): Promise<string[]> {
  try {
    const entries = await readdir(join(home, PLUGINS_DIR), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(home, PLUGINS_DIR, entry.name, MANIFEST_FILE)))
      .map((entry) => entry.name);
  } catch {
    // No plugins directory yet is no plugin installed.
    return [];
  }
}

/** The plugin written and enabled, and the shell hooks it replaces taken out, only where Hermes is. */
export async function installHermesPlugin(home: string): Promise<boolean> {
  if (!existsSync(join(home, '.hermes'))) return false;
  const configPath = join(home, HERMES_CONFIG);
  const raw = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
  const next = withPluginEnabled(raw, await installedPlugins(home));
  // A config with YAML errors is left as it is, since writing it back would be a guess.
  if (next === null) return false;
  await mkdir(join(home, PLUGINS_DIR, PLUGIN_NAME), { recursive: true });
  await writeIfChanged(join(home, HERMES_MANIFEST), MANIFEST);
  await writeIfChanged(join(home, HERMES_PLUGIN), hermesPluginSource());
  if (next !== raw) {
    if (existsSync(configPath))
      await writeFile(`${configPath}${BACKUP_SUFFIX}`, raw, 'utf8');
    await writeFile(configPath, next, 'utf8');
  }
  // The shell hooks would rule on every call a second time, and could never ask.
  await removeHermesHook(home);
  return true;
}

async function writeIfChanged(path: string, text: string): Promise<void> {
  const current = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (current !== text) await writeFile(path, text, 'utf8');
}

/** The plugin disabled and deleted, and any shell hooks from an older install with it. */
export async function removeHermesPlugin(home: string): Promise<boolean> {
  const pluginDir = join(home, PLUGINS_DIR, PLUGIN_NAME);
  const plugin = join(home, HERMES_PLUGIN);
  const hadPlugin =
    existsSync(plugin) && (await readFile(plugin, 'utf8')).includes(EDIT_HOOK_BINARY);
  if (hadPlugin) await rm(pluginDir, { recursive: true, force: true });
  const configPath = join(home, HERMES_CONFIG);
  let changed = false;
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf8');
    const next = withPluginDisabled(raw);
    if (next !== null && next !== raw) {
      await writeFile(configPath, next, 'utf8');
      changed = true;
    }
  }
  const hadHooks = await removeHermesHook(home);
  return hadPlugin || changed || hadHooks;
}

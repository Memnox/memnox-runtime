import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  appendTextServer,
  CONFIG_FORMAT,
  DEFAULT_SERVER_KEY,
  formatOf,
  readTextServers,
  removeTextServer,
  serversKeyOf,
  type ConfigServers,
  type FilePlan,
  type HubEntry,
  type ServerLaunch,
} from '@memnox/core';
import { backupPathFor } from '../memnox-paths';

/**
 * One MCP config file as the hub reads and writes it, backup first. Only lines the hub wrote
 * are ever changed or removed; a server the person configured is read and left.
 */

const JSON_INDENT = 2;
const OWNER_ONLY_DIR = 0o700;

/** One config as the hub reads it: its servers, and what is needed to write it back. */
export interface HubConfig extends ConfigServers {
  /** The file as it was read; null for an agent that has no config yet, which the hub may create. */
  raw: string | null;
  /** A JSON config, whole, and the key its servers sit under. */
  config?: Record<string, unknown>;
  key?: string;
}

/** A file read as servers, or null for one that will not parse, since writing it back would lose what it held. */
export function parsedConfig(path: string, raw: string): HubConfig | null {
  const format = formatOf(path);
  if (format !== CONFIG_FORMAT.JSON) {
    const { servers, urlOnly } = readTextServers(format, raw);
    const remote = Object.fromEntries(urlOnly.map((name) => [name, {}]));
    return { path, format, raw, servers: { ...remote, ...servers } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never rewrite a file we could not parse: we would lose what it held.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  // Cast is safe: a plain object was checked just above.
  const config = parsed as Record<string, unknown>;
  const key = serversKeyOf(config);
  // Cast is safe: serversKeyOf only names a key holding an object.
  const servers = key === null ? {} : (config[key] as Record<string, unknown>);
  return { path, format, raw, config, ...(key === null ? {} : { key }), servers };
}

export function changes(plan: FilePlan): boolean {
  return plan.add.length + plan.update.length + plan.remove.length > 0;
}

/** One file's adds, updates and removals. Found and drifted lines are never touched. */
export async function applyFilePlan(
  home: string,
  config: HubConfig,
  plan: FilePlan,
): Promise<void> {
  if (!changes(plan)) return;
  if (config.raw === null) {
    await mkdir(dirname(config.path), { recursive: true, mode: OWNER_ONLY_DIR });
  } else {
    const backup = backupPathFor(home, config.path);
    await mkdir(dirname(backup), { recursive: true, mode: OWNER_ONLY_DIR });
    await copyFile(config.path, backup);
  }
  const next =
    config.format === CONFIG_FORMAT.JSON
      ? jsonAfter(config, plan)
      : textAfter(config, plan);
  await writeFile(config.path, next, 'utf8');
}

function jsonAfter(config: HubConfig, plan: FilePlan): string {
  const key = config.key ?? DEFAULT_SERVER_KEY.json;
  const servers: Record<string, unknown> = { ...config.servers };
  for (const name of plan.remove) delete servers[name];
  for (const each of [...plan.add, ...plan.update]) servers[each.name] = each.entry;
  const whole = { ...(config.config ?? {}), [key]: servers };
  return `${JSON.stringify(whole, null, JSON_INDENT)}\n`;
}

/** An update is a removal and an append, so every line that is not the server's own stays as it was. */
function textAfter(config: HubConfig, plan: FilePlan): string {
  let raw = config.raw ?? '';
  for (const name of [...plan.remove, ...plan.update.map((each) => each.name)])
    raw = removeTextServer(config.format, raw, name);
  for (const each of [...plan.add, ...plan.update]) {
    const launch = launchOf(each.entry);
    // The planner skips a remote server for a text config, so only a launch line reaches here.
    if (launch !== null) raw = appendTextServer(config.format, raw, each.name, launch);
  }
  return raw;
}

function launchOf(entry: HubEntry): ServerLaunch | null {
  return 'command' in entry ? entry : null;
}

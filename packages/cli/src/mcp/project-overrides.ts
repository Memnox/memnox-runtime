/**
 * A repository's `.mcp.json` is the team's and usually committed, so it is never rewritten:
 * its servers go behind the proxy through Claude Code's local scope, read by this machine only.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  DISCOVERED_AGENT_KIND,
  isWrapped,
  planWrap,
  type ServerLaunch,
} from '@memnox/core';

import { backupPathFor } from '../memnox-paths';

/** Where Claude Code keeps its user and per-project settings, local servers included. */
const CLAUDE_CONFIG = '.claude.json';

const PROJECTS = 'projects';
const LOCAL_SERVERS = 'mcpServers';

/** Claude Code's record of the project servers a person said yes to. */
const APPROVED = 'enabledMcpjsonServers';

const JSON_INDENT = 2;

type Json = Record<string, unknown>;

/**
 * Each project server a person approved in Claude Code, behind the proxy as a local server
 * of the same name, which Claude Code takes over the project's. Approved ones only, since a
 * local server starts unasked; a person's own local server of that name is left alone.
 */
export async function wrapProjectLocally(
  home: string,
  root: string,
  servers: Readonly<Record<string, ServerLaunch>>,
): Promise<string[]> {
  const path = join(home, CLAUDE_CONFIG);
  const config = await readJson(path);
  if (config === null) return [];
  const project = record(record(config[PROJECTS])[root]);
  const local = record(project[LOCAL_SERVERS]);
  const approved = strings(project[APPROVED]);
  const candidates = Object.fromEntries(
    Object.entries(servers).filter(
      ([name]) => approved.includes(name) && local[name] === undefined,
    ),
  );
  const plan = planWrap(candidates, DISCOVERED_AGENT_KIND.CLAUDE_CODE);
  if (plan.wrap.length === 0) return [];
  const added = Object.fromEntries(plan.wrap.map((each) => [each.name, each.after]));
  await writeProject(home, config, root, {
    ...project,
    [LOCAL_SERVERS]: { ...local, ...added },
  });
  return plan.wrap.map((each) => each.name);
}

/** Takes back the local copies this put in place for a project, for `mcp unwrap` and uninstall. */
export async function unwrapProjectLocally(
  home: string,
  root: string,
  servers: Readonly<Record<string, ServerLaunch>>,
): Promise<string[]> {
  const path = join(home, CLAUDE_CONFIG);
  const config = await readJson(path);
  if (config === null) return [];
  const project = record(record(config[PROJECTS])[root]);
  const local = record(project[LOCAL_SERVERS]);
  const ours = Object.keys(local).filter(
    (name) => servers[name] !== undefined && isOurCopy(local[name]),
  );
  if (ours.length === 0) return [];
  const kept = Object.fromEntries(
    Object.entries(local).filter(([name]) => !ours.includes(name)),
  );
  await writeProject(home, config, root, { ...project, [LOCAL_SERVERS]: kept });
  return ours;
}

/** Claude Code's local servers for one project, or null where it keeps no config to put them in. */
export async function readLocalServers(
  home: string,
  root: string,
): Promise<Record<string, unknown> | null> {
  const config = await readJson(join(home, CLAUDE_CONFIG));
  if (config === null) return null;
  return record(record(record(config[PROJECTS])[root])[LOCAL_SERVERS]);
}

/** One project's local servers replaced whole, the rest of the file and of the project kept as it was. */
export async function writeLocalServers(
  home: string,
  root: string,
  servers: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const config = await readJson(join(home, CLAUDE_CONFIG));
  if (config === null) return false;
  const project = record(record(config[PROJECTS])[root]);
  await writeProject(home, config, root, { ...project, [LOCAL_SERVERS]: { ...servers } });
  return true;
}

function isOurCopy(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false;
  // Shape checked: an entry with a command is a launch line, which is all isWrapped reads.
  return 'command' in entry && isWrapped(entry as ServerLaunch);
}

// Backed up first and written whole, as every other config Memnox rewrites.
async function writeProject(
  home: string,
  config: Json,
  root: string,
  project: Json,
): Promise<void> {
  const path = join(home, CLAUDE_CONFIG);
  const backup = backupPathFor(home, path);
  await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
  await copyFile(path, backup);
  const next = {
    ...config,
    [PROJECTS]: { ...record(config[PROJECTS]), [root]: project },
  };
  await writeFile(path, `${JSON.stringify(next, null, JSON_INDENT)}\n`, 'utf8');
}

async function readJson(path: string): Promise<Json | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    // No Claude Code here, so there is no local scope to put anything in.
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return record(parsed);
  } catch {
    // Never rewrite a file that could not be read: what it held would be lost.
    return null;
  }
}

function record(value: unknown): Json {
  // Shape checked on the line itself: only a plain object is read as one.
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === 'string')
    : [];
}

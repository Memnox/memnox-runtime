/**
 * What each MCP server said it holds the last time a full scan asked, keyed by a digest of its
 * launch line, so a quick scan counts its tools without starting it.
 */
import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { digest } from '../domain/digest';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { TOOL_EFFECT, type ToolEffect } from './discovery.constants';
import type { McpLister } from './ports';
import type { EnvironmentSnapshot } from './snapshot';
import { inferToolEffect, type McpToolDeclaration, type Surface } from './surface';

export const TOOL_LISTS_FILE = 'tool-lists.json';

/** A tool as it is kept: its name and what it does, never its description or schema. */
export interface ListedTool {
  name: string;
  effect: ToolEffect;
}

/** What each launch line answered the last time a full scan asked it, keyed by its digest. */
export type ToolLists = Record<string, ListedTool[]>;

export interface ToolListCache {
  read(): Promise<ToolLists>;
  merge(lists: ToolLists): Promise<void>;
}

/** The digest of a launch line, so a changed command or argument is a different server and argv never lands on disk. */
export function toolListKey(command: string, args: readonly string[]): string {
  // A config read loosely can leave the arguments out, and that is a launch line too.
  return digest(
    JSON.stringify([command, ...((args as readonly string[] | undefined) ?? [])]),
  );
}

export function listedFrom(declarations: readonly McpToolDeclaration[]): ListedTool[] {
  return declarations
    .filter((each) => each.name !== '')
    .map((each) => ({ name: each.name, effect: inferToolEffect(each).effect }));
}

/** Back to a declaration whose hints infer the same effect again, so the one classifier stays the only one. */
function declarationOf(tool: ListedTool): McpToolDeclaration {
  switch (tool.effect) {
    case TOOL_EFFECT.DESTRUCTIVE:
      return { name: tool.name, annotations: { destructiveHint: true } };
    case TOOL_EFFECT.WRITE:
      return { name: tool.name, annotations: { readOnlyHint: false } };
    case TOOL_EFFECT.READ:
      return { name: tool.name, annotations: { readOnlyHint: true } };
    default:
      return { name: tool.name };
  }
}

/** Asks the real lister and keeps each answer, so the next quick scan can count without starting anything. */
export class RecordingMcpLister implements McpLister {
  readonly heard: ToolLists = {};

  constructor(private readonly inner: McpLister) {}

  async listTools(
    server: string,
    command: string,
    args: readonly string[],
  ): Promise<McpToolDeclaration[]> {
    const declared = await this.inner.listTools(server, command, args);
    this.heard[toolListKey(command, args)] = listedFrom(declared);
    return declared;
  }
}

/**
 * Answers from what was kept and starts nothing. A server never asked is a miss, named in
 * `missed`, because its tools are unknown rather than none.
 */
export class CachedMcpLister implements McpLister {
  readonly missed: string[] = [];

  constructor(
    private readonly lists: ToolLists,
    /** The last full scan's snapshot, for a server asked before the lists were kept. */
    private readonly snapshot: EnvironmentSnapshot | null = null,
  ) {}

  listTools(
    server: string,
    command: string,
    args: readonly string[],
  ): Promise<McpToolDeclaration[]> {
    const kept = keptTools(this.lists, this.snapshot, { name: server, command, args });
    if (kept === undefined) {
      this.missed.push(server);
      return Promise.resolve([]);
    }
    return Promise.resolve(kept.map(declarationOf));
  }
}

/** What was kept for one launch line, or undefined when nothing has ever asked it. */
export function keptTools(
  lists: ToolLists,
  snapshot: EnvironmentSnapshot | null,
  server: { name: string; command: string; args: readonly string[] },
): readonly ListedTool[] | undefined {
  return (
    lists[toolListKey(server.command, server.args)] ??
    snapshot?.servers.find((each) => each.name === server.name && each.tools.length > 0)
      ?.tools
  );
}

/** The switched on servers nothing has asked, by name, so a count waits on them rather than reading zero. */
export function unaskedServers(
  surfaces: readonly Surface[],
  lists: ToolLists,
  snapshot: EnvironmentSnapshot | null,
): string[] {
  const launches = surfaces.flatMap((surface) => surface.servers ?? []);
  const unasked = launches.filter(
    (server) =>
      server.disabled !== true && keptTools(lists, snapshot, server) === undefined,
  );
  return [...new Set(unasked.map((server) => server.name))];
}

export class NodeToolListCache implements ToolListCache {
  private readonly path: string;

  constructor(home: string) {
    this.path = join(home, MEMNOX_HOME, TOOL_LISTS_FILE);
  }

  async read(): Promise<ToolLists> {
    return (await readJsonFile<ToolLists>(this.path)) ?? {};
  }

  async merge(lists: ToolLists): Promise<void> {
    if (Object.keys(lists).length === 0) return;
    await writeJsonFile(this.path, { ...(await this.read()), ...lists });
  }
}

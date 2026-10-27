import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  ACTION,
  classifyToolCall,
  environmentOfArguments,
  isWorkspaceTool,
  mcpToolParts,
  ownToolDeclaration,
  TOOL_CLASS,
  type ToolClass,
  type ToolDeclarations,
  withOutgoingData,
  databaseToolCall,
  withStatement,
} from '@memnox/core';

import {
  CONTENT_KEYS,
  CURSOR_EDIT_TOOLS,
  CURSOR_EVENT,
  EDIT_HOST,
  GEMINI_EDIT_TOOLS,
  GEMINI_EVENT,
  HERMES_EDIT_TOOLS,
  HERMES_EVENT,
  HERMES_PATCH_TOOL,
  HERMES_PLUGIN_MARK,
  WINDSURF_EVENT,
  type EditHost,
} from './agent-edits';
import { patchEditsOf } from './codex-patch';
import { OPENCLAW_EVENT } from './openclaw-payload';
import { COPILOT_EVENT, DEVIN_EVENT, OPENCODE_EVENT } from './named-hosts';
import { EDIT_HOOK_EVENT, EDIT_TOOLS } from './edit-hook';
import {
  addedLines,
  changeIn,
  CODEX_PATCH_TOOL,
  cwdOf,
  delegationOf,
  fieldsOf,
  firstText,
  folderOf,
  sessionOf,
  type Delegation,
  type EditIntent,
  type HookFields,
} from './hook-payload';
import { webRequests } from './web-requests';

/**
 * What an agent's own tool is about to do, read out of its hook payload as the actions a
 * rule names: a read by its path, a fetch by its host, a command line, an MCP call.
 * A tool this does not know is not ruled on, so the agent's own permissions decide it.
 */

/** One action a tool call takes, in the words the policy engine matches. */
export interface ToolRequest {
  action: string;
  target?: string;
  class: ToolClass;
  /** Local only: ruled on for what it carries and never written to a row. */
  arguments?: Record<string, string>;
  /** Local only: the lines a write adds, for a `content` convention. Never written to a row. */
  content?: readonly string[];
  /** The environment the call named, for a rule's `environments` and the refusal. */
  environment?: string;
  /** What the call's payload carries about people, read where it is made, never the payload. */
  dataClassification?: string;
  /** The way forward a database statement names for itself, used where a rule names none. */
  alternative?: string;
}

/** A tool call about to run, and what it does. */
export interface ToolCall {
  host: EditHost;
  /** The tool as the agent named it, for the row and the refusal. */
  tool: string;
  sessionId: string;
  cwd?: string;
  /** The actions a file, fetch or MCP tool takes. Empty for a command line. */
  requests: ToolRequest[];
  /** A command line, ruled on through the shell classifier every seam uses. */
  shell?: string;
  /** True where this event's reply can put the question to a person. */
  nativeAsk: boolean;
  /** What this event reads as a go-ahead, where silence would be read as a refusal. */
  allowReply?: string;
  /** The helper the agent handed this call to, where the host names one. */
  delegation?: Delegation;
}

/** Tools that read one file or folder by path. */
const READ_TOOLS: readonly string[] = [
  'Read',
  'NotebookRead',
  'LS',
  'read_file',
  'list_directory',
];

/** Tools that search under a folder, which is the working directory when none is named. */
const SEARCH_TOOLS: readonly string[] = [
  'Grep',
  'Glob',
  'glob',
  'search_file_content',
  'search_files',
];

/** Every file tool that writes, across the agents whose hooks are read here. */
const WRITE_TOOLS: readonly string[] = [
  ...new Set([
    ...EDIT_TOOLS,
    ...GEMINI_EDIT_TOOLS,
    ...CURSOR_EDIT_TOOLS,
    ...HERMES_EDIT_TOOLS,
  ]),
];

const SHELL_TOOLS: readonly string[] = ['Bash', 'run_shell_command', 'shell', 'terminal'];

/** Where a file tool names its path, first match wins. */
const PATH_KEYS: readonly string[] = [
  'file_path',
  'notebook_path',
  'absolute_path',
  'path',
  'dir_path',
  'target_file',
];

/** The hosts whose own reply can put a question to their person. */
const NATIVE_ASK: readonly string[] = [
  EDIT_HOST.PRE_TOOL_USE,
  EDIT_HOST.OPENCLAW,
  EDIT_HOST.COPILOT,
];

/** Hermes asks its person only through Memnox's plugin, which marks what it sends; shell hooks cannot. */
function isHermesPlugin(host: EditHost, hook: HookFields): boolean {
  return host === EDIT_HOST.HERMES && hook[HERMES_PLUGIN_MARK] === true;
}

/** Claude Code, Codex and Gemini CLI spell an MCP tool `mcp__<server>__<tool>`. */
const MCP_PREFIX = 'mcp';

/** Cursor reads an empty object as "no objection", and anything that is not JSON as a block. */
const CURSOR_NO_OBJECTION = '{}';

/**
 * The tool call in this payload, or null where it is not one before a tool runs.
 * `declared` is what is known of an MCP tool beyond its name, since a hook sees no listing.
 */
export function toolCallOf(
  payload: unknown,
  home: string,
  declared: ToolDeclarations = ownToolDeclaration,
): ToolCall | null {
  const hook = fieldsOf(payload);
  if (hook === null) return null;
  const windsurf = hook['agent_action_name'];
  if (typeof windsurf === 'string') return windsurfCall(hook, windsurf, home, declared);
  const event = hook['hook_event_name'];
  if (event === EDIT_HOOK_EVENT.PRE_TOOL_USE) {
    return namedCall(hook, EDIT_HOST.PRE_TOOL_USE, home, declared);
  }
  if (event === GEMINI_EVENT.BEFORE_TOOL) {
    return namedCall(hook, EDIT_HOST.GEMINI, home, declared);
  }
  if (event === HERMES_EVENT.PRE_TOOL_CALL) {
    return namedCall(hook, EDIT_HOST.HERMES, home, declared);
  }
  if (event === OPENCLAW_EVENT.BEFORE_TOOL) {
    return namedCall(hook, EDIT_HOST.OPENCLAW, home, declared);
  }
  if (event === COPILOT_EVENT.PRE_TOOL) {
    return namedCall(hook, EDIT_HOST.COPILOT, home, declared);
  }
  if (event === DEVIN_EVENT.PRE_TOOL) {
    return namedCall(hook, EDIT_HOST.DEVIN, home, declared);
  }
  if (event === OPENCODE_EVENT.PRE_TOOL) {
    return namedCall(hook, EDIT_HOST.OPENCODE, home, declared);
  }
  // Cursor's `preToolUse` carries only its writes, whose go-ahead the lease answers.
  if (event === CURSOR_EVENT.PRE_TOOL_USE) {
    return namedCall(hook, EDIT_HOST.CURSOR, home, declared);
  }
  if (typeof event === 'string') return cursorCall(hook, event, home, declared);
  return null;
}

/** A tool named by `tool_name` with its input under `tool_input`. */
function namedCall(
  hook: HookFields,
  host: EditHost,
  home: string,
  declared: ToolDeclarations,
): ToolCall | null {
  const tool = hook['tool_name'];
  if (typeof tool !== 'string' || tool === '') return null;
  const input = fieldsOf(hook['tool_input']) ?? {};
  const cwd = cwdOf(hook);
  // Claude Code reads `ask` as a prompt for its person; whether one is there is the caller's.
  const base = {
    ...baseOf({ host, tool, hook, cwd }),
    nativeAsk: NATIVE_ASK.includes(host) || isHermesPlugin(host, hook),
  };
  if (SHELL_TOOLS.includes(tool)) return shellCallIn(base, input, { cwd, home });
  const patched = patchFiles(hook, host, tool);
  if (patched !== null) {
    const writes = patched.map((file) =>
      fileRequest(
        ACTION.FILESYSTEM_WRITE,
        file.path,
        { cwd, home },
        addedLines(file.change),
      ),
    );
    return withRequests(base, writes);
  }
  const requests = requestsFor(tool, input, { cwd, home }, declared);
  return requests === null ? null : withRequests(base, requests);
}

/** A command line, run where `workdir` says, which for Hermes is not always where it runs. */
function shellCallIn(base: ToolCall, input: HookFields, at: PathBase): ToolCall | null {
  const workdir = firstText(input, ['workdir']);
  const where =
    workdir === undefined ? base : { ...base, cwd: absolutePath(workdir, at) };
  return shellCall(where, firstText(input, ['command']));
}

/** The files a patch tool writes: Codex's `apply_patch`, or Hermes's `patch` in its patch mode. */
function patchFiles(hook: HookFields, host: EditHost, tool: string): EditIntent[] | null {
  if (tool === CODEX_PATCH_TOOL) return patchEditsOf(hook) ?? [];
  const patch = fieldsOf(hook['tool_input'])?.['patch'];
  if (
    host !== EDIT_HOST.HERMES ||
    tool !== HERMES_PATCH_TOOL ||
    typeof patch !== 'string'
  ) {
    return null;
  }
  return patchEditsOf({ ...hook, tool_input: { command: patch } }) ?? [];
}

/** Where a relative path is relative to, and whose home `~` means. */
interface PathBase {
  cwd: string | undefined;
  home: string;
}

/**
 * The MCP servers a project's own `.mcp.json` names. Anybody with the repository writes that
 * file, so a server it calls `memnox` is not the one onboarding wrote into the user's config.
 */
function projectServers(cwd: string | undefined): (server: string) => boolean {
  if (cwd === undefined) return () => false;
  let named: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8')) as unknown;
    const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
    if (typeof servers === 'object' && servers !== null) named = Object.keys(servers);
  } catch {
    // No project file, or one that does not parse, names no server.
  }
  return (server) => named.includes(server);
}

/** What a named tool does, or null for a tool no rule could be about. */
function requestsFor(
  tool: string,
  input: HookFields,
  base: PathBase,
  declared: ToolDeclarations,
): ToolRequest[] | null {
  const mcp = mcpToolParts(tool);
  if (mcp !== null) {
    const { server, name } = mcp;
    return isWorkspaceTool(server, name, projectServers(base.cwd))
      ? null
      : mcpRequests(server, name, input, declared);
  }
  const path = firstText(input, PATH_KEYS);
  if (READ_TOOLS.includes(tool) && path !== undefined) {
    return [fileRequest(ACTION.FILESYSTEM_READ, path, base)];
  }
  if (SEARCH_TOOLS.includes(tool)) {
    const where = path ?? base.cwd;
    return where === undefined
      ? null
      : [fileRequest(ACTION.FILESYSTEM_READ, where, base)];
  }
  if (WRITE_TOOLS.includes(tool) && path !== undefined) {
    return [
      fileRequest(
        ACTION.FILESYSTEM_WRITE,
        path,
        base,
        addedLines(changeIn(input, CONTENT_KEYS)),
      ),
    ];
  }
  const web = webRequests(tool, input);
  if (web !== undefined) return web;
  return null;
}

/** Absolute, with `~` spelled out, because a rule's `**\/.ssh/**` matches whole paths. */
export function absolutePath(path: string, base: PathBase): string {
  if (path === '~') return base.home;
  if (path.startsWith('~/')) return join(base.home, path.slice(2));
  if (isAbsolute(path) || base.cwd === undefined) return path;
  return resolve(base.cwd, path);
}

function fileRequest(
  action: string,
  path: string,
  base: PathBase,
  content?: readonly string[],
): ToolRequest {
  const toolClass =
    action === ACTION.FILESYSTEM_READ ? TOOL_CLASS.READ : TOOL_CLASS.WRITE;
  return {
    action,
    target: absolutePath(path, base),
    class: toolClass,
    ...(content === undefined ? {} : { content }),
  };
}

/**
 * Both spellings of one MCP call, the strictest winning: `mcp.<server>.<tool>` as native
 * rules write it, and `mcp.<tool>` of the server as the proxy asks, or one seam's rule missed.
 */
function mcpRequests(
  server: string,
  tool: string,
  input: HookFields,
  declared: ToolDeclarations,
): ToolRequest[] {
  const environment = environmentOfArguments(input);
  const database = databaseToolCall(tool, input, { server });
  const alternative =
    database?.alternative === undefined ? {} : { alternative: database.alternative };
  const common = {
    ...(environment === undefined ? {} : { environment }),
    target: server,
    // As the proxy classifies it, so a rule about changes lets `list_issues` through.
    class: classifyToolCall(tool, input, declared(server, tool)).class,
    arguments: flatArguments(withStatement(input, database)),
    ...alternative,
  };
  // Each spelling, and each place its payload is going where it carries a customer.
  const requests: ToolRequest[] = [
    { action: `${MCP_PREFIX}.${server}.${tool}`, ...common },
    { action: `${MCP_PREFIX}.${tool}`, ...common },
  ].flatMap((request) => withOutgoingData(request, input));
  if (database === null) return requests;
  // And as a database client on PATH would be ruled on, last so a tie keeps the tool's name.
  return [
    ...requests,
    {
      action: database.action,
      ...(database.target === undefined ? {} : { target: database.target }),
      class: database.class,
      ...(environment === undefined ? {} : { environment }),
      ...alternative,
    },
  ];
}

/** Each field as text, the shape a rule's argument patterns and the egress check read. */
function flatArguments(input: HookFields): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

interface BaseInput {
  host: EditHost;
  tool: string;
  hook: HookFields;
  cwd: string | undefined;
}

function baseOf(input: BaseInput): ToolCall {
  return {
    host: input.host,
    tool: input.tool,
    sessionId: sessionOf(input.hook),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    requests: [],
    nativeAsk: false,
    ...delegated(input.hook),
  };
}

function delegated(hook: HookFields): { delegation?: Delegation } {
  const delegation = delegationOf(hook);
  return delegation.subagent === undefined ? {} : { delegation };
}

function withRequests(base: ToolCall, requests: ToolRequest[]): ToolCall | null {
  return requests.length === 0 ? null : { ...base, requests };
}

function shellCall(base: ToolCall, line: string | undefined): ToolCall | null {
  if (line === undefined || line.trim() === '') return null;
  return { ...base, shell: line };
}

/** Cursor's own events before a command, an MCP call and a read, each with its own fields. */
function cursorCall(
  hook: HookFields,
  event: string,
  home: string,
  declared: ToolDeclarations,
): ToolCall | null {
  const cwd = cwdOf(hook);
  if (event === CURSOR_EVENT.BEFORE_SHELL) {
    const call = shellCall(cursorBase(hook, 'shell', cwd), firstText(hook, ['command']));
    return call === null ? null : { ...call, nativeAsk: true };
  }
  if (event === CURSOR_EVENT.BEFORE_MCP) {
    const tool = firstText(hook, ['tool_name']);
    if (tool === undefined) return null;
    // Cursor names the server by its address rather than its name, so every server is `*`.
    const requests = mcpRequests('*', tool, fieldsOf(hook['tool_input']) ?? {}, declared);
    return { ...cursorBase(hook, tool, cwd), requests, nativeAsk: true };
  }
  if (event === CURSOR_EVENT.BEFORE_READ) {
    const path = firstText(hook, ['file_path']);
    if (path === undefined) return null;
    const request = fileRequest(ACTION.FILESYSTEM_READ, path, { cwd, home });
    return { ...cursorBase(hook, 'read', cwd), requests: [request] };
  }
  return null;
}

function cursorBase(hook: HookFields, tool: string, cwd: string | undefined): ToolCall {
  return {
    ...baseOf({ host: EDIT_HOST.CURSOR, tool, hook, cwd }),
    allowReply: CURSOR_NO_OBJECTION,
  };
}

/** Windsurf's events before a read, a write, a command and an MCP call. */
function windsurfCall(
  hook: HookFields,
  action: string,
  home: string,
  declared: ToolDeclarations,
): ToolCall | null {
  const info = fieldsOf(hook['tool_info']) ?? {};
  const path = firstText(info, ['file_path']);
  const cwd =
    firstText(info, ['cwd']) ?? (path === undefined ? undefined : folderOf(path));
  const base: ToolCall = {
    ...baseOf({ host: EDIT_HOST.WINDSURF, tool: action, hook, cwd }),
    sessionId: firstText(hook, ['trajectory_id']) ?? '',
  };
  if (action === WINDSURF_EVENT.PRE_COMMAND) {
    return shellCall(base, firstText(info, ['command_line']));
  }
  if (action === WINDSURF_EVENT.PRE_MCP) {
    const server = firstText(info, ['mcp_server_name']);
    const tool = firstText(info, ['mcp_tool_name']);
    if (server === undefined || tool === undefined) return null;
    if (isWorkspaceTool(server, tool, projectServers(cwd))) return null;
    const input = fieldsOf(info['mcp_tool_arguments']) ?? {};
    return withRequests(base, mcpRequests(server, tool, input, declared));
  }
  if (path === undefined) return null;
  if (action === WINDSURF_EVENT.PRE_READ) {
    return withRequests(base, [fileRequest(ACTION.FILESYSTEM_READ, path, { cwd, home })]);
  }
  if (action === WINDSURF_EVENT.PRE_WRITE) {
    return withRequests(base, [
      fileRequest(ACTION.FILESYSTEM_WRITE, path, { cwd, home }),
    ]);
  }
  return null;
}

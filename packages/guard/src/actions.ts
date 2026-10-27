/**
 * A tool call from an agent framework as the actions a rule is written against, named the
 * way the runtime names them on a laptop, so one workspace rule governs both.
 */
import {
  ACTION,
  mcpToolParts,
  HTTP_METHOD,
  HTTP_METHOD_ARGUMENT,
  classifyToolCall,
  environmentOfArguments,
  normalizeShellCommand,
  resolveCommand,
  TOOL_CLASS,
  withOutgoingData,
  type ActionRequest,
} from '@memnox/core/engine';

const READ_TOOLS: readonly string[] = ['Read', 'NotebookRead', 'LS', 'Glob', 'Grep'];
const WRITE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS: readonly string[] = ['Bash', 'shell'];
const FETCH_TOOLS: readonly string[] = ['WebFetch'];
const SEARCH_TOOLS: readonly string[] = ['WebSearch'];
const PATH_KEYS: readonly string[] = ['file_path', 'notebook_path', 'path'];

/** Claude's spelling of an MCP tool, `mcp__<server>__<tool>`. */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/;

/** A tool a framework calls by its own name, with no server: named under `tool.`. */
export const FUNCTION_TOOL_PREFIX = 'tool.';

export interface CallPlace {
  /** The agent's working directory, so a relative path is ruled on as the whole path. */
  cwd?: string;
}

/** Every action this call has to be ruled on; the strictest verdict among them wins. */
export function requestsFor(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  place: CallPlace = {},
): ActionRequest[] {
  const mcp = mcpToolParts(tool);
  if (mcp !== null) return mcpRequests(mcp.server, mcp.name, input);
  if (SHELL_TOOLS.includes(tool)) return shellRequests(textOf(input, ['command']) ?? '');
  const path = textOf(input, PATH_KEYS);
  if (READ_TOOLS.includes(tool)) {
    const where = path ?? place.cwd;
    return where === undefined ? [] : [fileRequest(ACTION.FILESYSTEM_READ, where, place)];
  }
  if (WRITE_TOOLS.includes(tool) && path !== undefined) {
    return [fileRequest(ACTION.FILESYSTEM_WRITE, path, place)];
  }
  if (FETCH_TOOLS.includes(tool)) return [fetchRequest(textOf(input, ['url', 'prompt']))];
  if (SEARCH_TOOLS.includes(tool)) return [fetchRequest(undefined)];
  return functionRequests(tool, input);
}

/** Both spellings of one MCP call, as the runtime asks, so a rule written either way holds. */
function mcpRequests(
  server: string,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): ActionRequest[] {
  const environment = environmentOfArguments(input);
  const common: Omit<ActionRequest, 'action'> = {
    target: server,
    toolClass: classifyToolCall(tool, input).class,
    arguments: flatArguments(input),
    ...(environment === undefined ? {} : { environment }),
  };
  // Each spelling, and each place its payload is going where it carries a customer.
  return [
    { action: `mcp.${server}.${tool}`, ...common },
    { action: `mcp.${tool}`, ...common },
  ].flatMap((request) => withOutgoingData(request, input));
}

/** Each command on the line, resolved as the runtime resolves it, or one shell action where nothing parses. */
function shellRequests(line: string): ActionRequest[] {
  if (line.trim() === '') return [];
  const parsed = normalizeShellCommand(line).parsed;
  const requests = parsed.flatMap(({ argv, stdin }) => {
    const [binary, ...args] = argv;
    if (binary === undefined) return [];
    const resolved = resolveCommand(
      binary,
      args,
      {},
      stdin === undefined ? {} : { stdin },
    );
    return [
      {
        action: resolved.action,
        toolClass: resolved.class,
        ...(resolved.target === undefined ? {} : { target: resolved.target }),
        ...(resolved.environment === undefined
          ? {}
          : { environment: resolved.environment }),
        ...(resolved.dataClassification === undefined
          ? {}
          : { dataClassification: resolved.dataClassification }),
        ...(resolved.method === undefined
          ? {}
          : { arguments: { [HTTP_METHOD_ARGUMENT]: resolved.method } }),
      },
    ];
  });
  return requests.length > 0
    ? requests
    : [{ action: ACTION.SHELL_EXECUTE, target: line }];
}

function fileRequest(action: string, path: string, place: CallPlace): ActionRequest {
  const whole =
    path.startsWith('/') || path.startsWith('~') || place.cwd === undefined
      ? path
      : `${place.cwd.replace(/\/$/, '')}/${path}`;
  return {
    action,
    target: whole,
    toolClass: action === ACTION.FILESYSTEM_READ ? TOOL_CLASS.READ : TOOL_CLASS.WRITE,
  };
}

/** A fetch by its host, which is what a network rule names. */
function fetchRequest(text: string | undefined): ActionRequest {
  const url = text === undefined ? undefined : URL_IN_TEXT.exec(text)?.[0];
  const host = url === undefined ? undefined : hostOf(url);
  return {
    action: ACTION.HTTP_REQUEST,
    toolClass: TOOL_CLASS.READ,
    ...(host === undefined ? {} : { target: host }),
    arguments: {
      [HTTP_METHOD_ARGUMENT]: HTTP_METHOD.GET,
      ...(url === undefined ? {} : { url }),
    },
  };
}

function functionRequests(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): ActionRequest[] {
  const environment = environmentOfArguments(input);
  const request: ActionRequest = {
    action: `${FUNCTION_TOOL_PREFIX}${tool}`,
    toolClass: classifyToolCall(tool, input).class,
    arguments: flatArguments(input),
    ...(environment === undefined ? {} : { environment }),
  };
  return withOutgoingData(request, input);
}

/** Each field as text, the shape a rule's argument patterns read. */
function flatArguments(input: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

function textOf(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    // An address that does not parse names no host a rule could match.
    return undefined;
  }
}

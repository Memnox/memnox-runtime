import { AGENT_FLAG } from '@memnox/core';

/** Everything before `--` is ours; everything after is the wrapped server's. */
const COMMAND_SEPARATOR = '--';
const NAME_FLAG = '--name';
const URL_FLAG = '--url';
const HEADER_FLAG = '--header';
/** `Name: value`, the way curl and every MCP client's config write a header. */
const HEADER_LINE = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+):\s*(.*)$/;
const DEFAULT_SERVER_NAME = 'mcp-server';
const FLAG_PREFIX = '--';

export interface FirewallArgs {
  /** The wrapped MCP server command, e.g. ["npx", "-y", "@some/mcp-server"]. */
  command: string[];
  serverName: string;
  /** Absent on a line wrapped before the agent was written into it. */
  agent?: string;
  /** A remote server's address, which takes the place of a command. */
  url?: string;
  /** Sent with every request to the remote server; a value may name a kept secret. */
  headers?: Record<string, string>;
}

/** A flag that takes a value was given none, so the caller names it rather than guessing. */
interface MissingFlagValue {
  missingValueFor: string;
}

/** The value after `flag`, undefined when absent, or the flag itself when its value is missing. */
function flagValue(
  flags: readonly string[],
  flag: string,
): { value: string | undefined } | MissingFlagValue {
  const index = flags.indexOf(flag);
  if (index === -1) return { value: undefined };
  const value = flags[index + 1];
  // A value that looks like a flag is the next flag, and taking it would misread everything after.
  if (value === undefined || value.startsWith(FLAG_PREFIX))
    return { missingValueFor: flag };
  return { value };
}

/** Every `--header` given, by name, or the flag itself when one is missing or not `Name: value`. */
function headersOf(
  flags: readonly string[],
): { headers: Record<string, string> } | MissingFlagValue {
  const headers: Record<string, string> = {};
  for (const [index, flag] of flags.entries()) {
    if (flag !== HEADER_FLAG) continue;
    const match = HEADER_LINE.exec(flags[index + 1] ?? '');
    if (match === null) return { missingValueFor: HEADER_FLAG };
    headers[match[1] ?? ''] = match[2] ?? '';
  }
  return { headers };
}

/** Null means the invocation cannot run and the caller should print usage. */
export function parseFirewallArgs(
  argv: readonly string[],
): FirewallArgs | MissingFlagValue | null {
  const separator = argv.indexOf(COMMAND_SEPARATOR);
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  const url = flagValue(flags, URL_FLAG);
  if ('missingValueFor' in url) return url;
  // A server is either started here or reached at an address, never both and never neither.
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  if ((url.value === undefined) === (command.length === 0)) return null;

  const name = flagValue(flags, NAME_FLAG);
  if ('missingValueFor' in name) return name;
  const agentFlag = flagValue(flags, AGENT_FLAG);
  if ('missingValueFor' in agentFlag) return agentFlag;
  const agent = agentFlag.value;
  const headers = headersOf(flags);
  if ('missingValueFor' in headers) return headers;

  return {
    ...(agent === undefined || agent === '' ? {} : { agent }),
    command,
    serverName: name.value ?? DEFAULT_SERVER_NAME,
    ...(url.value === undefined ? {} : { url: url.value, headers: headers.headers }),
  };
}

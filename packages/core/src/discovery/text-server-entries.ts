import { indentOf, keyLine, scalarText } from './config-lines';
import { DEFAULT_SERVER_KEY, TOML_SERVER_TABLES, YAML_SERVER_KEYS } from './mcp-keys';
import type { ServerLaunch } from './wrap';
import {
  CONFIG_FORMAT,
  entryEnd,
  headerLine,
  tableEnd,
  type ConfigFormat,
} from './wrap-text';

/**
 * Adding and removing a whole server in a TOML or YAML config, for the MCP Hub. Like the
 * rewrite beside it, every line that is not the server's own is copied as it was.
 */

/** A bare TOML key is letters, digits, dashes and underscores; anything else is quoted. */
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

const YAML_STEP = '  ';

function tomlKey(name: string): string {
  return TOML_BARE_KEY.test(name) ? name : scalarText(name, '"');
}

/** The file with one server appended, in the spelling the file already uses for its table. */
export function appendTextServer(
  format: ConfigFormat,
  raw: string,
  name: string,
  launch: ServerLaunch,
): string {
  return format === CONFIG_FORMAT.TOML
    ? appendToml(raw, name, launch)
    : appendYaml(raw, name, launch);
}

/** The file without the named server; unchanged when it declares none by that name. */
export function removeTextServer(
  format: ConfigFormat,
  raw: string,
  name: string,
): string {
  return format === CONFIG_FORMAT.TOML ? removeToml(raw, name) : removeYaml(raw, name);
}

function tomlTableIn(raw: string): string {
  const lines = raw.split('\n');
  for (const table of TOML_SERVER_TABLES) {
    if (lines.some((line) => line.trim().startsWith(`[${table}.`))) return table;
  }
  return DEFAULT_SERVER_KEY.toml;
}

function appendToml(raw: string, name: string, launch: ServerLaunch): string {
  const table = `${tomlTableIn(raw)}.${tomlKey(name)}`;
  const quoted = launch.args.map((arg) => scalarText(arg, '"'));
  const block = [
    `[${table}]`,
    `command = ${scalarText(launch.command, '"')}`,
    `args = [${quoted.join(', ')}]`,
  ];
  const env = Object.entries(launch.env ?? {});
  if (env.length > 0) {
    block.push('', `[${table}.env]`);
    for (const [key, value] of env)
      block.push(`${tomlKey(key)} = ${scalarText(value, '"')}`);
  }
  return `${withTrailingBreak(raw)}\n${block.join('\n')}\n`;
}

function removeToml(raw: string, name: string): string {
  let lines = raw.split('\n');
  for (const table of TOML_SERVER_TABLES) {
    const path = `${table}.${name}`;
    // The server's own table, then each sub-table under it, such as its env.
    for (
      let header = headerLine(lines, path);
      header !== -1;
      header = subTableOf(lines, path)
    ) {
      lines = cut(lines, header, tableEnd(lines, header));
    }
  }
  return lines.join('\n');
}

/** A `[path.something]` header still in the file, or -1. */
function subTableOf(lines: readonly string[], path: string): number {
  const prefix = `[${path}.`;
  return lines.findIndex((line) => line.trim().startsWith(prefix));
}

function appendYaml(raw: string, name: string, launch: ServerLaunch): string {
  const lines = raw.split('\n');
  const parent = YAML_SERVER_KEYS.map((key) => keyLine(lines, key, 0)).find(
    (at) => at !== -1 && indentOf(lines[at] as string) === '',
  );
  const entry = yamlEntry(name, launch, YAML_STEP);
  if (parent === undefined) {
    return `${withTrailingBreak(raw)}${DEFAULT_SERVER_KEY.yaml}:\n${entry.join('\n')}\n`;
  }
  const end = entryEnd(lines, parent);
  // After the last line of the servers block, so the new entry sits with its siblings.
  lines.splice(end + 1, 0, ...entry);
  return lines.join('\n');
}

function yamlEntry(name: string, launch: ServerLaunch, indent: string): string[] {
  const inner = `${indent}${YAML_STEP}`;
  const entry = [
    `${indent}${scalarText(name, 'bare')}:`,
    `${inner}command: ${scalarText(launch.command, 'bare')}`,
    `${inner}args:`,
    ...launch.args.map((arg) => `${inner}${YAML_STEP}- ${scalarText(arg, '"')}`),
  ];
  const env = Object.entries(launch.env ?? {});
  if (env.length > 0) {
    entry.push(`${inner}env:`);
    for (const [key, value] of env) {
      entry.push(
        `${inner}${YAML_STEP}${scalarText(key, 'bare')}: ${scalarText(value, '"')}`,
      );
    }
  }
  return entry;
}

function removeYaml(raw: string, name: string): string {
  const lines = raw.split('\n');
  for (const key of YAML_SERVER_KEYS) {
    const parent = keyLine(lines, key, 0);
    if (parent === -1) continue;
    const start = keyLine(lines, name, parent + 1);
    // Only an entry inside this block: a later top level key of the same name is somebody else's.
    if (start === -1 || start > entryEnd(lines, parent)) continue;
    return cut(lines, start, entryEnd(lines, start)).join('\n');
  }
  return raw;
}

function cut(lines: readonly string[], from: number, to: number): string[] {
  return [...lines.slice(0, from), ...lines.slice(to + 1)];
}

function withTrailingBreak(raw: string): string {
  return raw === '' || raw.endsWith('\n') ? raw : `${raw}\n`;
}

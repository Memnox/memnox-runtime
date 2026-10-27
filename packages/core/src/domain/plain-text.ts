/**
 * The text without every copy of one character at its end, such as a path's trailing slashes, by
 * index rather than a pattern, so a long run of it costs its length rather than its square.
 */
export function withoutTrailing(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
}

/** An MCP tool's name, `mcp__<server>__<tool>`, with the server ending at the first separator. */
const MCP_PREFIX = 'mcp__';
const MCP_SEPARATOR = '__';

/** The server and tool an MCP tool's name carries, or null for a name that is not one. */
export function mcpToolParts(tool: string): { server: string; name: string } | null {
  if (!tool.startsWith(MCP_PREFIX) || tool.includes('\n')) return null;
  // The server has at least one character, so its separator is looked for after that one.
  const split = tool.indexOf(MCP_SEPARATOR, MCP_PREFIX.length + 1);
  if (split === -1 || split + MCP_SEPARATOR.length >= tool.length) return null;
  return {
    server: tool.slice(MCP_PREFIX.length, split),
    name: tool.slice(split + MCP_SEPARATOR.length),
  };
}

import type { ToolDefinition } from './session-tools';

/** The arguments most operator tools share, and the shape of a tool that only proposes. */

export const AGENT_ARG = {
  type: 'string',
  description: 'the agent asked about, such as "claude-code", "codex" or "cursor"',
} as const;

export const SAID_ARG = {
  type: 'string',
  description:
    'what the person said, in their words, so the confirmation is of the same thing',
} as const;

/** Writes a proposal and nothing else, which a person then confirms or not. */
export function proposeTool(
  name: string,
  description: string,
  properties: ToolDefinition['inputSchema']['properties'],
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  };
}

/**
 * An agent's own tool result read for text addressing the model: a page, a README, a
 * command's output. The proxy does this for MCP; this is the same check for the rest.
 */
import {
  hasInstructionShape,
  SESSION_TOOL_ANNOTATIONS,
  WORKSPACE_TOOL_ANNOTATIONS,
} from '@memnox/core';

import { CURSOR_EVENT, GEMINI_EVENT, HERMES_EVENT, WINDSURF_EVENT } from './agent-edits';
import { OPENCLAW_EVENT } from './openclaw-payload';
import { COPILOT_EVENT, DEVIN_EVENT, OPENCODE_EVENT } from './named-hosts';
import { EDIT_HOOK_EVENT } from './edit-hook';
import type { HookAuthorizer } from './hook-authorizer';
import { fieldsOf, type HookFields } from './hook-payload';

/** Enough to find an instruction, and bounded, since a response can be a whole file. */
const MOST_CHARS_READ = 200_000;

/** Nested structure is walked this deep and no deeper. */
const MOST_DEPTH = 4;

/** Memnox's own tools answer about the session, so they are never the source of a taint. */
const OWN_TOOL = /^mcp__memnox/;

/** The text a response carries, from a string or the strings inside an object. */
export function responseText(response: unknown, depth = 0): string {
  if (typeof response === 'string') return response.slice(0, MOST_CHARS_READ);
  if (depth >= MOST_DEPTH || typeof response !== 'object' || response === null) return '';
  const values = Array.isArray(response) ? response : Object.values(response);
  let text = '';
  for (const value of values) {
    text += `${responseText(value, depth + 1)}\n`;
    if (text.length >= MOST_CHARS_READ) break;
  }
  return text.slice(0, MOST_CHARS_READ);
}

/**
 * Marks the session when a tool's result read like instructions. True when it did. Only
 * after a tool ran, since before it nothing has been read.
 */
export function taintFromResult(payload: unknown, authorizer: HookAuthorizer): boolean {
  const hook = fieldsOf(payload);
  if (hook === null) return false;
  const after = afterToolOf(hook);
  if (after === null || isOwnTool(after.tool)) return false;
  if (!hasInstructionShape(responseText(after.result))) return false;
  return authorizer.taint(after.tool);
}

/** The tool that ran and what it answered, as each agent's after-tool payload spells them. */
interface AfterTool {
  tool: string;
  result: unknown;
}

/**
 * Every agent Memnox hooks hands its result over after a call, each under its own names,
 * so an MCP server that cannot be proxied is still read the way the proxy reads one.
 */
function afterToolOf(hook: HookFields): AfterTool | null {
  const event = hook['hook_event_name'];
  const tool = hook['tool_name'];
  if (typeof tool === 'string') {
    // Claude Code and Codex, Gemini CLI, and Memnox's OpenClaw plugin name the result the same way.
    const same: readonly unknown[] = [
      EDIT_HOOK_EVENT.POST_TOOL_USE,
      GEMINI_EVENT.AFTER_TOOL,
      OPENCLAW_EVENT.AFTER_TOOL,
      COPILOT_EVENT.POST_TOOL,
      DEVIN_EVENT.POST_TOOL,
      OPENCODE_EVENT.POST_TOOL,
    ];
    if (same.includes(event)) {
      return { tool, result: hook['tool_response'] };
    }
    if (event === CURSOR_EVENT.POST_TOOL_USE)
      return { tool, result: hook['tool_output'] };
    // Hermes hands every event's own fields over under `extra`, the result among them.
    if (event === HERMES_EVENT.POST_TOOL_CALL)
      return { tool, result: fieldsOf(hook['extra'])?.['result'] };
  }
  if (hook['agent_action_name'] !== WINDSURF_EVENT.POST_MCP) return null;
  const info = fieldsOf(hook['tool_info']);
  if (info === null) return null;
  const server = info['mcp_server_name'];
  const name = info['mcp_tool_name'];
  if (typeof server !== 'string' || typeof name !== 'string') return null;
  return { tool: `mcp__${server}__${name}`, result: info['mcp_result'] };
}

/** Cursor names an MCP tool `MCP:<tool>` with no server, so Memnox's own are known by name. */
const CURSOR_MCP = /^MCP:(.+)$/;

function isOwnTool(tool: string): boolean {
  if (OWN_TOOL.test(tool)) return true;
  const cursor = CURSOR_MCP.exec(tool);
  if (cursor === null) return false;
  const name = cursor[1] ?? '';
  return name in SESSION_TOOL_ANNOTATIONS || name in WORKSPACE_TOOL_ANNOTATIONS;
}

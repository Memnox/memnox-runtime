import { CODEX_PATCH_TOOL, fieldsOf, firstText, type HookFields } from './hook-payload';

/**
 * OpenClaw has no shell hooks, so Memnox's own plugin inside it forwards each event to
 * this hook under OpenClaw's event names and its raw tool arguments. Read here once into
 * the names every other host already uses, so its tools meet the same rules and leases.
 */

/** OpenClaw's plugin hooks, as Memnox's plugin names them on the wire. */
export const OPENCLAW_EVENT = {
  BEFORE_TOOL: 'before_tool_call',
  AFTER_TOOL: 'after_tool_call',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  /** Memnox's own: what the person answered at OpenClaw's approval, sent by the plugin. */
  APPROVAL_RESOLVED: 'approval_resolved',
} as const;

/** What OpenClaw passes an approval's resolution, by the words it uses. */
export const OPENCLAW_RESOLUTION = {
  ALLOW_ONCE: 'allow-once',
  ALLOW_ALWAYS: 'allow-always',
  DENY: 'deny',
  TIMEOUT: 'timeout',
  /** Nothing could show the question, or the call was cancelled while it waited. */
  CANCELLED: 'cancelled',
} as const;

const OPENCLAW_EVENTS: readonly unknown[] = Object.values(OPENCLAW_EVENT);

/** OpenClaw separates an MCP server from its tool with this and no prefix: `github__create_issue`. */
const MCP_SEPARATOR = '__';

/** The prefix every other host spells an MCP tool with, which the classifier reads. */
const MCP_PREFIX = 'mcp__';

/** OpenClaw's own tools, by the names the classifier already reads them under. */
const CANONICAL_TOOL: Readonly<Record<string, string>> = {
  exec: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'MultiEdit',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
};

/** Whether this payload came from Memnox's plugin in OpenClaw. */
export function isOpenClawPayload(payload: unknown): boolean {
  return OPENCLAW_EVENTS.includes(fieldsOf(payload)?.['hook_event_name']);
}

/**
 * The payload with OpenClaw's tool spelled the way the readers expect, and every other
 * payload as it came. A tool this does not know keeps its name, so it is not ruled on.
 */
export function canonicalPayload(payload: unknown): unknown {
  const hook = fieldsOf(payload);
  if (hook === null || !isOpenClawPayload(hook)) return payload;
  const tool = hook['tool_name'];
  if (typeof tool !== 'string') return payload;
  const input = fieldsOf(hook['tool_input']) ?? {};
  return {
    ...hook,
    tool_name: canonicalTool(tool),
    tool_input: canonicalInput(tool, input),
  };
}

function canonicalTool(tool: string): string {
  const own = CANONICAL_TOOL[tool];
  if (own !== undefined) return own;
  if (tool === CODEX_PATCH_TOOL) return tool;
  return tool.includes(MCP_SEPARATOR) ? `${MCP_PREFIX}${tool}` : tool;
}

/** OpenClaw's argument names in the ones the readers take; the rest are copied through. */
function canonicalInput(tool: string, input: HookFields): HookFields {
  if (tool === CODEX_PATCH_TOOL) {
    const patch = input['input'];
    return typeof patch === 'string' ? { ...input, command: patch } : input;
  }
  const path = firstText(input, ['path', 'file_path']);
  const withPath = path === undefined ? input : { ...input, file_path: path };
  if (tool !== 'edit') return withPath;
  return { ...withPath, edits: editsOf(input) };
}

/** Every replacement an edit makes, from its `edits` list or the older single pair. */
function editsOf(input: HookFields): unknown[] {
  const listed = Array.isArray(input['edits']) ? input['edits'] : [input];
  return listed.map((each) => {
    const edit = fieldsOf(each);
    // An entry this cannot read stays unreadable, so the whole file is claimed.
    if (edit === null) return each;
    return { old_string: edit['oldText'], new_string: edit['newText'] };
  });
}

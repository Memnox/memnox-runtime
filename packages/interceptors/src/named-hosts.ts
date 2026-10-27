import { fieldsOf, firstText, type HookFields } from './hook-payload';

/**
 * Hosts whose payload does not say who sent it: Copilot CLI names no event and Devin uses
 * Claude Code's. The installed command says, so each is read here into an event of its own.
 */

/** The flag the installed command passes the event on, for a host whose payload carries none. */
export const HOST_EVENT_FLAG = '--host-event';

export const COPILOT_AGENT = 'copilot-cli';
export const DEVIN_AGENT = 'devin';

/** Copilot CLI's events, under Memnox's names, since Cursor already sends a bare `preToolUse`. */
export const COPILOT_EVENT = {
  PRE_TOOL: 'copilot:preToolUse',
  POST_TOOL: 'copilot:postToolUse',
  PROMPT: 'copilot:userPromptSubmitted',
  TURN_END: 'copilot:agentStop',
  SESSION_START: 'copilot:sessionStart',
  SESSION_END: 'copilot:sessionEnd',
} as const;

/** Devin's events, which it spells as Claude Code does, under Memnox's names for them. */
export const DEVIN_EVENT = {
  PRE_TOOL: 'devin:PreToolUse',
  POST_TOOL: 'devin:PostToolUse',
  PROMPT: 'devin:UserPromptSubmit',
  TURN_END: 'devin:Stop',
  SESSION_START: 'devin:SessionStart',
  SESSION_END: 'devin:SessionEnd',
} as const;

export const OPENCODE_AGENT = 'opencode';

/** OpenCode's plugin hooks and session events, as Memnox's plugin in it names them on the wire. */
export const OPENCODE_EVENT = {
  PRE_TOOL: 'opencode:tool.execute.before',
  POST_TOOL: 'opencode:tool.execute.after',
  TURN_END: 'opencode:session.idle',
  SESSION_END: 'opencode:session.deleted',
} as const;

const COPILOT_EVENTS: readonly unknown[] = Object.values(COPILOT_EVENT);
const OPENCODE_EVENTS: readonly unknown[] = Object.values(OPENCODE_EVENT);
const DEVIN_PREFIX = 'devin:';

/** Set by Devin for every hook it runs, and where it has no `cwd` of its own to give. */
const DEVIN_PROJECT_VAR = 'DEVIN_PROJECT_DIR';

/** Copilot CLI's built-in tools, by the names the classifier reads them under. */
const COPILOT_TOOLS: Readonly<Record<string, string>> = {
  bash: 'Bash',
  powershell: 'Bash',
  view: 'Read',
  create: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
};

/** Devin's built-in tools, by the names the classifier reads them under. */
const DEVIN_TOOLS: Readonly<Record<string, string>> = {
  exec: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  glob: 'Glob',
  webfetch: 'WebFetch',
};

/** OpenCode's built-in tools, by the names the classifier reads them under. */
const OPENCODE_TOOLS: Readonly<Record<string, string>> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  list: 'LS',
  webfetch: 'WebFetch',
};

/** Argument names other hosts use, each beside the one the readers take. */
const INPUT_ALIASES: readonly (readonly [string, string])[] = [
  ['path', 'file_path'],
  ['file_text', 'content'],
  ['old_str', 'old_string'],
  ['new_str', 'new_string'],
  ['oldText', 'old_string'],
  ['newText', 'new_string'],
  ['filePath', 'file_path'],
  ['oldString', 'old_string'],
  ['newString', 'new_string'],
  ['replaceAll', 'replace_all'],
];

/** Where a patch tool carries its patch text, which the patch reader takes under `command`. */
const PATCH_KEYS: readonly string[] = ['patch', 'input', 'command'];
const PATCH_TOOL = 'apply_patch';

export function isCopilotPayload(payload: unknown): boolean {
  return COPILOT_EVENTS.includes(fieldsOf(payload)?.['hook_event_name']);
}

export function isOpenCodePayload(payload: unknown): boolean {
  return OPENCODE_EVENTS.includes(fieldsOf(payload)?.['hook_event_name']);
}

export function isDevinPayload(payload: unknown): boolean {
  const event = fieldsOf(payload)?.['hook_event_name'];
  return typeof event === 'string' && event.startsWith(DEVIN_PREFIX);
}

/** Who sent the payload, as far as the command that ran the hook says. */
export interface HookOrigin {
  agent: string;
  /** The event the installed command named, for a host whose payload names none. */
  hostEvent?: string;
  env: NodeJS.ProcessEnv;
}

/** The payload in Memnox's event names and the readers' tool names, or as it came for any other host. */
export function namedHostPayload(payload: unknown, origin: HookOrigin): unknown {
  const hook = fieldsOf(payload);
  if (hook === null) return payload;
  if (origin.agent === COPILOT_AGENT && origin.hostEvent !== undefined) {
    return copilotPayload(hook, origin.hostEvent);
  }
  const event = hook['hook_event_name'];
  // Memnox's own plugin names the event, so its payload is read whichever agent ran the hook.
  if (OPENCODE_EVENTS.includes(event)) return openCodePayload(hook);
  if (origin.agent === DEVIN_AGENT && typeof event === 'string') {
    return devinPayload(hook, event, origin.env);
  }
  return payload;
}

function copilotPayload(hook: HookFields, hostEvent: string): HookFields {
  const tool = hook['toolName'];
  const result = fieldsOf(hook['toolResult']);
  return {
    hook_event_name: hostEvent,
    session_id: firstText(hook, ['sessionId']) ?? '',
    ...(typeof hook['cwd'] === 'string' ? { cwd: hook['cwd'] } : {}),
    ...(typeof hook['prompt'] === 'string' ? { prompt: hook['prompt'] } : {}),
    ...(typeof tool === 'string'
      ? {
          tool_name: COPILOT_TOOLS[tool] ?? tool,
          tool_input: canonicalInput(argsOf(hook['toolArgs'])),
        }
      : {}),
    ...(result === null ? {} : { tool_response: result['textResultForLlm'] ?? result }),
  };
}

function devinPayload(
  hook: HookFields,
  event: string,
  env: NodeJS.ProcessEnv,
): HookFields {
  const named = event.startsWith(DEVIN_PREFIX) ? event : `${DEVIN_PREFIX}${event}`;
  const tool = hook['tool_name'];
  const cwd = typeof hook['cwd'] === 'string' ? hook['cwd'] : env[DEVIN_PROJECT_VAR];
  const base: HookFields = {
    ...hook,
    hook_event_name: named,
    ...(cwd === undefined || cwd === '' ? {} : { cwd }),
  };
  if (typeof tool !== 'string') return base;
  const input = canonicalInput(fieldsOf(hook['tool_input']) ?? {});
  if (tool === PATCH_TOOL) {
    const patch = firstText(input, PATCH_KEYS);
    return {
      ...base,
      tool_input: patch === undefined ? input : { ...input, command: patch },
    };
  }
  return { ...base, tool_name: DEVIN_TOOLS[tool] ?? tool, tool_input: input };
}

function openCodePayload(hook: HookFields): HookFields {
  const tool = hook['tool_name'];
  if (typeof tool !== 'string') return hook;
  return {
    ...hook,
    tool_name: OPENCODE_TOOLS[tool] ?? tool,
    tool_input: canonicalInput(fieldsOf(hook['tool_input']) ?? {}),
  };
}

/** Copilot hands arguments as an object or as the JSON text of one. */
function argsOf(value: unknown): HookFields {
  if (typeof value !== 'string') return fieldsOf(value) ?? {};
  try {
    return fieldsOf(JSON.parse(value)) ?? {};
  } catch {
    // Text that is not JSON names no argument a rule could be about.
    return {};
  }
}

/** Each argument also under the name the readers take, and an edit list in their words. */
function canonicalInput(input: HookFields): HookFields {
  const next: HookFields = { ...input };
  for (const [from, to] of INPUT_ALIASES) {
    if (next[to] === undefined && next[from] !== undefined) next[to] = next[from];
  }
  const edits = input['edits'];
  if (Array.isArray(edits)) {
    next['edits'] = edits.map((each) => {
      const edit = fieldsOf(each);
      return edit === null ? each : canonicalInput(edit);
    });
  }
  return next;
}

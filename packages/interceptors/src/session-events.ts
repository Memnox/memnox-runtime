import { isAbsolute, relative } from 'node:path';

import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  decisionsBearingOn,
  digest,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  newEventId,
  TOOL_CLASS,
  type MemnoxEvent,
  type ToolClass,
  type WorkspaceMemory,
} from '@memnox/core';

import {
  CURSOR_EDIT_TOOLS,
  CURSOR_EVENT,
  EDIT_HOST,
  GEMINI_EDIT_TOOLS,
  GEMINI_EVENT,
  HERMES_EDIT_TOOLS,
  HERMES_EVENT,
  WINDSURF_EVENT,
  type EditHost,
} from './agent-edits';
import { parsePatch } from './codex-patch';
import { OPENCLAW_EVENT } from './openclaw-payload';
import { COPILOT_EVENT, DEVIN_EVENT, OPENCODE_EVENT } from './named-hosts';
import { EDIT_HOOK_EVENT, EDIT_TOOLS } from './edit-hook';
import {
  CODEX_PATCH_TOOL,
  cwdOf,
  delegationOf,
  fieldsOf,
  firstText,
  folderOf,
  sessionOf,
  type Delegation,
  type HookFields,
} from './hook-payload';

/**
 * The pauses every coding agent has: a tool call returned, a turn ended, a person asked.
 * Each is where a waiting note is handed over, and the first is where what the agent did
 * is written down, so the workspace sees each session as it works.
 */

export const SESSION_MOMENT = {
  /** A tool call returned: record it, and hand over any note as added context. */
  AFTER_TOOL: 'after-tool',
  /** The turn ended: hand over a person's note as the next thing to work on. */
  TURN_END: 'turn-end',
  /** The person just asked for something: hand over any note beside their words. */
  PROMPT: 'prompt',
} as const;

export type SessionMoment = (typeof SESSION_MOMENT)[keyof typeof SESSION_MOMENT];

export interface SessionEvent {
  moment: SessionMoment;
  host: EditHost;
  sessionId: string;
  cwd?: string;
  /** The tool that just ran, on an `after-tool` event. */
  tool?: string;
  input?: Record<string, unknown>;
  /** What the person asked, on a `prompt` event, read for a decision it names. */
  prompt?: string;
  /** The helper whose tool just ran, where the host names one. */
  delegation?: Delegation;
}

/** Which agent sent a pause and which pause it is, by the event name each one uses. */
const PAUSE_EVENTS: Readonly<Record<string, { host: EditHost; moment: SessionMoment }>> =
  {
    [EDIT_HOOK_EVENT.POST_TOOL_USE]: {
      host: EDIT_HOST.PRE_TOOL_USE,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [EDIT_HOOK_EVENT.STOP]: {
      host: EDIT_HOST.PRE_TOOL_USE,
      moment: SESSION_MOMENT.TURN_END,
    },
    [EDIT_HOOK_EVENT.USER_PROMPT_SUBMIT]: {
      host: EDIT_HOST.PRE_TOOL_USE,
      moment: SESSION_MOMENT.PROMPT,
    },
    [CURSOR_EVENT.POST_TOOL_USE]: {
      host: EDIT_HOST.CURSOR,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [CURSOR_EVENT.STOP]: { host: EDIT_HOST.CURSOR, moment: SESSION_MOMENT.TURN_END },
    [GEMINI_EVENT.AFTER_TOOL]: {
      host: EDIT_HOST.GEMINI,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [GEMINI_EVENT.AFTER_AGENT]: {
      host: EDIT_HOST.GEMINI,
      moment: SESSION_MOMENT.TURN_END,
    },
    [GEMINI_EVENT.BEFORE_AGENT]: {
      host: EDIT_HOST.GEMINI,
      moment: SESSION_MOMENT.PROMPT,
    },
    [HERMES_EVENT.POST_TOOL_CALL]: {
      host: EDIT_HOST.HERMES,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [HERMES_EVENT.TURN_END]: { host: EDIT_HOST.HERMES, moment: SESSION_MOMENT.TURN_END },
    [OPENCLAW_EVENT.AFTER_TOOL]: {
      host: EDIT_HOST.OPENCLAW,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [COPILOT_EVENT.POST_TOOL]: {
      host: EDIT_HOST.COPILOT,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [COPILOT_EVENT.TURN_END]: {
      host: EDIT_HOST.COPILOT,
      moment: SESSION_MOMENT.TURN_END,
    },
    [COPILOT_EVENT.PROMPT]: { host: EDIT_HOST.COPILOT, moment: SESSION_MOMENT.PROMPT },
    [DEVIN_EVENT.POST_TOOL]: { host: EDIT_HOST.DEVIN, moment: SESSION_MOMENT.AFTER_TOOL },
    [DEVIN_EVENT.TURN_END]: { host: EDIT_HOST.DEVIN, moment: SESSION_MOMENT.TURN_END },
    [DEVIN_EVENT.PROMPT]: { host: EDIT_HOST.DEVIN, moment: SESSION_MOMENT.PROMPT },
    [OPENCODE_EVENT.POST_TOOL]: {
      host: EDIT_HOST.OPENCODE,
      moment: SESSION_MOMENT.AFTER_TOOL,
    },
    [OPENCODE_EVENT.TURN_END]: {
      host: EDIT_HOST.OPENCODE,
      moment: SESSION_MOMENT.TURN_END,
    },
    [HERMES_EVENT.PRE_LLM_CALL]: {
      host: EDIT_HOST.HERMES,
      moment: SESSION_MOMENT.PROMPT,
    },
  };

/** The pause in this payload, or null where it is not one. */
export function sessionEventOf(payload: unknown): SessionEvent | null {
  const hook = fieldsOf(payload);
  if (hook === null) return null;
  const windsurf = windsurfPause(hook);
  if (windsurf !== undefined) return windsurf;

  const event = hook['hook_event_name'];
  const pause = typeof event === 'string' ? PAUSE_EVENTS[event] : undefined;
  const sessionId = sessionOf(hook);
  if (pause === undefined || sessionId === '') return null;

  const cwd = cwdOf(hook);
  const base = { ...pause, sessionId, ...(cwd === undefined ? {} : { cwd }) };
  if (pause.moment === SESSION_MOMENT.PROMPT) {
    // Hermes carries every event's own fields under `extra`, the person's words among them.
    const prompt =
      pause.host === EDIT_HOST.HERMES
        ? fieldsOf(hook['extra'])?.['user_message']
        : hook['prompt'];
    return typeof prompt === 'string' ? { ...base, prompt } : base;
  }
  if (pause.moment !== SESSION_MOMENT.AFTER_TOOL) return base;
  const tool = hook['tool_name'];
  const input = fieldsOf(hook['tool_input']);
  const delegation = delegationOf(hook);
  return {
    ...base,
    ...(typeof tool === 'string' ? { tool } : {}),
    ...(input === null ? {} : { input }),
    ...(delegation.subagent === undefined ? {} : { delegation }),
  };
}

/**
 * Windsurf's events after a read, a write, a command
 * or an MCP call, as the tool each stands for.
 */
const WINDSURF_AFTER: Readonly<Record<string, string>> = {
  [WINDSURF_EVENT.POST_WRITE]: 'Write',
  [WINDSURF_EVENT.POST_READ]: 'Read',
  [WINDSURF_EVENT.POST_COMMAND]: 'Bash',
  [WINDSURF_EVENT.POST_MCP]: 'mcp',
};

/**
 * A Windsurf pause, or undefined where this is not
 * a Windsurf payload; it has no turn end to answer.
 */
function windsurfPause(hook: HookFields): SessionEvent | null | undefined {
  const action = hook['agent_action_name'];
  if (typeof action !== 'string') return undefined;
  const tool = WINDSURF_AFTER[action];
  const session = firstText(hook, ['trajectory_id']);
  if (tool === undefined || session === undefined) return null;
  const input = fieldsOf(hook['tool_info']) ?? {};
  const path = input['file_path'];
  const cwd = typeof path === 'string' ? folderOf(path) : undefined;
  return {
    moment: SESSION_MOMENT.AFTER_TOOL,
    host: EDIT_HOST.WINDSURF,
    sessionId: session,
    tool,
    input,
    ...(cwd === undefined ? {} : { cwd }),
  };
}

/** The event names a host reads added context under, at a prompt and after a tool. */
interface ContextEvents {
  prompt: string;
  afterTool: string;
}

const GEMINI_CONTEXT: ContextEvents = {
  prompt: GEMINI_EVENT.BEFORE_AGENT,
  afterTool: GEMINI_EVENT.AFTER_TOOL,
};

const PRE_TOOL_USE_CONTEXT: ContextEvents = {
  prompt: EDIT_HOOK_EVENT.USER_PROMPT_SUBMIT,
  afterTool: EDIT_HOOK_EVENT.POST_TOOL_USE,
};

/**
 * What the host reads back: the notes in the field that puts them in front of the model,
 * as added context after a tool and as the next thing to do at a turn's end. Cursor gets
 * an empty object when there is nothing, because it reads a non-JSON reply as a block.
 */
export function sessionAnswer(event: SessionEvent, notes: string | null): string {
  // Windsurf reads nothing back from these, so there is nothing to say.
  if (!readsNotesAt(event.host, event.moment)) return '';
  if (event.host === EDIT_HOST.CURSOR) return cursorAnswer(event, notes);
  if (event.host === EDIT_HOST.HERMES) return hermesAnswer(event, notes);
  if (notes === null) return '';
  if (event.moment === SESSION_MOMENT.TURN_END) {
    const decision = event.host === EDIT_HOST.GEMINI ? 'deny' : 'block';
    return JSON.stringify({ decision, reason: notes });
  }
  const names = event.host === EDIT_HOST.GEMINI ? GEMINI_CONTEXT : PRE_TOOL_USE_CONTEXT;
  const hookEventName =
    event.moment === SESSION_MOMENT.PROMPT ? names.prompt : names.afterTool;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext: notes },
  });
}

/** Hermes reads `{ context }` before a model call and nothing back after a tool or a turn. */
function hermesAnswer(event: SessionEvent, notes: string | null): string {
  if (notes === null || event.moment !== SESSION_MOMENT.PROMPT) return '';
  return JSON.stringify({ context: notes });
}

/** Whether this host reads a note back at this pause, so one it cannot show is left waiting. */
export function readsNotesAt(host: EditHost, moment: SessionMoment): boolean {
  // OpenClaw's and OpenCode's after-tool hooks only observe, and Copilot drops what these print.
  const silent: readonly string[] = [
    EDIT_HOST.WINDSURF,
    EDIT_HOST.OPENCLAW,
    EDIT_HOST.COPILOT,
    EDIT_HOST.OPENCODE,
  ];
  if (silent.includes(host)) return false;
  // Devin reads context at a prompt and a block at a stop, and nothing after a tool.
  if (host === EDIT_HOST.DEVIN) return moment !== SESSION_MOMENT.AFTER_TOOL;
  return host !== EDIT_HOST.HERMES || moment === SESSION_MOMENT.PROMPT;
}

function cursorAnswer(event: SessionEvent, notes: string | null): string {
  if (notes === null) return '{}';
  return JSON.stringify(
    event.moment === SESSION_MOMENT.TURN_END
      ? { followup_message: notes }
      : { additional_context: notes },
  );
}

/** The tools that read a file, by the names the agents give them. */
const READ_TOOLS: readonly string[] = ['Read', 'NotebookRead', 'read_file'];

/**
 * The tools that write one, in any agent's words.
 * Codex's patch is read apart, since it names several.
 */
const WRITE_TOOLS: readonly string[] = [
  ...new Set([
    ...EDIT_TOOLS,
    ...CURSOR_EDIT_TOOLS,
    ...GEMINI_EDIT_TOOLS,
    ...HERMES_EDIT_TOOLS,
  ]),
];

/** Where any agent's file tool names its file. */
const PATH_KEYS: readonly string[] = [
  'file_path',
  'notebook_path',
  'path',
  'target_file',
];

/** One file an in-agent tool touched, as the row will name it. */
interface FileTouch {
  operation: string;
  toolClass: ToolClass;
  path?: string;
}

const FILE_READ = { operation: 'file.read', toolClass: TOOL_CLASS.READ } as const;
const FILE_EDIT = { operation: 'file.edit', toolClass: TOOL_CLASS.WRITE } as const;

/**
 * What the agent just did, as rows for the ledger, names and paths only. A shell command
 * or an MCP call is already a row from its own seam, so only in-agent tools are recorded.
 */
export function activityOf(
  event: SessionEvent,
  agent: string,
  root: string | undefined,
  at: string,
): MemnoxEvent[] {
  return filesTouched(event).map((file) =>
    fileRow({
      event,
      agent,
      at,
      operation: file.operation,
      toolClass: file.toolClass,
      target: file.path === undefined ? undefined : shown(file.path, root, event.cwd),
    }),
  );
}

/**
 * Each write marked with the settled decisions its path bears on, as the brief found them,
 * so the control plane can ask whoever answers for one to look. A read decided nothing.
 */
export function withDecisions(
  rows: readonly MemnoxEvent[],
  memory: WorkspaceMemory,
): MemnoxEvent[] {
  return rows.map((row) => {
    if (row.operation !== FILE_EDIT.operation || row.target === undefined) return row;
    const decisionIds = decisionsBearingOn(memory, row.target);
    return decisionIds.length === 0 ? row : { ...row, decisionIds };
  });
}

function filesTouched(event: SessionEvent): FileTouch[] {
  if (event.moment !== SESSION_MOMENT.AFTER_TOOL || event.tool === undefined) return [];
  const input = event.input ?? {};
  if (event.tool === CODEX_PATCH_TOOL) {
    const patch = input['command'];
    if (typeof patch !== 'string') return [];
    return parsePatch(patch).map((file) => ({ ...FILE_EDIT, path: file.path }));
  }
  const path = firstText(input, PATH_KEYS);
  const named = path === undefined ? {} : { path };
  if (READ_TOOLS.includes(event.tool)) return [{ ...FILE_READ, ...named }];
  if (WRITE_TOOLS.includes(event.tool)) return [{ ...FILE_EDIT, ...named }];
  return [];
}

/**
 * Relative to the repository where the file is inside it, so no home directory is sent.
 */
function shown(path: string, root: string | undefined, cwd: string | undefined): string {
  const base = root ?? cwd;
  if (base === undefined || !isAbsolute(path)) return path;
  const inside = relative(base, path);
  return inside.startsWith('..') ? path : inside;
}

interface FileRowInput {
  event: SessionEvent;
  agent: string;
  at: string;
  operation: string;
  toolClass: ToolClass;
  target: string | undefined;
}

function fileRow(input: FileRowInput): MemnoxEvent {
  const { event, target } = input;
  return {
    id: newEventId(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: input.at,
    sessionId: event.sessionId,
    agent: input.agent,
    actorType: ACTOR_TYPE.AGENT,
    ...(event.delegation ?? {}),
    surface: EVENT_SURFACE.FILESYSTEM,
    operation: input.operation,
    class: input.toolClass,
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: `${event.tool ?? 'a tool'} ran in the agent`,
    // A digest of the path, never the file: a row carries names, not contents.
    argsDigest: digest(target ?? ''),
    ...(target === undefined ? {} : { target }),
  };
}

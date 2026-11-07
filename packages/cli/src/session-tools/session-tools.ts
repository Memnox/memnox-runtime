/**
 * The tools the session server offers, and the one rule over the list: nothing here lets an
 * agent loosen, allow, approve, trust or unfreeze, since it would approve itself. Recording
 * a first code fingerprint is the one write, and it can only add what an agent is held to.
 */
import {
  decisionsTool,
  replayTool,
  statusTool,
  whyTool,
  type SessionToolDeps,
  type ToolArgs,
} from './read-tools';
import { rewindTool, type RewindSeams } from './rewind-tool';
import { briefTool, memoryTool } from './memory-tools';
import { fingerprintTool } from './fingerprint-tool';
import { workTool } from './work-tools';
import { suggestTool } from './suggest-tool';
import { appRunTool, appsTool } from './app-calls';
import { AGENT_WORK_CALLS, AGENT_WORK_TOOLS } from './agent-work-tools';

/** One argument a tool takes: a string, or a list of small objects, such as a walk through's pages. */
export type ToolProperty =
  | { type: 'string'; description: string }
  | {
      type: 'array';
      description: string;
      items: {
        type: 'object';
        properties: Record<string, { type: 'string'; description: string }>;
      };
    };

/** A tool as `tools/list` describes it; the annotations are how a host decides to ask. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolProperty>;
  };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: false };
}

/**
 * Words no tool name may carry. Asserted in a test, because the day one does, an agent
 * can grant itself what its person was asked for. A person does those at a terminal or the console,
 * and that includes giving an agent work or a job, since a task is written by a person.
 */
export const NEVER_OFFERED: readonly string[] = [
  'allow',
  'approve',
  'grant',
  'trust',
  'unfreeze',
  'freeze',
  'lift',
  'mode',
  'rule',
  'policy',
  'enroll',
  'enrol',
  'assign',
  'bind',
  'execute',
];

export function readTool(
  name: string,
  description: string,
  properties: ToolDefinition['inputSchema']['properties'] = {},
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  };
}

export const SESSION_ARG = {
  type: 'string',
  description: "a session id; this agent's own latest when left out",
} as const;

/** The two arguments every budgeted memory read takes, worded once so each costs its tokens once. */
const BUDGET_ARGS = {
  budget: {
    type: 'string',
    description: 'most tokens to answer with, 800 when left out',
  },
  cursor: { type: 'string', description: 'the next an earlier answer gave, for more' },
} as const;

export const SESSION_TOOLS: readonly ToolDefinition[] = [
  readTool(
    'why',
    'Why Memnox refused or asked about something in this session: the rule, its reason and source, and what to do instead.',
    {
      event: {
        type: 'string',
        description: 'a ledger event id; the latest refusal or ask when left out',
      },
      session: SESSION_ARG,
    },
  ),
  readTool(
    'status',
    'Where this machine stands: the mode, what is held, and what happened today.',
  ),
  readTool('replay', 'What this session did, step by step and newest last, compact.', {
    session: SESSION_ARG,
  }),
  readTool(
    'decisions',
    'The rules and remembered decisions that cover an action or a path. Evaluates only; runs nothing.',
    {
      action: {
        type: 'string',
        description: 'a command such as "git push --force", or a verb such as "git.push"',
      },
      path: { type: 'string', description: 'a file or directory the action touches' },
    },
  ),
  readTool(
    'memory',
    'What your workspace settled: decisions, policies, owners, approvers. Search with about first; each line ends [id; origin], so pass id to read one whole. Answers fit a token budget, and lines this session already saw are counted, not resent. Cite what it says.',
    {
      about: {
        type: 'string',
        description:
          'key words or paths, such as "payment retries"; newest when left out',
      },
      id: { type: 'string', description: 'one memory to read whole, by its line id' },
      ...BUDGET_ARGS,
    },
  ),
  readTool(
    'brief',
    'Before your first edit: the decisions, owners, agents holding and recent work on the paths you will change, cut to a token budget.',
    {
      paths: {
        type: 'string',
        description: 'the paths, services or repository about to change, comma separated',
      },
      repository: {
        type: 'string',
        description: 'the repository, where the workspace knows it by name',
      },
      budget: BUDGET_ARGS.budget,
    },
  ),
  readTool(
    'work',
    'The workspace brief your instruction named: the ticket, what people said about it, and the settled decisions it must keep to. Read it before you change anything when your task names one.',
    {
      brief: {
        type: 'string',
        description: 'the brief id your task or instruction named, such as wrk_1a2b3c',
      },
    },
  ),
  {
    name: 'fingerprint',
    description:
      "Record how this repository's code is written, once, so every agent here is held to it: call it without `yaml` for what to write, then with it. Only a repository that states none yet is recorded.",
    inputSchema: {
      type: 'object',
      properties: {
        yaml: {
          type: 'string',
          description: 'the fingerprint, as the call without it describes',
        },
      },
    },
    // Writes one file and only ever adds what agents are held to, so nothing to confirm.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'memnox_suggest',
    description:
      'Propose something you learned for your person to confirm: a fact, a convention, or a rule with its effect and actions. It waits in their Learn queue and is never a fact or a rule until they confirm it.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'fact, convention or rule; fact when left out',
        },
        statement: {
          type: 'string',
          description: 'what you learned, in one or two sentences',
        },
        about: { type: 'string', description: 'what it is about, in two or three words' },
        effect: {
          type: 'string',
          description: 'on a rule: allow, ask or deny; ask when left out',
        },
        actions: {
          type: 'string',
          description:
            'on a rule: the action patterns it covers, comma separated, such as "*deploy*"',
        },
        targets: {
          type: 'string',
          description: 'on a rule: target patterns, comma separated',
        },
        reason: { type: 'string', description: 'on a rule: why, in a sentence' },
      },
    },
    // Adds to a queue only a person answers, and changes nothing an agent is held to.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  readTool(
    'apps',
    "Find a tool in your person's connected apps (GitHub, Linear, Gmail, Slack and the rest they connected to Memnox): what each does, its inputs, and whether it reads or acts. Use these through Memnox rather than connecting the app yourself.",
    {
      what: {
        type: 'string',
        description: 'the job in a few words, such as "list my open pull requests"',
      },
      toolkit: {
        type: 'string',
        description: 'one app by its slug, such as github, when the job names one',
      },
    },
  ),
  {
    name: 'app_run',
    description:
      "Run one tool of your person's connected apps through Memnox. A read their rules allow runs at once; anything that sends or changes something waits on their Mac until they press Send and confirm with Touch ID. Pass proposal alone to hear whether a waiting one went.",
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'a slug apps returned' },
        arguments: {
          type: 'string',
          description: 'the inputs as a JSON object, as apps described them',
        },
        label: {
          type: 'string',
          description: 'for a tool that acts: what it does, in plain words, for the card',
        },
        proposal: {
          type: 'string',
          description: 'a proposal id app_run returned, to hear what became of it',
        },
      },
    },
    // Rules on the app call it carries itself and waits on the person's signature for any act.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'rewind',
    description:
      'Put the working tree back to before the last session changed it, or to a milestone. Your person must approve it; the current files are kept first.',
    inputSchema: {
      type: 'object',
      properties: {
        milestone: {
          type: 'string',
          description: 'a milestone id from "memnox rewind --list"',
        },
        session: {
          type: 'string',
          description: 'rewind to before this session; the newest one when left out',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  ...AGENT_WORK_TOOLS,
];

/** Answers one call by name, or null for a name this server never offered. */
export async function callTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  name: string,
  args: ToolArgs,
): Promise<unknown> {
  switch (name) {
    case 'why':
      return whyTool(deps, args);
    case 'status':
      return statusTool(deps);
    case 'replay':
      return replayTool(deps, args);
    case 'decisions':
      return decisionsTool(deps, args);
    case 'memory':
      return memoryTool(deps, args);
    case 'brief':
      return briefTool(deps, args);
    case 'work':
      return workTool(deps, args);
    case 'fingerprint':
      return fingerprintTool(deps, args);
    case 'memnox_suggest':
      return suggestTool(deps, args);
    case 'apps':
      return appsTool(deps, args);
    case 'app_run':
      return appRunTool(deps, args);
    case 'rewind':
      return rewindTool(deps, seams, args);
    default:
      return Object.hasOwn(AGENT_WORK_CALLS, name)
        ? (AGENT_WORK_CALLS[name]?.(deps, args) ?? null)
        : null;
  }
}

import { AGENT_ARG, proposeTool, SAID_ARG } from './operator-args';
import { readTool, SESSION_ARG, type ToolDefinition } from './session-tools';
import { APP_ACTION, TOOL_ARG } from './session-tools.constants';

/**
 * The tools that act on the person's behalf beyond reading: running memnox commands, tracing,
 * scanning, watching, walking through, starting and putting back. Each reads back or proposes first.
 */
export const ACTING_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'memnox_command',
    description:
      'Run any memnox command the person asks for, like "status", "timeline --since 1h", "doctor", "mode autonomous", "freeze" or "protect --yes". What only reads runs now and its output comes back for you to sum up. What changes something is proposed and runs only after their Touch ID. "login" connects this machine alone to Memnox Cloud, while signing the person in as themselves is memnox_sign_in, and "agents onboard <agent> [more agents]" puts one or several agents under it with one Touch ID: after Touch ID each runs on its own, with a browser page to approve and no terminal, and its end is told to you. A few never run by voice, and it says why. Run "help <command>" first when unsure of a flag. Commands that change something run with no terminal, so pass --yes to one that would otherwise stop to ask.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'the command and its flags, without "memnox", like "timeline --since 1h"',
        },
        said: SAID_ARG,
      },
    },
    // It reads at once, and anything that changes something is only proposed and waits on Touch ID.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  readTool(
    'command_output',
    'What a memnox command printed after the person confirmed it with Touch ID, by the id memnox_command returned.',
    { proposal: { type: 'string', description: 'the id memnox_command returned' } },
  ),
  {
    name: 'traces',
    description:
      'How something ran, step by step, like Logfire: Memnox answering the person (hearing them, the brain, each tool, speaking) or an agent session (each turn and action, with its decision, time and exit). Use it for "why was that slow", "what took so long", "trace that session" or "show me the trace". It draws a waterfall on their screen unless show is "false".',
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION_ARG,
        trace: {
          type: 'string',
          description: 'a trace id; the last question when nothing is named',
        },
        show: { type: 'string', description: '"false" to answer without drawing it' },
      },
    },
    // It writes a request to draw on the person's screen, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'show_agents',
    description:
      'Scan this Mac live and put every agent on the whole screen, each with its logo, its MCP servers, what else it reaches and its sessions now. Use it when they ask to scan their computer, or to list, see or show all their agents. Never for their sessions: all their sessions is show with display all. It reads and starts nothing.',
    inputSchema: { type: 'object', properties: {} },
    // It writes a request to draw on the person's screen, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'watch_for',
    description:
      'Tell the person out loud, once, when something happens in a session: "finished" when its turn ends, "tests_pass" or "tests_fail" when it next runs its tests, "stuck" when it is paused or waiting on them. Use it for "tell me when", "let me know if" and "shout when". It changes nothing an agent can do.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT_ARG,
        session: SESSION_ARG,
        for: { type: 'string', description: 'finished, tests_pass, tests_fail or stuck' },
        said: SAID_ARG,
      },
    },
    // It writes a note to speak up later, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'walk_through',
    description:
      "Walk the person through what a session changed: a card in the corner turns one page per file, showing that file's changed lines, while you say each note. Call changes first, pick the two to five files that matter, and pass one note per file: one or two spoken sentences on what that file's change does.",
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT_ARG,
        session: SESSION_ARG,
        title: {
          type: 'string',
          description: 'the card heading, the task in a few words',
        },
        pages: {
          type: 'array',
          description: 'in the order you will say them',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'the file, as changes listed it' },
              note: { type: 'string', description: 'what you will say about it' },
            },
          },
        },
      },
    },
    // It writes a request to draw on the person's screen, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  proposeTool(
    'propose_start',
    'Start a new agent session the person asked for, like "start Claude in memnox cloud on the failing test", "open Claude Code in VS Code and ask it to check the changes" or "open Codex desktop and ask it to review my changes". Nothing starts: it returns an id and the words to read back. Pass task in their words, and repository as they named it: a repository, any folder in their home, or a path create_folder returned. Leave task out when they only asked to open or start a session, so it opens waiting for them: never make one up.',
    {
      agent: {
        type: 'string',
        description:
          'claude-code, codex, cursor or hermes, as they named it; claude-code when left out. The Codex app, ChatGPT app and Codex desktop are codex, Claude desktop and the Claude app are claude-code',
      },
      app: {
        type: 'string',
        description:
          '"true" to open a new chat in the agent\'s own desktop app on the repository and type the task into it, when they say app, desktop, or the app by name such as Claude desktop, Codex app, ChatGPT, or Cursor when Cursor itself is the agent; "false" for a new terminal tab; left out, it goes where they last had this agent, the app, an editor or a terminal. An agent named in an editor, like Claude Code in VS Code, is editor, never app. With app "true", task may be left out to only open the app',
      },
      [TOOL_ARG.PANEL]: {
        type: 'string',
        description:
          '"true" to start Claude Code in its panel inside the editor as a new conversation, when they ask for the Claude panel, the Claude extension or the chat in the editor rather than a terminal; pass editor too when they named one',
      },
      [TOOL_ARG.TERMINAL]: {
        type: 'string',
        description:
          'the terminal to start it in, as they named it, such as "tmux", "WezTerm", "Ghostty", "Warp", "kitty" or "iTerm", when they ask for one: a new window opens there on the repository and the agent starts in it; leave it out otherwise',
      },
      editor: {
        type: 'string',
        description:
          'the editor to start it inside, as they named it, such as "VS Code", "Visual Studio Code", "code", "Cursor" or "Windsurf", when they ask for the agent in, within or inside an editor, like "open Claude Code in VS Code": a new terminal opens inside that editor on the repository and the agent starts there, where later instructions can be typed into it. "true" takes the editor they have installed. Never pass app with it',
      },
      repository: {
        type: 'string',
        description:
          'the repository as they named it, like "memnox cloud"; leave it out when they named none, and the ticket\'s repository or the one their last session worked in is taken',
      },
      task: {
        type: 'string',
        description: 'what the new session should do, in their words',
      },
      work: {
        type: 'string',
        description:
          'the ticket or task from the workspace this is about, by its title or key words, such as "Fix auth token refresh", when they ask an agent to implement, fix or work on one: the ticket, what was said about it and the decisions that bind it are gathered and handed to the agent',
      },
      hold_credentials: {
        type: 'string',
        description:
          '"true" to start it with no token such as GITHUB_TOKEN or AWS keys in its environment, each CLI getting back only its own token when it runs, when they ask to keep tokens or credentials away from it',
      },
      said: SAID_ARG,
    },
  ),
  {
    name: 'start_session',
    description:
      'Start a session from propose_start, only after the person said yes to it read back. A new terminal tab opens in that repository and the agent starts on the task under memnox run; for an editor, a new terminal opens inside that editor instead; for a desktop app, the app opens on that repository with the task in it.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'the id propose_start returned' },
      },
    },
    // It starts an agent the person asked for; everything that agent then does is ruled as ever.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'type_in_app',
    description:
      'Type a message into the chat the person has open in an agent\'s desktop app, Claude desktop, the Codex app, Cursor or Hermes, or any other app on this Mac they name, such as Windsurf, Zed, ChatGPT, Perplexity or Warp, and send it, the way they would type it, so they watch it go in. Use it for "type in Claude desktop and ask it to discuss Memnox", "ask the Codex app to run the tests", "in Windsurf, ask Cascade to fix the build" or "in this chat, tell it to continue". For a new chat in the app on a repository, use propose_start with app "true" instead.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description:
            'claude-code for Claude desktop, codex for the Codex or ChatGPT app, cursor or hermes; claude-code when left out',
        },
        app: {
          type: 'string',
          description:
            'any other app by the name they said, such as Windsurf or Perplexity, when it is none of those four; leave agent out then',
        },
        [TOOL_ARG.NEW_CHAT]: {
          type: 'string',
          description:
            '"true" to start a new chat in the app first, when they ask for a new chat or conversation there, rather than typing into the one open',
        },
        message: {
          type: 'string',
          description:
            'what to type, exactly as they asked the agent, fixing only misheard words, as for propose_instruction',
        },
      },
    },
    // It types what the person asked into an app they use; what that agent then does is ruled as ever.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'control_app',
    description:
      'Stop or close an agent\'s desktop app or any app the person names, when no session of theirs runs there: action "stop" stops the reply it is writing, like "stop Claude desktop" or "cancel that in ChatGPT", and "close" closes its window, keeping the chat in the app. A session in a terminal, an editor or its panel is stopped and closed with show instead.',
    inputSchema: {
      type: 'object',
      properties: {
        [TOOL_ARG.ACTION]: {
          type: 'string',
          description: `${APP_ACTION.STOP} or ${APP_ACTION.CLOSE}`,
        },
        agent: {
          type: 'string',
          description: 'claude-code, codex, cursor or hermes for their own apps',
        },
        app: { type: 'string', description: 'any other app by the name they said' },
      },
    },
    // It presses Stop or closes a window the person named; nothing in the app is deleted.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  proposeTool(
    'propose_rewind',
    'Put a repository back to how it was before what a session just did, when the person says it broke something or asks to undo it. Nothing moves until they confirm with Touch ID; their current files are kept first. Pass undo "true" when they ask to bring back what a rewind put away.',
    {
      agent: AGENT_ARG,
      session: SESSION_ARG,
      undo: {
        type: 'string',
        description: '"true" to bring back what the last rewind put away',
      },
      said: SAID_ARG,
    },
  ),
];

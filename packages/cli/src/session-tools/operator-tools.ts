import { unattendedCheck } from '@memnox/core';
import { traceToolCall } from '../trace/tool-span';
import { readUnattended } from '../commands/unattended.command';
import { WaitingFeed } from '../daemon/waiting-feed';
import { readCloudAgents } from '../sync/cloud-agents';
import { DEFAULT_AGENT } from '../next/boundary-report';
import { changesTool, readingFor } from './changes-tool';
import { readReach } from '../operator/vocabulary';
import { proposeInstructionTool, sendInstructionTool } from './instruct-tools';
import { proposeAnswerTool, proposeRuleTool } from './propose-tools';
import { PROPOSE_RULE_TOOL } from './spoken-rule-tool';
import { outsideTool } from './outside-tool';
import { repositoryTool } from './repository-tool';
import { showAgentsTool } from './agents-tool';
import { commandOutputTool, memnoxCommandTool } from './command-tool';
import { tracesTool } from './traces-tool';
import { aboutTool } from './about-tool';
import { briefTool, workspaceMemoryTool } from './memory-tools';
import { PEOPLE_TOOL, peopleTool, sourcesTool } from './work-tools';
import { PERSONAL_CALLS, PERSONAL_TOOLS } from './personal-catalogue';
import { answerQuestionTool } from './question-tool';
import { proposeRewindTool } from './rewind-proposal';
import { pauseSessionTool, proposeResumeTool } from './session-actions';
import { AGENT_PAUSE_CALLS, AGENT_PAUSE_TOOLS } from './agent-pause-tools';
import { proposeStartTool, startSessionTool } from './start-tools';
import { controlAppTool, typeInAppTool } from './app-tools';
import { walkThroughTool } from './walk-tool';
import { watchForTool } from './watch-tool';
import { historyTool } from './history-tool';
import { sessionTool } from './session-tool';
import { showTool } from './show-tool';
import { FORGET_SCREEN_TOOL, LOOK_CALLS, LOOK_TOOL } from './look-tool';
import { ANSWER_AGENT_CALLS, ANSWER_AGENT_TOOL } from './answer-agent-tool';
import { sessionsTool } from './sessions-tool';
import {
  decisionsTool,
  replayTool,
  statusTool,
  textArg,
  whyTool,
  type SessionToolDeps,
  type ToolArgs,
} from './read-tools';
import type { RewindSeams } from './rewind-tool';
import type { OperatorCall } from './operator-call';
import { heldInGuess } from './guess-hold';
import type { ToolCatalogue } from './session-server';
import { ACTING_TOOLS } from './acting-tools';
import { FOLDER_CALLS, FOLDER_TOOLS } from './folder-tools';
import { HANDOVER_CALLS, HANDOVER_TOOLS } from './handover-tools';
import { WORKSPACE_ASK_CALLS, WORKSPACE_ASK_TOOLS } from './workspace-ask-tools';
import { HEARD_WORD_CALLS, HEARD_WORD_TOOLS } from './heard-words-tools';
import { PROFILE_CALLS, PROFILE_TOOLS } from './profile-tools';
import { AGENT_ARG, proposeTool, SAID_ARG } from './operator-args';
import { readTool, SESSION_ARG, type ToolDefinition } from './session-tools';
import { TOOL_ARG } from './session-tools.constants';

/**
 * The tools the voice's brain is given, and the one rule over them: it reads everything and
 * writes only a proposal. A person's agent CLI runs it with these tools and none of its own.
 */

export const OPERATOR_TOOLS: readonly ToolDefinition[] = [
  readTool(
    'status',
    'Where this machine stands: the mode, which agents are here, what is held, and what happened today.',
  ),
  readTool(
    'sessions',
    'Every agent session on this machine lately, working ones first: the agent, its task, the repository, its state, whether a turn is in progress, its helpers (subagents launched, working and finished), what is waiting on the person and whether it is paused. Working sessions come first; when the person did not say which, the first is the one they mean.',
    {
      agent: AGENT_ARG,
      hours: { type: 'string', description: 'how far back to look; 24 when left out' },
    },
  ),
  readTool(
    'session',
    'Everything about one session in one call: its state, task, the latest of its conversation with the person, its last steps with failures and refusals marked, its helpers and the files it changed. Use it for what a session is doing, did, said or changed, before replay or changes, which go deeper.',
    { agent: AGENT_ARG, session: SESSION_ARG },
  ),
  readTool(
    'reach',
    'What the agents on this machine can use: the agents themselves, each MCP server and which agents start it, and the CLIs Memnox watches, which any agent with a shell can run, and which of those are signed in, so an agent running them acts as the person, and for each agent whether it approves its own actions or asks first and where its program was installed from and who signed it. Answer "is Claude Code connected to Railway" and "which agents act without asking" from here. It knows only this machine, never the apps their workspace connected, such as Gmail, Slack or Linear, which my_accounts lists.',
  ),
  readTool(
    'cloud_agents',
    'The agents the team runs in the cloud, on no machine here, through the guard library, the MCP gateway or the MCP door: for each, its last decisions with what was allowed, asked and refused, what it is waiting on a person for, and any session the circuit breaker paused. Answer "what is the support agent doing" from here when that agent is not one of this machine\'s sessions. A paused cloud session is resumed from the phone or the console, never from here.',
  ),
  readTool(
    'waiting',
    'What is waiting on the person right now: held calls from agents, and proposals to confirm. Each has an id to answer with.',
  ),
  readTool(
    'unattended',
    'Whether an agent can be left running on its own, and what to settle first if not. Counts and facts, never a score.',
    { agent: AGENT_ARG },
  ),
  readTool(
    'why',
    'Why Memnox refused or asked about something an agent did: the rule, its reason and source, and what to do instead.',
    {
      agent: AGENT_ARG,
      event: {
        type: 'string',
        description: 'a ledger event id; the latest when left out',
      },
      session: SESSION_ARG,
    },
  ),
  readTool(
    'history',
    'One session from start to end: when it started, whether and how it ended, and every turn in it, what the person asked, what the agent answered, the files it wrote, its commits and pushes, what was refused and what was put to them. Use it for "what happened in that session", "what did it do all day", "walk me through the whole session" and "when did it end"; use session for what it is doing right now. Works for any session, however long ago.',
    { agent: AGENT_ARG, session: SESSION_ARG },
  ),
  readTool('replay', "What an agent's session did, step by step and newest last.", {
    agent: AGENT_ARG,
    session: SESSION_ARG,
  }),
  readTool(
    'decisions',
    'The rules that cover an action or a path for an agent, evaluated and run nowhere.',
    {
      agent: AGENT_ARG,
      action: {
        type: 'string',
        description: 'a command such as "railway deploy", or a verb such as "git.push"',
      },
      path: { type: 'string', description: 'a file or directory the action touches' },
    },
  ),
  readTool(
    'about',
    'What the Memnox project itself says: its vision in thirty three numbered sections, its architecture, every command and flag, policies, onboarding, use cases, the threat model, the FAQ, the build plan and the changelog. Answer any question about what Memnox is, why it exists, how a part of it works, what a command does, what a vision section says, what shipped in a release or how it is priced from here, never from memory. Pass question with the key words of what they asked; leave it out for a list of what is written down.',
    {
      question: {
        type: 'string',
        description:
          'the key words of their question, such as "circuit breaker", "section 15", "protect enforce" or "pricing"',
      },
    },
  ),
  readTool(
    'memory',
    'What the person\'s Memnox Cloud workspace has settled, as this Mac last pulled it: decisions, policies, who approves what and who owns what, each with who confirmed it, when and where it came from, and how many facts the workspace holds. Answer "what is in my workspace", "what does the cloud know", "summarise our memory" and "who owns billing" from here, never from the console. Pass about with the key words of their question; leave it out for the newest.',
    {
      about: {
        type: 'string',
        description:
          'words or paths the question is about, such as "payment retries" or "src/billing"; the newest when left out',
      },
    },
  ),
  readTool(
    'sources',
    'What people actually said, filed or wrote in the systems the workspace connects: Slack and Discord messages, Linear, Jira and GitHub issues, and documents, each with its title, a short excerpt, who wrote it, when and a link, as far as this Mac is cleared to read. Each ticket opens with its status, priority and who it is assigned to. Answer "what did we say in Slack", "who said this", "what does Priya have to work on", "what tickets do I have", "how many tickets" and "what is the ticket about" from here, and find a ticket here before an agent works on it.',
    {
      about: {
        type: 'string',
        description: 'the key words, such as "auth token" or "rate limiting"',
      },
      person: {
        type: 'string',
        description: 'who wrote or said them: a name, email or handle',
      },
      assignee: {
        type: 'string',
        description:
          'whose tickets: a name or part of one, matched against who each ticket is assigned to',
      },
      system: {
        type: 'string',
        description: 'slack, discord, linear, jira, github or document',
      },
      since: { type: 'string', description: 'an ISO date; nothing before it' },
    },
  ),
  PEOPLE_TOOL,
  readTool(
    'brief',
    'Ask the workspace, live, about paths, services or a repository: the decisions that bear on them, who owns them, which agent holds them and what landed there lately. Falls back to what this Mac pulled when the cloud cannot be reached, and says so.',
    {
      paths: {
        type: 'string',
        description: 'the paths, services or repository, comma separated',
      },
      repository: {
        type: 'string',
        description: 'the repository, where the workspace knows it by name',
      },
    },
  ),
  readTool(
    'keep_listening',
    'The person has not finished: they paused mid thought, like "so I was working on the feature" or "I wanted to ask you something". Call it and write nothing at all, and the orb keeps listening for the rest instead of answering half a sentence.',
  ),
  readTool(
    'end_conversation',
    'The person is done talking for now: they said thanks, that is all, no thanks, or it is fine to an offer. Call it alongside your short last reply, and the orb closes once you have said it instead of listening on. Never after answering a question or reporting something, since they often ask a follow up, and never while a held call is waiting on them.',
  ),
  readTool(
    'repository',
    'Which branch a session\'s repository is on, the commits made there since the session started, each with its short id, time, message and files, latestCommits, the branch\'s newest commits whoever made them and however long ago, each with its short id, time, author and message, and uncommitted, what git status lists as not yet committed. Answer "which branch", "read the commit it just made", "what did it commit", "what was the last commit", "the last commit message" and "check the git status" from here, yourself, rather than asking the agent to run it: the last commit is the first of latestCommits. Pass repository with a folder name such as "shop-api" when they name a project rather than a session.',
    {
      agent: AGENT_ARG,
      session: SESSION_ARG,
      repository: {
        type: 'string',
        description: 'a repository folder name or path, when they name a project',
      },
    },
  ),
  readTool(
    'outside',
    'What an agent\'s session reached outside this machine: each host it fetched from or searched, each MCP server and the tools it called there, and pages a browser opened, with how often, when, and how many the rules held. Destinations only; what came back is never recorded. Answer "what is it reading from" or "what services is it talking to" from here.',
    { agent: AGENT_ARG, session: SESSION_ARG },
  ),
  readTool(
    'changes',
    'What an agent\'s session changed in the code: each file with lines added and removed, or the diff of one file with its actual lines, and the task it was given. Answer "what is it changing" or "what files" from here, and pass path for the lines of one file.',
    {
      agent: AGENT_ARG,
      session: SESSION_ARG,
      path: {
        type: 'string',
        description: 'one changed file, for its diff; the list of files when left out',
      },
      repository: {
        type: 'string',
        description:
          'the repository, when it cannot be found from what the session touched',
      },
    },
  ),
  {
    name: 'show',
    description:
      'Show the person a session. display "open" brings the session itself forward: its own terminal tab, or its editor window and the terminal or conversation it runs in, so they can carry on there. display "watch" opens a live window in the middle of the screen showing what it is doing now and its conversation. display "card" puts a card in the top left corner of their screen with a title and a markdown summary of what happened, for them to read while you say the gist. display "all" puts every session up at once, one card each, and needs no session. display "stop" presses Escape in the terminal it runs in, which stops what it is doing at once and keeps its tab and conversation. display "close" closes its live window and its own terminal tab, in iTerm, Terminal or an editor, which ends the agent there; while a turn is in progress it refuses unless now is "true". display "dismiss" takes every Memnox card, live window and board off the screen at once, needs no session and ends nothing. Use open when they ask to open it, go to it, switch to it or take them to it; watch only when they ask to watch it live or see it as it happens; card when they ask for a summary, what a session did, or say yes, here or in front of me after you offered a summary; all when they ask to see all their sessions, every session or them all at once, which is never show_agents; stop when they ask to stop, interrupt, cancel or halt an agent or what it is doing now, like "stop it", "stop Claude" or "cancel that", which is never close and never pause_session; close when they ask to close a session, its tab or its terminal, which is never pause_session; dismiss when they ask to close, clear or hide the popups, the cards, the windows or the screen, which never closes a session. Only close ends anything: a session mid turn only when they said to close it now after hearing that it ends the work in progress. Claude desktop, the Codex app and Hermes are apps, never a session to show: type into one with type_in_app.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT_ARG,
        session: SESSION_ARG,
        display: {
          type: 'string',
          description:
            'open, watch, card, stop, close, dismiss or all; card when left out',
        },
        [TOOL_ARG.NOW]: {
          type: 'string',
          description:
            'for close: "true" only when they said to close it now although it is mid turn',
        },
        title: {
          type: 'string',
          description: 'the card heading, such as the task in a few words',
        },
        text: {
          type: 'string',
          description:
            'for a card: markdown of what happened, read from session, replay and changes. A short heading line, then bullets for what it was asked, what it ran with the outcome, the commits and files it changed, and where it stands now; commands and names in backticks. Facts only, no more than about twenty lines.',
        },
      },
    },
    // It writes a request to draw on the person's screen, which changes nothing an agent can do.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'pause_session',
    description:
      'Pause a session the person asked to pause or hold: its next action waits until they resume it. It only ever holds an agent back, so it happens at once. Pass what they said. Stopping what it is doing now is show with display stop, and closing a window or tab is show with display close, never this. Never pause the session marked notAnAgent.',
    inputSchema: {
      type: 'object',
      properties: { agent: AGENT_ARG, session: SESSION_ARG, said: SAID_ARG },
    },
    // It holds an agent back and lets nothing happen, the same as a refusal.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  ...AGENT_PAUSE_TOOLS,
  proposeTool(
    'propose_instruction',
    'Tell an agent session to do something the person said, such as "push it" or "add a test for the cart". Nothing is sent: it returns an id and the words to read back, so a misheard instruction is caught first. Pass message as a clear instruction to the agent in the person\'s words, with misheard names fixed, like "git push" for "guitar push"; never add work they did not ask for.',
    {
      agent: AGENT_ARG,
      session: SESSION_ARG,
      message: {
        type: 'string',
        description: 'the instruction, as the agent will read it',
      },
      about: {
        type: 'string',
        description:
          'for a hand off, another session id whose changed files are added to the message, like when they say "have Codex review what Claude just changed"',
      },
      work: {
        type: 'string',
        description:
          'the ticket or task from the workspace this is about, by its title or key words, such as "Fix auth token refresh", when they ask an agent to implement, fix or work on one: the ticket, what was said about it and the decisions that bind it are gathered and handed to the agent',
      },
      said: SAID_ARG,
    },
  ),
  {
    name: 'send_instruction',
    description:
      'Send an instruction from propose_instruction, only after the person said yes to it read back. A working session picks it up at its next step; one waiting in a terminal has it typed in; one waiting in an editor gets it in its input for the person to send.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'the id propose_instruction returned',
        },
      },
    },
    // It passes on what the person said; what the agent then does is still ruled as ever.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  ...ACTING_TOOLS,
  ...HEARD_WORD_TOOLS,
  ...PROFILE_TOOLS,
  ...FOLDER_TOOLS,
  ...HANDOVER_TOOLS,
  ...WORKSPACE_ASK_TOOLS,
  ...PERSONAL_TOOLS,
  LOOK_TOOL,
  FORGET_SCREEN_TOOL,
  ANSWER_AGENT_TOOL,
  {
    name: 'answer_question',
    description:
      'Pass the person\'s answer to a question an agent is asking them in its own picker, such as "which database should I use". Their answer is their choice, so it goes at once with no read back and no Touch ID; the agent carries on with it. Pass the option they meant by its label, or their own words when it is none of them.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'the question id, from the notice or waiting',
        },
        answer: {
          type: 'string',
          description: 'the option label they chose, or their own words',
        },
        number: {
          type: 'string',
          description:
            'which question, from 1, when the agent asked several at once; 1 when left out',
        },
      },
    },
    // It passes on the person's own choice; what the agent then does is ruled on as ever.
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  proposeTool(
    'propose_resume',
    'Resume a paused session the person asked to carry on. Nothing restarts until they confirm with Touch ID on the Mac, so say that.',
    { agent: AGENT_ARG, session: SESSION_ARG, said: SAID_ARG },
  ),
  proposeTool(
    'propose_answer',
    'Answer a held call with what the person said. "deny" takes effect at once. "once" and "session" wait for Touch ID on the Mac, so say that the person has to confirm.',
    {
      call: { type: 'string', description: 'the held call id, from "waiting"' },
      answer: { type: 'string', description: 'once, session or deny' },
      said: SAID_ARG,
    },
  ),
  PROPOSE_RULE_TOOL,
];

/** The same reads the session server makes, pointed at whichever agent the person named. */
function asAgent(deps: SessionToolDeps, args: ToolArgs): SessionToolDeps {
  return readingFor(deps, textArg(args, 'agent') ?? DEFAULT_AGENT);
}

const OPERATOR_CALLS: Record<string, OperatorCall> = {
  ...PERSONAL_CALLS,
  status: (deps) => statusTool(deps),
  // The Mac app sees the call in the stream and closes the orb; nothing here has anything to do.
  end_conversation: () => ({ ended: true }),
  // The Mac app sees it too and listens on for longer; the brain says nothing this turn.
  keep_listening: () => ({ listening: true }),
  sessions: (deps, _seams, args) => sessionsTool(deps, args),
  session: (deps, _seams, args) => sessionTool(asAgent(deps, args), args),
  history: (deps, _seams, args) => historyTool(asAgent(deps, args), args),
  reach: (deps) => readReach(deps.home),
  waiting: (deps) => new WaitingFeed(deps.home).current(deps.now().toISOString()),
  cloud_agents: (deps) => readCloudAgents(deps.home),
  unattended: async (deps, _seams, args) =>
    unattendedCheck(
      await readUnattended(deps.home, deps.cwd, textArg(args, 'agent') ?? DEFAULT_AGENT),
    ),
  why: (deps, _seams, args) => whyTool(asAgent(deps, args), args),
  replay: (deps, _seams, args) => replayTool(asAgent(deps, args), args),
  decisions: (deps, _seams, args) => decisionsTool(asAgent(deps, args), args),
  outside: (deps, _seams, args) => outsideTool(asAgent(deps, args), args),
  repository: (deps, _seams, args) => repositoryTool(asAgent(deps, args), args),
  show: (deps, seams, args) => showTool(asAgent(deps, args), seams, args),
  pause_session: (deps, _seams, args) => pauseSessionTool(asAgent(deps, args), args),
  propose_resume: (deps, _seams, args) => proposeResumeTool(asAgent(deps, args), args),
  changes: (deps, seams, args) => changesTool(asAgent(deps, args), seams, args),
  propose_instruction: (deps, seams, args) =>
    proposeInstructionTool(asAgent(deps, args), args, seams),
  watch_for: (deps, _seams, args) => watchForTool(asAgent(deps, args), args),
  show_agents: (deps, _seams, args) => showAgentsTool(deps, args),
  memnox_command: (deps, _seams, args) => memnoxCommandTool(deps, args),
  traces: (deps, _seams, args) => tracesTool(deps, args),
  about: (_deps, _seams, args) => aboutTool(args),
  memory: (deps, _seams, args) => workspaceMemoryTool(deps, args),
  sources: (deps, _seams, args) => sourcesTool(deps, args),
  people: (deps, _seams, args) => peopleTool(deps, args),
  brief: (deps, _seams, args) => briefTool(deps, args),
  command_output: (deps, _seams, args) => commandOutputTool(deps, args),
  walk_through: (deps, seams, args) => walkThroughTool(asAgent(deps, args), seams, args),
  propose_start: (deps, _seams, args) => proposeStartTool(deps, args),
  start_session: (deps, _seams, args) => startSessionTool(deps, args),
  type_in_app: (deps, _seams, args) => typeInAppTool(deps, args),
  control_app: (deps, _seams, args) => controlAppTool(deps, args),
  propose_rewind: (deps, seams, args) =>
    proposeRewindTool(asAgent(deps, args), seams, args),
  send_instruction: (deps, _seams, args) => sendInstructionTool(deps, args),
  propose_answer: (deps, _seams, args) => proposeAnswerTool(deps, args),
  answer_question: (deps, _seams, args) => answerQuestionTool(deps, args),
  propose_rule: (deps, _seams, args) => proposeRuleTool(deps, args),
  ...HEARD_WORD_CALLS,
  ...PROFILE_CALLS,
  ...FOLDER_CALLS,
  ...HANDOVER_CALLS,
  ...WORKSPACE_ASK_CALLS,
  ...LOOK_CALLS,
  ...ANSWER_AGENT_CALLS,
  ...AGENT_PAUSE_CALLS,
};

export async function callOperatorTool(
  deps: SessionToolDeps,
  seams: RewindSeams,
  name: string,
  args: ToolArgs,
): Promise<unknown> {
  const call = Object.hasOwn(OPERATOR_CALLS, name) ? OPERATOR_CALLS[name] : undefined;
  if (call === undefined) return null;
  const held = await heldInGuess(deps.home, name, OPERATOR_TOOLS);
  if (held !== null) return held;
  const startAt = deps.now().toISOString();
  try {
    const answer = await call(deps, seams, args);
    await traceToolCall(deps.home, {
      name,
      startAt,
      endAt: deps.now().toISOString(),
      answer,
    });
    return answer;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await traceToolCall(deps.home, {
      name,
      startAt,
      endAt: deps.now().toISOString(),
      error,
    });
    throw err;
  }
}

const ABOUT_OPERATOR =
  'You are the voice of Memnox, speaking with the person who runs these agents. Answer out loud: short sentences, the answer first, numbers said plainly, never a list read aloud. Read the machine through these tools before you answer, and never guess. What an agent changed is in changes, with the lines of one file when you pass its path; what it reached outside this machine is in outside. Several sessions can be open at once, even for one agent: call sessions first, pass the session id to every other tool, and when the person did not say which, take the one they last wrote to, its spokenToAt, and say so. When the person answers a held call or asks for a rule, in whatever words, call propose_answer or propose_rule. When they want an agent to do something, call propose_instruction, read it back, and send_instruction only after their yes. You can never allow anything yourself: every allow waits for the person to confirm with Touch ID on the Mac, so tell them that.';

export const OPERATOR_CATALOGUE: ToolCatalogue = {
  info: { name: 'memnox-operator', version: '1' },
  tools: OPERATOR_TOOLS,
  call: callOperatorTool,
  instructions: async () => ABOUT_OPERATOR,
};

import {
  Clashes,
  HANDOVER_ANSWER,
  Handovers,
  minutesToMs,
  PERSON_MESSAGE_KIND,
  PersonMessages,
  wantedPart,
  type Clash,
  type HandoverAnswer,
} from '@memnox/core';
import { answerAsk, askForLines } from '../sync/handover';
import { answerPerson, sendToPerson, type MessageTo } from '../sync/person-message';
import { sharedWorkOf } from '../sync/shared-work';
import { SAID_ARG } from './operator-args';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * Two people settling things through their voices: asking the owner of another machine for the
 * lines its agent holds, answering such an ask, and speaking to a teammate about anything.
 * Coordination between people rather than a change to any rule, so each acts at once.
 */

/** A hold older than this is not the one the person is talking about. */
const RECENT_CLASH_MS = minutesToMs(30);

const ANSWERS: readonly string[] = Object.values(HANDOVER_ANSWER);

export const HANDOVER_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'ask_for_lines',
    description:
      'Ask the owner of another machine for the lines their agent is writing, after the person\'s own agent was held off them, which you will have just told them as a collision. Sent in the person\'s name with what they said, like "ask Ana if I can have it" or "ask him how long he needs". Their voice reads it to them at once and their answer comes back to you as news to tell. Use it as soon as the person asks for it, with no read back. Only for a hold by another machine: a hold on this machine is between the person\'s own agents.',
    inputSchema: {
      type: 'object',
      properties: {
        said: {
          type: 'string',
          description:
            'what the person wants the other owner to hear, in their words; leave out to just ask',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'answer_ask_for_lines',
    description:
      "Answer the ask another person sent for lines the person's own agent is writing, which you will have just read to them. give hands the lines to the asker's agent on the record, so its next write goes through and the person's own agent is refused there from now on; wait asks the asker to wait some minutes; keep keeps them. Pass what the person said so the asker hears it. Do it as soon as they answer, with no read back.",
    inputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'give, wait or keep' },
        minutes: {
          type: 'string',
          description: 'on a wait, how many minutes they asked for',
        },
        said: SAID_ARG,
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'message_person',
    description:
      'Say something to a teammate in this workspace on their own computer, where their voice says it at once: "tell Ana I am done with billing", "ask Andre whether he is still in the payments service". Sent in the person\'s name with their words. Leave to out when they mean whoever\'s agent their own agent was just held off, like "ask them how long they need". Use it as soon as they ask, with no read back. An answer comes back to you as news to tell.',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            "the teammate's name as they said it; leave out for whoever holds the lines",
        },
        said: {
          type: 'string',
          description: "what the teammate will hear, in the person's words",
        },
        ask: {
          type: 'string',
          description: '"true" when it is a question that wants an answer',
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'team_work',
    description:
      "The features the person's agents are working on with other people's, as the workspace found them from their tickets and branches: who is on each, what every agent is doing now, and what the agents said to each other. Use it when they ask who they are working with, what a teammate's agent is doing, or what the agents agreed.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'answer_person',
    description:
      'Answer what a teammate just said to the person, which you will have just read to them, with what the person says back. Do it as soon as they answer, with no read back.',
    inputSchema: {
      type: 'object',
      properties: {
        said: { type: 'string', description: 'their answer, in their words' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

export const HANDOVER_CALLS: Readonly<Record<string, OperatorCall>> = {
  ask_for_lines: (deps, _seams, args) => askTool(deps, args),
  answer_ask_for_lines: (deps, _seams, args) => answerTool(deps, args),
  message_person: (deps, _seams, args) => messageTool(deps, args),
  team_work: (deps) => teamWorkTool(deps),
  answer_person: (deps, _seams, args) => answerPersonTool(deps, args),
};

async function askTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const clash = await latestHeldElsewhere(deps);
  if (clash === null) {
    return {
      asked: false,
      said: 'No agent of theirs was held off by another machine lately, so there is nobody to ask. Say so in a sentence.',
    };
  }
  const sent = await askForLines(deps.home, clash, textArg(args, 'said'));
  return {
    asked: sent.ok,
    what: clash.what,
    said: sent.ok
      ? `Asked for ${clash.what}. Say in a few words that you asked and will tell them the answer.`
      : `${sent.said} Say that plainly, and never say you asked.`,
  };
}

async function answerTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const answer = textArg(args, 'answer');
  if (answer === undefined || !ANSWERS.includes(answer)) {
    return {
      answered: false,
      said: 'Ask them whether to give it, ask for a wait, or keep it.',
    };
  }
  const handovers = new Handovers(deps.home);
  const moment = deps.now().toISOString();
  const ask = (await handovers.open(moment)).at(-1);
  if (ask === undefined) {
    return {
      answered: false,
      said: 'Nobody is waiting on an answer from them about their lines. Say so in a sentence.',
    };
  }
  const minutes = Number(textArg(args, 'minutes'));
  const said = textArg(args, 'said');
  const sent = await answerAsk(deps.home, ask, {
    // Checked against ANSWERS just above, which are the union's own values.
    answer: answer as HandoverAnswer,
    ...(Number.isFinite(minutes) && minutes > 0 ? { minutes } : {}),
    ...(said === undefined ? {} : { said }),
  });
  if (!sent.ok) {
    return {
      answered: false,
      said: `${sent.said} Say that plainly, and never say it was sent.`,
    };
  }
  await handovers.answered(ask, moment);
  return {
    answered: true,
    said: `Told ${ask.fromName} about ${wantedPart(ask)}. Say so in a few words.`,
  };
}

async function messageTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const said = textArg(args, 'said');
  if (said === undefined) {
    return { sent: false, said: 'Ask them what to say.' };
  }
  const named = textArg(args, 'to');
  const clash = named === undefined ? await latestHeldElsewhere(deps) : null;
  const to: MessageTo | null =
    named !== undefined
      ? { person: named }
      : clash !== null && clash.leaseId !== undefined
        ? { leaseId: clash.leaseId }
        : null;
  if (to === null) {
    return {
      sent: false,
      said: 'Ask them who it is for: no agent of theirs was held off another machine lately.',
    };
  }
  const kind =
    textArg(args, 'ask') === 'true' ? PERSON_MESSAGE_KIND.ASK : PERSON_MESSAGE_KIND.TELL;
  const sent = await sendToPerson(deps.home, to, { kind, said });
  return {
    sent: sent.ok,
    said: sent.ok
      ? 'Sent. Say in a few words that their voice is telling them now.'
      : `${sent.said} Say that plainly, and never say it was sent.`,
  };
}

async function teamWorkTool(deps: SessionToolDeps): Promise<unknown> {
  const read = await sharedWorkOf(deps.home);
  if (!read.ok) return { said: `${read.said} Say that plainly.` };
  if (read.features.length === 0) {
    return {
      features: [],
      said: "None of their agents is working on a feature with anybody else's right now. Say so in a sentence.",
    };
  }
  return {
    features: read.features,
    said: 'Say, for each feature, who else is on it and what their agent is doing, in a sentence or two; mention what the agents agreed only when asked.',
  };
}

async function answerPersonTool(deps: SessionToolDeps, args: ToolArgs): Promise<unknown> {
  const said = textArg(args, 'said');
  if (said === undefined) return { answered: false, said: 'Ask them what to say back.' };
  const messages = new PersonMessages(deps.home);
  const moment = deps.now().toISOString();
  const heard = await messages.latestOpen(moment);
  if (heard === null) {
    return {
      answered: false,
      said: 'Nobody is waiting on an answer from them. Say so in a sentence.',
    };
  }
  const sent = await answerPerson(deps.home, heard, said);
  if (!sent.ok) {
    return {
      answered: false,
      said: `${sent.said} Say that plainly, and never say it was sent.`,
    };
  }
  await messages.answered(heard, moment);
  return { answered: true, said: `Told ${heard.fromName}. Say so in a few words.` };
}

/** The newest hold on another machine's lease, which is the one the person is talking about. */
async function latestHeldElsewhere(deps: SessionToolDeps): Promise<Clash | null> {
  const now = deps.now();
  const since = new Date(now.getTime() - RECENT_CLASH_MS).toISOString();
  const recent = await new Clashes(deps.home).since(since, now.toISOString());
  return recent.filter((clash) => clash.leaseId !== undefined).at(-1) ?? null;
}

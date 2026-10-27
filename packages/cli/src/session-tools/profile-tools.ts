import { forgetFacts, keepFact, PROFILE_TOPIC, topicOf } from '../operator/profile';
import type { OperatorCall } from './operator-call';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * The voice getting to know the person it works for: what they told it about their work, their
 * projects, their tools and how they want to be spoken to, kept so every conversation starts there.
 */

// Each writes one small file in the person's own home, which changes nothing an agent can do.
const LOCAL_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const PROFILE_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'remember_about_me',
    description: `Keep one thing the person told you about themselves, so every conversation starts knowing it: what they work on, the projects and repositories that matter to them, the tools they use, such as Linear, Jira, GitHub or Slack, or how they want to be spoken to. Call it when they tell you, or answer one of your getting to know you questions, or ask you to remember something about them. One fact per call, in their words, as a short sentence about them, like "leads the payments team" or "wants answers short, with the number first". Never keep a guess, and never keep anything about somebody else. topic is one of ${Object.values(PROFILE_TOPIC).join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: `one of ${Object.values(PROFILE_TOPIC).join(', ')}`,
        },
        fact: { type: 'string', description: 'one short sentence, in their words' },
      },
    },
    annotations: LOCAL_WRITE,
  },
  {
    name: 'forget_about_me',
    description:
      'Forget what you kept about the person, when they say it is wrong or ask you to forget it: every fact holding the words given is taken away.',
    inputSchema: {
      type: 'object',
      properties: {
        words: { type: 'string', description: 'words from the fact to forget' },
      },
    },
    annotations: LOCAL_WRITE,
  },
];

/** Said after keeping a fact, so nothing is ever written about them without them hearing it. */
const KEPT =
  'Kept. Say in a few words exactly what you kept, like "Noted: you lead the payments team.", then carry on.';
const NOT_KEPT =
  'Nothing kept: there was no fact in it. Ask them to say it again in a sentence.';
const FORGOTTEN =
  'Say in a few words what you forgot, like "Forgotten: the payments team."';
const NONE_FORGOTTEN =
  'Nothing you kept holds those words. Say so in a few words, and ask what to forget.';

export const PROFILE_CALLS: Readonly<Record<string, OperatorCall>> = {
  remember_about_me: (deps, _seams, args) => rememberAboutMeTool(deps, args),
  forget_about_me: (deps, _seams, args) => forgetAboutMeTool(deps, args),
};

async function rememberAboutMeTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const kept = await keepFact(
    deps.home,
    topicOf(textArg(args, 'topic')),
    textArg(args, 'fact') ?? '',
    deps.now().toISOString(),
  );
  return kept === null
    ? { remembered: false, said: NOT_KEPT }
    : { remembered: true, ...kept, said: KEPT };
}

async function forgetAboutMeTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const gone = await forgetFacts(deps.home, textArg(args, 'words') ?? '');
  return gone.length === 0
    ? { forgotten: [], said: NONE_FORGOTTEN }
    : { forgotten: gone.map((each) => each.fact), said: FORGOTTEN };
}

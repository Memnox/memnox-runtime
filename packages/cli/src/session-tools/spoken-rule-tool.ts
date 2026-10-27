import { namedList, proposeSpokenRule, spokenRuleSentence } from '../protect/spoken-rule';
import { proposeTool, SAID_ARG } from './operator-args';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * propose_rule given the person's own sentence. No model is called from here: the voice is
 * already their agent CLI, so where the grammar cannot read the sentence the voice passes the
 * action and effect itself, and the same card and Touch ID follow.
 */
export async function proposeSpokenRuleTool(
  deps: SessionToolDeps,
  sentence: string,
  args: ToolArgs,
): Promise<unknown> {
  const answer = await proposeSpokenRule(sentence, namedList(textArg(args, 'approved')), {
    home: deps.home,
    env: deps.env,
    at: deps.now().toISOString(),
  });
  if ('refused' in answer) {
    return {
      refused: answer.refused,
      said: `${answer.refused} Or call propose_rule with the action and the effect yourself.`,
    };
  }
  return {
    ...(answer.proposed === undefined ? {} : { proposed: answer.proposed }),
    rule: answer.draft,
    readBack: answer.readBack,
    openQuestions: answer.openQuestions,
    offeredToTeam: answer.offeredToTeam,
    said: spokenRuleSentence(answer),
  };
}

/** The rule tool the voice is given, its own words first and the fields only where those are refused. */
export const PROPOSE_RULE_TOOL: ToolDefinition = proposeTool(
  'propose_rule',
  'Write down a rule the person asked for. Pass their words as sentence first: it is read into the rule, with any destinations, kinds of data, paths, databases or agents it names, and the result says it back, or asks what it left open, such as which destinations are approved; ask that, then call again with the same sentence and approved. Only when the sentence is refused, pass action and effect yourself, optionally only on some branches or paths. Nothing is in force until they confirm with Touch ID, and on a machine in a team it then also goes to the team, where a second admin approves it.',
  {
    sentence: {
      type: 'string',
      description:
        'the rule in the person\'s own words, such as "never let an agent send customer records to an unapproved destination"',
    },
    approved: {
      type: 'string',
      description:
        'the destinations the person named as approved when asked, comma separated, such as "api.stripe.com, ourcompany.com"',
    },
    action: {
      type: 'string',
      description:
        'a command such as "railway deploy", or a verb such as "npm.publish" or "filesystem.read"',
    },
    effect: { type: 'string', description: 'allow, ask or deny' },
    reason: { type: 'string', description: 'why, as the person put it' },
    branches: {
      type: 'string',
      description: 'only on these branches, comma separated, such as "main, release/*"',
    },
    paths: {
      type: 'string',
      description:
        'only for these files or folders, comma separated globs, such as "*.env, secrets/*"',
    },
    project: {
      type: 'string',
      description:
        'the repository they named, by folder name or full path; leave it out when they named none, and the whole Mac is suggested',
    },
    said: SAID_ARG,
  },
);

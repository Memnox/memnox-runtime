import {
  minutesToMs,
  policyOfSpokenRule,
  PROPOSAL_KIND,
  Proposals,
  readAccount,
  readBackOfSpokenRule,
  readRuleSentence,
  resolveAction,
  RULE_DRAFTED_BY,
  spokenRuleProblems,
  withApprovedDestinations,
  type SpokenRuleAnswer,
  type SpokenRuleReading,
} from '@memnox/core';
import { draftInCloud, type CloudCall } from '../sync/rule-draft-cloud';
import { machinePolicyPath } from './machine-rules';
import { machineScope } from './rule-scope';

/**
 * A rule a person said, drafted by the enrolled workspace (whose plan decides if a model reads it) or by
 * this machine's grammar, read back, proposed once nothing is open, then in force here and offered to the team.
 */

/** Who the ledger names as having proposed it, as every other rule card names it. */
const PROPOSED_BY = 'agt_memnox-operator';

/** As long as any other rule card waits for its signature. */
const CARD_TTL_MS = minutesToMs(5);

/** Said when neither the grammar nor a model could read it, with the shapes the grammar knows. */
const NOT_READ =
  'That was not read as a rule. Say it as never, ask me before, or let, then what an agent does, such as "never push to main".';

/** Why nothing was drafted, and whether the workspace's plan is why. */
interface SpokenRuleRefusal {
  refused: string;
  upgrade?: true;
}

interface SpokenRuleSeams {
  home: string;
  env: NodeJS.ProcessEnv;
  at: string;
  /** How the workspace is called; the real one unless a test hands in another. */
  cloud?: CloudCall;
}

/** The sentence drafted, or why it could not be. */
async function draftSpokenRule(
  sentence: string,
  approved: readonly string[],
  seams: Pick<SpokenRuleSeams, 'env' | 'home' | 'cloud'>,
): Promise<Omit<SpokenRuleAnswer, 'offeredToTeam'> | SpokenRuleRefusal> {
  const cloud = await draftInCloud(seams.home, sentence, seams.cloud);
  if (cloud !== null && 'refused' in cloud)
    return {
      refused: cloud.refused,
      ...(cloud.upgrade === true ? { upgrade: true } : {}),
    };
  const read =
    cloud === null
      ? readRuleSentence(sentence, (command) => actionOf(command, seams.env))
      : cloud.drafted;
  if (read === undefined) return { refused: NOT_READ };
  const reading: SpokenRuleReading = withApprovedDestinations(read, approved);
  const problems = spokenRuleProblems(reading.draft);
  if (problems.length > 0)
    return { refused: `The rule would not load: ${problems.join('; ')}` };
  return {
    draft: reading.draft,
    readBack: readBackOfSpokenRule(reading.draft),
    openQuestions: reading.openQuestions,
    draftedBy: cloud === null ? RULE_DRAFTED_BY.PATTERN : cloud.draftedBy,
    ...(cloud?.note === undefined ? {} : { note: cloud.note }),
  };
}

/**
 * Drafted and, with nothing left to ask, proposed on the Mac for Touch ID or on the phone for
 * Face ID. Nothing is written here: the rule is in force only once the person signs it.
 */
export async function proposeSpokenRule(
  sentence: string,
  approved: readonly string[],
  seams: SpokenRuleSeams,
): Promise<SpokenRuleAnswer | SpokenRuleRefusal> {
  const drafted = await draftSpokenRule(sentence, approved, seams);
  if ('refused' in drafted) return drafted;
  const offeredToTeam = (await readAccount(seams.home)) !== null;
  if (drafted.openQuestions.length > 0) return { ...drafted, offeredToTeam };
  const proposal = await new Proposals(seams.home).propose({
    change: {
      kind: PROPOSAL_KIND.RULES,
      file: machinePolicyPath(seams.home),
      rules: [policyOfSpokenRule(drafted.draft)],
      scopes: [machineScope(true)],
      ...(offeredToTeam ? { offerTeam: true } : {}),
    },
    rationale: drafted.readBack,
    said: sentence,
    proposedBy: PROPOSED_BY,
    at: seams.at,
    ttlMs: CARD_TTL_MS,
  });
  return { ...drafted, proposed: proposal.id, offeredToTeam };
}

/** What to say once it is drafted: the open questions, or the read back and what signing does. */
export function spokenRuleSentence(answer: SpokenRuleAnswer): string {
  if (answer.openQuestions.length > 0)
    return `Drafted as: ${answer.readBack} Ask them first: ${answer.openQuestions.join(' ')} Nothing is proposed until they answer.`;
  const team = answer.offeredToTeam
    ? ' Once they confirm it also goes to the team as a proposal, and it becomes a team rule only when a second admin approves it.'
    : '';
  return `Read it back: ${answer.readBack} It holds on this machine from the next action once they confirm with Touch ID or Face ID, and not before.${team}`;
}

/** A comma separated list of what the person named, as its parts. */
export function namedList(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\s*(?:,|\band\b|\bor\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** `terraform apply` as the engine names it, so the rule matches what the seam reports. */
function actionOf(command: string, env: NodeJS.ProcessEnv): string {
  const [binary = command, ...rest] = command.split(/\s+/);
  return resolveAction(binary, rest, env).action;
}

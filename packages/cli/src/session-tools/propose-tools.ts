import { statSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import {
  DECISION_EFFECT,
  HOLD_ANSWER,
  minutesToMs,
  readAccount,
  PendingApprovals,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  resolveAction,
  type HoldAnswer,
  type PendingApproval,
  type Policy,
  type RuleScope,
  type TeamCallBrief,
} from '@memnox/core';
import { recordAnswer } from '../daemon/record-answer';
import { readRegisteredFiles } from '../policy-path';
import { WRITTEN_POLICY_FILE } from '../protect/merge-rules';
import {
  fileForScope,
  machineScope,
  repositoryScope,
  scopeAnswered,
  teamScope,
} from '../protect/rule-scope';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { knownRepositories, repositoryNamed } from './known-repositories';
import { teamCallsNow } from '../daemon/team-calls-store';
import { proposeSpokenRuleTool } from './spoken-rule-tool';

/**
 * What the operator may do with what a person said: write it down as a proposal. A refusal
 * of a held call is the one exception, answered at once, because saying no can do no harm.
 * Everything that lets something happen waits for Touch ID in the Mac app.
 */

/** Who the ledger names as having proposed it, so `why` says a model wrote the words. */
export const OPERATOR_AGENT = 'agt_memnox-operator';

/** Long enough to hear the question and reach for the key, short enough that nobody confirms a stale one. */
const RULE_PROPOSAL_TTL_MS = minutesToMs(5);

const SPOKEN_ANSWERS: readonly string[] = [
  HOLD_ANSWER.ONCE,
  HOLD_ANSWER.SESSION,
  HOLD_ANSWER.DENY,
];

/** Who the ledger says refused, since the operator only passed on what the person said. */
export const BY_VOICE = 'person (voice)';

const RULE_EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);

/** As many repositories as the card offers beside the whole Mac, before it becomes a list to scroll. */
const OFFERED_REPOSITORIES = 5;

/** A held call answered from what the person said, in whatever words they said it. */
export async function proposeAnswerTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const call = textArg(args, 'call');
  const answer = textArg(args, 'answer');
  const said = textArg(args, 'said') ?? '';
  if (call === undefined || answer === undefined || !SPOKEN_ANSWERS.includes(answer)) {
    return { refused: `name the held call and one of: ${SPOKEN_ANSWERS.join(', ')}` };
  }
  const moment = deps.now().toISOString();
  const pending = await new PendingApprovals(deps.home).read(call);
  // Not held here, so it may be a team's question the asking device named.
  const team = pending === null ? await teamCallOf(deps, call, moment) : undefined;
  if (team !== undefined)
    return proposeTeamAnswer(deps, team, answer as HoldAnswer, said);
  if (pending === null || pending.answer !== undefined || pending.expiresAt <= moment) {
    return { refused: `${call} is no longer waiting on anybody` };
  }
  if (answer === HOLD_ANSWER.DENY) return refuseHeld(deps, pending, { said, moment });
  // Narrowed by the membership check above.
  return proposeAllow(deps, pending, answer as HoldAnswer, said);
}

/** A no needs nobody's signature, so it is answered at once and written down as the person's. */
async function refuseHeld(
  deps: SessionToolDeps,
  pending: PendingApproval,
  { said, moment }: { said: string; moment: string },
): Promise<unknown> {
  await new PendingApprovals(deps.home).answer(
    pending.id,
    HOLD_ANSWER.DENY,
    BY_VOICE,
    moment,
  );
  await recordAnswer(deps.home, {
    request: pending.request,
    answer: HOLD_ANSWER.DENY,
    by: BY_VOICE,
    ...(said === '' ? {} : { said }),
    at: moment,
  });
  return {
    answered: pending.id,
    answer: HOLD_ANSWER.DENY,
    said: `Refused. ${pending.request.agent} has been told.`,
  };
}

async function teamCallOf(
  deps: SessionToolDeps,
  call: string,
  moment: string,
): Promise<TeamCallBrief | undefined> {
  return (await teamCallsNow(deps.home, moment)).find((each) => each.id === call);
}

/** How long a team answer waits for the device to carry it out; the question itself may expire sooner. */
const TEAM_ANSWER_TTL_MS = 5 * 60_000;

/**
 * A team's question is answered by the device that asked, since only it holds the person's sign in:
 * a yes there takes Face ID or Touch ID and is signed, a no goes as it is. This only writes it down.
 */
async function proposeTeamAnswer(
  deps: SessionToolDeps,
  team: TeamCallBrief,
  answer: HoldAnswer,
  said: string,
): Promise<unknown> {
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.TEAM, callId: team.id, answer, label: team.label },
    rationale: said === '' ? `${answer} for ${team.label}` : said,
    ...(said === '' ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: TEAM_ANSWER_TTL_MS,
  });
  return {
    proposed: proposal.id,
    said:
      answer === HOLD_ANSWER.DENY
        ? `Sending your no to ${team.label}.`
        : 'Waiting for Face ID or Touch ID on the device you asked from. Nothing is allowed until then.',
  };
}

/** An allow is only ever written down, and never outlives the call it answers. */
async function proposeAllow(
  deps: SessionToolDeps,
  pending: PendingApproval,
  answer: HoldAnswer,
  said: string,
): Promise<unknown> {
  const moment = deps.now().toISOString();
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.ANSWER, pendingId: pending.id, answer },
    rationale: said === '' ? `${answer} for ${pending.id}` : said,
    ...(said === '' ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: moment,
    ttlMs: Date.parse(pending.expiresAt) - Date.parse(moment),
  });
  return {
    proposed: proposal.id,
    said: 'Waiting for Touch ID. Nothing is allowed until the person confirms on the Mac.',
  };
}

/**
 * A rule the person asked for, written down for them to confirm and never written to the file here.
 * It carries the places it could hold, the whole Mac and the repositories they work in, and the Mac
 * puts them on a card: the one they pick is the answer Touch ID signs, so nobody but them chooses its reach.
 */
export async function proposeRuleTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const action = textArg(args, 'action');
  const sentence = textArg(args, 'sentence');
  // Their own words go through the grammar, which reads targets, kinds of data and exclusions too.
  if (action === undefined && sentence !== undefined)
    return proposeSpokenRuleTool(deps, sentence, args);
  const effect = textArg(args, 'effect');
  const reason = textArg(args, 'reason');
  if (action === undefined || effect === undefined || !RULE_EFFECTS.includes(effect)) {
    return { refused: `name an action and one of: ${RULE_EFFECTS.join(', ')}` };
  }
  const named = await repositoryFor(deps, textArg(args, 'project'));
  if (typeof named === 'object' && named !== null) return named;
  const offered = await offeredRepositories(deps, named);
  const scopes = await placesFor(deps.home, named, offered);
  // The machine is always first and suggested when no repository was named, so one is always found.
  const suggested =
    scopeAnswered(scopes, PROPOSAL_ANSWER.CONFIRMED) ?? machineScope(true);
  const file = fileForScope(deps.home, suggested);
  const verb = verbOf(action, deps.env);
  const branches = listArg(args, 'branches');
  const targets = listArg(args, 'paths');
  const rule = ruleFrom(args, { effect, verb, branches, targets, reason });
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.RULES, file, rules: [rule], scopes },
    rationale: ruleSummary(effect, verb, branches, targets),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: RULE_PROPOSAL_TTL_MS,
  });
  return {
    proposed: proposal.id,
    rule: { name: rule.name, action: verb, effect, file, branches, targets },
    places: scopes.map((scope) => scope.label),
    said: `The rule is on a card on the Mac with where it could hold, ${suggested.label} picked for now. Ask in one short sentence whether it should hold on the whole Mac or only in ${offered[0] === undefined ? 'one repository' : basename(named ?? offered[0])}; they pick on the card and confirm with Touch ID. It is not in force until they do.`,
  };
}

/** Where a rule could hold: the whole Mac, the repositories offered, and the team where there is one. */
async function placesFor(
  home: string,
  named: string | null,
  offered: readonly string[],
): Promise<RuleScope[]> {
  return [
    machineScope(named === null),
    ...offered.map((folder, index) => repositoryScope(folder, index, folder === named)),
    // Only where there is a team to offer it to, and never suggested: it reaches every agent the workspace runs.
    ...((await readAccount(home)) === null ? [] : [teamScope()]),
  ];
}

/** What a spoken rule decides, read from the tool's arguments once they were checked. */
interface RuleParts {
  effect: string;
  verb: string;
  branches: readonly string[];
  targets: readonly string[];
  reason: string | undefined;
}

/** The rule itself, matching only the branches and paths named, when any were. */
function ruleFrom(args: ToolArgs, parts: RuleParts): Policy {
  const { effect, verb, branches, targets, reason } = parts;
  // The effect was checked against the engine's own list before this is called.
  return {
    name: ruleName(effect, verb, [...branches, ...targets]),
    description: textArg(args, 'said') ?? `asked for by voice: ${effect} ${verb}`,
    match: {
      actions: [verb],
      ...(branches.length > 0 ? { branches: [...branches] } : {}),
      ...(targets.length > 0 ? { targets: [...targets] } : {}),
    },
    decision: { effect, reason: reason ?? `the person asked to ${effect} ${verb}` },
  } as Policy;
}

/** A name unique to what the rule matches, so a second rule for another branch never replaces the first. */
function ruleName(effect: string, verb: string, narrowing: readonly string[]): string {
  return ['voice', effect, verb, ...narrowing]
    .join('-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** The rule in the words the card and the ledger show: "deny git.push on main". */
function ruleSummary(
  effect: string,
  verb: string,
  branches: readonly string[],
  targets: readonly string[],
): string {
  const on = branches.length > 0 ? ` on ${branches.join(', ')}` : '';
  const to = targets.length > 0 ? ` touching ${targets.join(', ')}` : '';
  return `${effect} ${verb}${on}${to}`;
}

/** A comma separated argument as its parts, since a model passes "main, release/*" as one string. */
function listArg(args: ToolArgs, name: string): string[] {
  return (textArg(args, name) ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The repository named, by full path, by the folder of a rule file already registered, or by
 * how its name sounds; null when none was named, and refused when the name fits nothing.
 */
async function repositoryFor(
  deps: SessionToolDeps,
  project?: string,
): Promise<string | null | { refused: string }> {
  if (project === undefined) return null;
  if (isAbsolute(project)) {
    // Refused now rather than after the Touch ID, and never created: a misheard path is not a project.
    return isDirectory(project)
      ? project
      : { refused: `${project} is not a folder on this Mac` };
  }
  const written = await writtenFolders(deps.home);
  const byFolder = written.filter(
    (folder) => basename(folder).toLowerCase() === project.toLowerCase(),
  );
  const [only] = byFolder;
  if (byFolder.length === 1 && only !== undefined) return only;
  const heard = repositoryNamed(project, await knownRepositories(deps));
  if (heard !== null) return heard;
  const projects = written.map((folder) => basename(folder));
  return {
    refused:
      projects.length === 0
        ? `no repository sounds like ${project}, so name it by its full path or leave it out to offer the whole Mac`
        : `name one project: ${projects.join(', ')}`,
  };
}

/** The named repository first, then those with rules already, then the rest they work in, a handful at most. */
async function offeredRepositories(
  deps: SessionToolDeps,
  named: string | null,
): Promise<string[]> {
  const ordered = [
    ...(named === null ? [] : [named]),
    ...(await writtenFolders(deps.home)),
    ...(await knownRepositories(deps)),
  ];
  return [...new Set(ordered)].slice(0, OFFERED_REPOSITORIES);
}

/** The folders of the repository rule files already registered, as full paths. */
async function writtenFolders(home: string): Promise<string[]> {
  return (await readRegisteredFiles(home))
    .filter((file) => basename(file) === WRITTEN_POLICY_FILE && isAbsolute(file))
    .map((file) => dirname(file));
}

/** `railway deploy` as the engine names it; an already namespaced verb as it is. */
function verbOf(action: string, env: NodeJS.ProcessEnv): string {
  if (!action.includes(' ') && action.includes('.')) return action;
  const [binary = action, ...rest] = action.split(/\s+/);
  return resolveAction(binary, rest, env).action;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    // Missing or unreadable, which is the same answer: there is no project here to write into.
    return false;
  }
}

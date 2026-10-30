import {
  DECISION_EFFECT,
  minutesToMs,
  policyOfRuleDraft,
  PROPOSAL_KIND,
  Proposals,
  readAccount,
  readBackOfRuleDraft,
  readPolicyDocumentFile,
  ruleDraftProblems,
  rulePackToml,
  rulesOfPack,
  sentenceOfRule,
  writePolicyDocumentFile,
  type Policy,
  type RuleDraft,
  type RuleDraftInput,
} from '@memnox/core';
import {
  fileForScope,
  machineScope,
  machineScopeIn,
  repositoryScope,
  scopedRules,
} from '../protect/rule-scope';
import { editableRule, editableRules } from './rules-in-force';

/**
 * The Policy Studio's writes. Anything that widens what agents may do is a proposal the person
 * signs before it holds; taking a person's own allow away narrows, so it is done at once.
 */

/** Who the ledger names as having proposed it, as the hub names itself on its own cards. */
const PROPOSED_BY = 'agt_memnox-studio';

/** As long as any other rule card waits for its signature. */
const CARD_TTL_MS = minutesToMs(5);

type Changed<T> = { refused: string } | T;

/** The draft held to the validator and proposed for this machine; nothing holds until it is signed. */
export async function proposeRuleDraft(
  home: string,
  draft: RuleDraftInput,
  at: string,
): Promise<Changed<{ proposed: string; read: RuleDraft }>> {
  const problems = ruleDraftProblems(draft);
  if (problems.length > 0)
    return { refused: `The rule would not load: ${problems.join('; ')}` };
  const summary = readBackOfRuleDraft(draft);
  const scopes = [machineScope(true)];
  const offerTeam = (await readAccount(home)) !== null;
  const rule = policyOfRuleDraft(draft);
  const proposed = await proposeRules(home, [rule], { summary, at, offerTeam });
  return { proposed, read: { ...draft, summary, scopes } };
}

/** A rule learned from the person's notes, proposed for this machine only and holding once signed. */
export async function proposeLearnedRule(
  home: string,
  rule: Policy,
  at: string,
): Promise<Changed<{ proposed: string }>> {
  const problems = ruleDraftProblems({
    effect: rule.decision.effect,
    action: rule.match.actions[0] ?? '',
    reason: rule.decision.reason ?? '',
  });
  if (problems.length > 0)
    return { refused: `The rule would not load: ${problems.join('; ')}` };
  // Never offered to the team: it was read from one person's own notes.
  const summary = sentenceOfRule(rule);
  return {
    proposed: await proposeRules(home, [rule], { summary, at, offerTeam: false }),
  };
}

/** An allow taken away at once; a deny or an ask taken away only once the person signs it. */
export async function removeRule(
  home: string,
  name: string,
  at: string,
): Promise<Changed<{ removed: true } | { proposed: string }>> {
  const found = await editableRule(home, name);
  if (found === null)
    return { refused: `${name} is not a rule a person added on this machine.` };
  if (found.rule.decision.effect === DECISION_EFFECT.ALLOW) {
    await withoutRule(found.file, name);
    return { removed: true };
  }
  const proposal = await new Proposals(home).propose({
    change: { kind: PROPOSAL_KIND.RULE_REMOVE, file: found.file, rule: name },
    rationale: `Stop applying: ${sentenceOfRule(found.rule)}`,
    proposedBy: PROPOSED_BY,
    at,
    ttlMs: CARD_TTL_MS,
  });
  return { proposed: proposal.id };
}

/** Takes one rule out of its file by name, the rest of the file as it was. */
export async function withoutRule(file: string, name: string): Promise<boolean> {
  const document = await readPolicyDocumentFile(file);
  if (document === null || !document.policies.some((each) => each.name === name))
    return false;
  await writePolicyDocumentFile(file, {
    ...document,
    policies: document.policies.filter((each) => each.name !== name),
  });
  return true;
}

export async function exportRules(home: string): Promise<string> {
  return rulePackToml(await editableRules(home));
}

/**
 * Every rule in the pack as its own proposal, so each is read and signed and none arrives silently.
 * Given a repository, each holds only inside it, kept in this Mac's own file so the checkout stays clean.
 */
export async function importPack(
  home: string,
  toml: string,
  at: string,
  repository?: string,
): Promise<Changed<{ proposed: string[] }>> {
  const read = rulesOfPack(toml);
  if ('problems' in read)
    return { refused: `The pack would not load: ${read.problems.join('; ')}` };
  const proposed: string[] = [];
  for (const rule of read.rules) {
    // Never offered to the team: a pack is somebody else's rules, taken onto this machine only.
    const summary = sentenceOfRule(rule);
    proposed.push(
      await proposeRules(home, [rule], {
        summary,
        at,
        offerTeam: false,
        ...(repository === undefined ? {} : { repository }),
      }),
    );
  }
  return { proposed };
}

interface Proposing {
  summary: string;
  at: string;
  offerTeam: boolean;
  /** The one folder the rules hold in; absent is the whole machine. */
  repository?: string;
}

async function proposeRules(
  home: string,
  rules: readonly Policy[],
  { summary, at, offerTeam, repository }: Proposing,
): Promise<string> {
  // The only place offered, and the rules narrowed before they are signed, so a plain yes can never put them machine wide.
  const scope =
    repository === undefined ? machineScope(true) : machineScopeIn(repository);
  const held =
    repository === undefined
      ? [...rules]
      : scopedRules(rules, repositoryScope(repository, 0, true));
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.RULES,
      file: fileForScope(home, scope),
      rules: held,
      scopes: [scope],
      ...(offerTeam ? { offerTeam: true } : {}),
    },
    rationale: summary,
    proposedBy: PROPOSED_BY,
    at,
    ttlMs: CARD_TTL_MS,
  });
  return proposal.id;
}

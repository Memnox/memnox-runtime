import { existsSync } from 'node:fs';
import {
  DECISION_EFFECT,
  describeAllowance,
  describeOverlay,
  EarnedAllowances,
  FileAllowances,
  inForce,
  inForceAt,
  loadPoliciesFromFile,
  orgPolicyPathFor,
  OVERLAY_KIND,
  overlaysInForce,
  PolicyValidationError,
  RULE_SOURCE,
  sentenceOfRule,
  AGENT_SUBJECT_PREFIX,
  type Allowance,
  type Overlay,
  type Policy,
  type PolicyLoadProblem,
  type PolicyRuleView,
  type PolicyRulesView,
  type RuleSource,
} from '@memnox/core';
import { policyFilesInForce } from '../policy-path';
import { baselineRules, machinePolicyPath } from '../protect/machine-rules';

/**
 * Every rule in force on this machine and where each came from: the rule files, what the
 * workspace published, the baseline, grants and allowances that end on their own, and freezes.
 */

/** A rule a person added here, by hand or by confirming what was learned, is theirs to remove. */
const EDITABLE_SOURCES: readonly RuleSource[] = [
  RULE_SOURCE.PERSON,
  RULE_SOURCE.EXTRACTED,
];

/** A file's rules, or why it would not load. */
type FileRead = { file: string; rules: Policy[] } | { problem: PolicyLoadProblem };

export async function readRulesView(home: string, now: Date): Promise<PolicyRulesView> {
  const files = await policyFilesInForce(home);
  const present = files.filter((file) => existsSync(file));
  const reads = await Promise.all(present.map(readFileRules));
  const defaults = defaultNames();
  const rules: PolicyRuleView[] = [];
  const problems: PolicyLoadProblem[] = [];
  for (const read of reads) {
    if ('problem' in read) problems.push(read.problem);
    else
      for (const rule of read.rules)
        rules.push(fileRuleView(home, rule, read.file, defaults));
  }
  const at = now.toISOString();
  rules.push(...(await timedRules(home, at)));
  return { rules, problems, missing: files.filter((file) => !present.includes(file)) };
}

/** A rule a person added on this machine, by name, with the file it lives in; null for any other. */
export async function editableRule(
  home: string,
  name: string,
): Promise<{ file: string; rule: Policy } | null> {
  const file = machinePolicyPath(home);
  if (!existsSync(file)) return null;
  const read = await readFileRules(file);
  if ('problem' in read) return null;
  const rule = read.rules.find((each) => each.name === name);
  if (rule === undefined || !isEditable(home, rule, file, defaultNames())) return null;
  return { file, rule };
}

/** Every rule a person added here, the ones `rules-export` writes. */
export async function editableRules(home: string): Promise<Policy[]> {
  const file = machinePolicyPath(home);
  if (!existsSync(file)) return [];
  const read = await readFileRules(file);
  if ('problem' in read) return [];
  const defaults = defaultNames();
  return read.rules.filter((rule) => isEditable(home, rule, file, defaults));
}

async function readFileRules(file: string): Promise<FileRead> {
  try {
    return { file, rules: await loadPoliciesFromFile(file) };
  } catch (err) {
    const issues =
      err instanceof PolicyValidationError
        ? [...err.issues]
        : [err instanceof Error ? err.message : String(err)];
    return { problem: { file, issues } };
  }
}

function defaultNames(): Set<string> {
  const { machine, project } = baselineRules();
  return new Set([...machine, ...project].map((rule) => rule.name));
}

function isEditable(
  home: string,
  rule: Policy,
  file: string,
  defaults: ReadonlySet<string>,
): boolean {
  return EDITABLE_SOURCES.includes(sourceOf(home, rule, file, defaults));
}

function sourceOf(
  home: string,
  rule: Policy,
  file: string,
  defaults: ReadonlySet<string>,
): RuleSource {
  if (rule.workspace === true || file === orgPolicyPathFor(home))
    return RULE_SOURCE.WORKSPACE;
  if (defaults.has(rule.name)) return RULE_SOURCE.DEFAULT;
  if (file !== machinePolicyPath(home)) return RULE_SOURCE.FILE;
  return rule.learnedFrom === undefined ? RULE_SOURCE.PERSON : RULE_SOURCE.EXTRACTED;
}

function fileRuleView(
  home: string,
  rule: Policy,
  file: string,
  defaults: ReadonlySet<string>,
): PolicyRuleView {
  const source = sourceOf(home, rule, file, defaults);
  return {
    ...ruleFields(rule),
    source,
    file,
    ...(rule.decidedBy === undefined ? {} : { decidedBy: rule.decidedBy }),
    ...(rule.decidedAt === undefined ? {} : { decidedAt: rule.decidedAt }),
    ...(rule.learnedFrom === undefined ? {} : { evidenceRefs: [...rule.learnedFrom] }),
    editable: EDITABLE_SOURCES.includes(source),
  };
}

function ruleFields(
  rule: Policy,
): Pick<PolicyRuleView, 'name' | 'effect' | 'match' | 'reason' | 'sentence'> {
  const { targets, agents, workingDirectories, classes, branches } = rule.match;
  const match = {
    actions: [...rule.match.actions],
    ...(targets === undefined ? {} : { targets: [...targets] }),
    ...(agents === undefined ? {} : { agents: [...agents] }),
    ...(workingDirectories === undefined
      ? {}
      : { workingDirectories: [...workingDirectories] }),
    ...(classes === undefined ? {} : { classes: [...classes] }),
    ...(branches === undefined ? {} : { branches: [...branches] }),
  };
  return {
    name: rule.name,
    effect: rule.decision.effect,
    match,
    ...(rule.decision.reason === undefined ? {} : { reason: rule.decision.reason }),
    sentence: sentenceOfRule(rule),
  };
}

/** Grants, allowances and freezes: in force now, and each ends on its own. */
async function timedRules(home: string, at: string): Promise<PolicyRuleView[]> {
  const [earned, given, overlays] = await Promise.all([
    new EarnedAllowances(home).inForce(at),
    new FileAllowances(home).all(),
    overlaysInForce(home),
  ]);
  return [
    ...earned.map((each) => allowanceView(each, RULE_SOURCE.AUTOPILOT)),
    ...given
      .filter((each) => inForceAt(each, at))
      .map((each) => allowanceView(each, RULE_SOURCE.ALLOWANCE)),
    ...inForce(overlays, at)
      .filter((each) => each.kind === OVERLAY_KIND.FREEZE)
      .map((each) => freezeView(each, at)),
  ];
}

function allowanceView(allowance: Allowance, source: RuleSource): PolicyRuleView {
  const says = describeAllowance(allowance);
  return {
    name: allowance.id,
    effect: DECISION_EFFECT.ALLOW,
    match: {
      actions: [...allowance.actions],
      ...(allowance.targets === undefined ? {} : { targets: [...allowance.targets] }),
      ...(allowance.agents === undefined ? {} : { agents: [...allowance.agents] }),
    },
    ...(allowance.reason === undefined ? {} : { reason: allowance.reason }),
    sentence: says,
    source,
    until: allowance.until,
    editable: false,
  };
}

/** A pause on one agent refuses everything it asks; any other freeze is matched by the rules that name it. */
function freezeView(overlay: Overlay, at: string): PolicyRuleView {
  const agent = overlay.subject.startsWith(AGENT_SUBJECT_PREFIX)
    ? overlay.subject.slice(AGENT_SUBJECT_PREFIX.length)
    : undefined;
  return {
    name: overlay.id,
    effect: DECISION_EFFECT.DENY,
    match: {
      actions: ['*'],
      ...(agent === undefined ? { targets: [overlay.subject] } : { agents: [agent] }),
    },
    reason: overlay.reason,
    sentence: describeOverlay(overlay, at),
    source: RULE_SOURCE.FREEZE,
    until: overlay.validUntil,
    editable: false,
  };
}

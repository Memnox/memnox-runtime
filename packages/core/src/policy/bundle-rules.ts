/**
 * A workspace's published rules as the engine reads them, for a caller whose questions go to
 * the control plane, which enforces approvers and quorums, so a rule naming them stays an ask.
 */
import { validatePolicyDocument } from './policy-validator';
import type { Policy, PolicyCarveOut, PolicyMatch } from './policy';
import type { DataPattern } from '../domain/sensitive-data';

/** One rule as the control plane publishes it in its bundle. */
export interface PublishedRule {
  id: string;
  effect: string;
  match: string;
  /** A rule's real pattern where it is narrowed; `match` then names nothing. */
  scopedMatch?: string;
  /** Every pattern it matches, read over `match` where present. */
  actions?: string[];
  /** Every other condition on its match, verbatim, as `PolicyMatch` spells it. */
  conditions?: Record<string, unknown>;
  reason?: string;
  alternative?: string;
  targets?: string[];
  agents?: string[];
  workingDirectories?: string[];
  unless?: PolicyCarveOut[];
  /** Its decision as published, read over `effect`: mode, approvers, quorum and the rest. */
  decision?: { effect: string; [field: string]: unknown };
  /** The kinds of machine it holds on. Absent is every kind. */
  machineClasses?: string[];
  project?: string;
}

/** The part of the control plane's bundle the engine reads. */
export interface PublishedBundle {
  hash: string;
  rules: PublishedRule[];
  /** The workspace's own sensitive data patterns, each under the classification it adds. */
  classifications?: DataPattern[];
}

const MACHINE_CLASSES = 'machineClasses';

/** Every condition key the engine matches; a rule naming another is skipped, matching less, never more. */
const HONOURED_CONDITIONS: ReadonlySet<string> = new Set([
  'environments',
  'roles',
  'principals',
  'models',
  'providers',
  'dataClassifications',
  'jurisdictions',
  'branches',
  'arguments',
  'content',
  'aboveAmount',
  'windows',
  'scope',
  'state',
  'unless',
] satisfies (keyof PolicyMatch)[]);

/**
 * The bundle's rules as policies, for a caller of the given machine class. Throws on a
 * bundle the validator refuses, since rules nobody can read must not become no rules.
 */
export function policiesFromBundle(
  bundle: PublishedBundle,
  machineClass?: string,
): Policy[] {
  const policies = bundle.rules
    .filter((rule) =>
      Object.keys(conditionsOf(rule)).every((key) => HONOURED_CONDITIONS.has(key)),
    )
    .filter((rule) => holdsOn(rule, machineClass))
    .map((rule) => ({
      name: rule.id,
      ...(rule.reason === undefined ? {} : { description: rule.reason }),
      match: { ...conditionsOf(rule), actions: actionsOf(rule), ...scopeOf(rule) },
      decision: decisionOf(rule),
      workspace: true,
      ...(rule.project === undefined ? {} : { project: rule.project }),
    }));
  return validatePolicyDocument({ version: 1, policies }).policies;
}

function decisionOf(rule: PublishedRule): Record<string, unknown> {
  const published = rule.decision ?? { effect: rule.effect };
  const { effect, approvers, minApprovals, mode, alternative } = published;
  const named =
    Array.isArray(approvers) && approvers.every((each) => typeof each === 'string');
  const whole =
    typeof alternative === 'string' && alternative !== ''
      ? alternative
      : rule.alternative;
  return {
    effect: typeof effect === 'string' ? effect : rule.effect,
    reason: rule.reason ?? 'the workspace publishes this rule',
    ...(whole === undefined ? {} : { alternative: { action: whole, note: whole } }),
    ...(named ? { approvers: [...(approvers as string[])] } : {}),
    ...(Number.isInteger(minApprovals) && (minApprovals as number) > 0
      ? { minApprovals }
      : {}),
    ...(typeof mode === 'string' ? { mode } : {}),
  };
}

function holdsOn(rule: PublishedRule, machineClass: string | undefined): boolean {
  const listed = rule.conditions?.[MACHINE_CLASSES];
  const classes = [
    ...(rule.machineClasses ?? []),
    ...(Array.isArray(listed)
      ? listed.filter((each): each is string => typeof each === 'string')
      : []),
  ];
  return (
    classes.length === 0 || (machineClass !== undefined && classes.includes(machineClass))
  );
}

function conditionsOf(rule: PublishedRule): Record<string, unknown> {
  const { [MACHINE_CLASSES]: _settledHere, ...rest } = rule.conditions ?? {};
  return rest;
}

function actionsOf(rule: PublishedRule): string[] {
  if (rule.actions !== undefined && rule.actions.length > 0) return [...rule.actions];
  return [rule.scopedMatch ?? rule.match];
}

function scopeOf(rule: PublishedRule): Record<string, unknown> {
  const own = rule.conditions?.['unless'];
  // Shape is the validator's to check; anything but a list is left for it to refuse.
  const unless = [
    ...(Array.isArray(own) ? (own as PolicyCarveOut[]) : []),
    ...(rule.unless ?? []),
  ];
  return {
    ...(rule.targets === undefined ? {} : { targets: [...rule.targets] }),
    ...(rule.agents === undefined ? {} : { agents: [...rule.agents] }),
    ...(rule.workingDirectories === undefined
      ? {}
      : { workingDirectories: [...rule.workingDirectories] }),
    ...(unless.length === 0 ? {} : { unless: unless.map((carve) => ({ ...carve })) }),
  };
}

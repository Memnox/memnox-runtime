import {
  DECISION_EFFECT,
  POLICY_MODE,
  type Alternative,
  type MachineClass,
  type PolicyCarveOut,
  type PolicyMatch,
} from '@memnox/core';

import { loadablePatterns } from './bundle-patterns';
import type { Bundle, BundleDecision, BundleRule } from './bundle';

/**
 * A pulled bundle turned into the policy document the gate reads. A rule is written
 * exactly as the workspace approved it, asked about instead where this machine cannot
 * read it whole, or left out, and every rule not written as approved is reported.
 */

/** What this machine does about a workspace rule it cannot read whole. */
export const NOT_ENFORCED_FALLBACK = {
  /** Its actions are asked about, wider than the rule, which is never the rule itself. */
  ASK: 'ask',
  /** Nothing: an allow, or a rule on every action, where asking about all of it would stop all work. */
  NONE: 'none',
} as const;

export type NotEnforcedFallback =
  (typeof NOT_ENFORCED_FALLBACK)[keyof typeof NOT_ENFORCED_FALLBACK];

/**
 * A workspace rule this machine does not enforce as written. Reported on every heartbeat,
 * so a rule nobody enforces never reads as in force, and the fallback is named for what it is.
 */
export interface RuleNotEnforced {
  id: string;
  effect: string;
  /** The condition keys this runtime cannot read. */
  keys: string[];
  fallback: NotEnforcedFallback;
}

/** The bundle's rules as the policy document the gate already reads. */
export function documentFrom(bundle: Bundle, machineClass?: MachineClass): unknown {
  const classifications = loadablePatterns(bundle.classifications);
  const held = bundle.rules.filter((rule) => holdsOn(rule, machineClass));
  const notEnforced = held.flatMap((rule) => {
    const missed = unreadableKeys(rule);
    return missed.length === 0 ? [] : [notEnforcedOf(rule, missed)];
  });
  return {
    version: 1,
    // Carried here so the next pull sends it as `If-None-Match` with no second copy.
    bundleHash: bundle.hash,
    // The gate registers a policy file's patterns as it loads it, so every seam classifies with them.
    ...(classifications.length === 0 ? {} : { classifications }),
    // Read back by the heartbeat, so the console says which rules this machine does not hold.
    ...(notEnforced.length === 0 ? {} : { notEnforced }),
    policies: held.flatMap((rule) => {
      if (unreadableKeys(rule).length > 0) return askInsteadOf(rule);
      const decision = decisionFor(rule);
      if (decision === null) return [];
      return [
        {
          name: rule.id,
          ...(rule.reason === undefined ? {} : { description: rule.reason }),
          match: {
            ...matchConditions(rule),
            actions: actionsOf(rule),
            ...scopeOf(rule),
          },
          decision,
          ...provenanceOf(rule),
        },
      ];
    }),
  };
}

/** The rules a policy document says this machine does not enforce as written. */
export function notEnforcedIn(document: unknown): RuleNotEnforced[] {
  const listed =
    document !== null && typeof document === 'object'
      ? (document as { notEnforced?: unknown }).notEnforced
      : undefined;
  return Array.isArray(listed) ? (listed as RuleNotEnforced[]) : [];
}

function notEnforcedOf(rule: BundleRule, keys: string[]): RuleNotEnforced {
  return {
    id: rule.id,
    effect: effectOf(rule),
    keys,
    fallback: askFallbackApplies(rule) ? NOT_ENFORCED_FALLBACK.ASK : NOT_ENFORCED_FALLBACK.NONE,
  };
}

function effectOf(rule: BundleRule): string {
  const published = rule.decision?.effect;
  return typeof published === 'string' ? published : rule.effect;
}

/**
 * A deny or an ask this machine cannot read whole is asked about on its own actions, wider
 * than written, so a person decides instead of nobody. Never on a rule over every action,
 * which would put a question in front of all work, and never an allow, which permits nothing.
 */
function askFallbackApplies(rule: BundleRule): boolean {
  const effect = effectOf(rule);
  if (effect !== DECISION_EFFECT.DENY && effect !== DECISION_EFFECT.ASK) return false;
  if (rule.decision?.['mode'] === POLICY_MODE.OBSERVE) return false;
  return !actionsOf(rule).includes(EVERY_ACTION);
}

const EVERY_ACTION = '*';

/** The fallback rule itself, named apart from the rule so nothing reads it as that rule enforced. */
function askInsteadOf(rule: BundleRule): Record<string, unknown>[] {
  if (!askFallbackApplies(rule)) return [];
  const keys = unreadableKeys(rule).join(', ');
  return [
    {
      name: `${rule.id}.asked-instead`,
      description: `Asked instead of enforced: this machine cannot read ${keys}`,
      match: { actions: actionsOf(rule), ...scopeOf(rule) },
      decision: {
        effect: DECISION_EFFECT.ASK,
        reason: `${(rule.reason ?? PUBLISHED_REASON).replace(/\.\s*$/, '')}. This machine cannot read ${keys} in the rule, so it asks about every ${actionsOf(rule).join(', ')} instead of enforcing the rule as written. Update Memnox on this computer.`,
      },
      ...provenanceOf(rule),
    },
  ];
}

/**
 * Whether a rule holds on this kind of machine. The kind is fixed at enrolment, so the rule is
 * dropped here rather than matched on every call; a machine that never said holds only unscoped rules.
 */
function holdsOn(rule: BundleRule, machineClass: MachineClass | undefined): boolean {
  const classes = classesOf(rule);
  if (classes.length === 0) return true;
  return machineClass !== undefined && classes.includes(machineClass);
}

/** Marked as the workspace's, with its project and who decided it, for the gate and for `why`. */
function provenanceOf(rule: BundleRule): Record<string, unknown> {
  return {
    workspace: true,
    ...(rule.project === undefined ? {} : { project: rule.project }),
    ...(rule.decidedBy === undefined ? {} : { decidedBy: rule.decidedBy }),
    ...(rule.decidedAt === undefined ? {} : { decidedAt: rule.decidedAt }),
  };
}

const PUBLISHED_REASON = 'the workspace publishes this rule';

/**
 * The rule's decision as the gate reads it, or null where the rule is skipped. An observed
 * rule decides nothing, so it is written as published. Anything else restricted by a field
 * this gate cannot enforce is read strictly: a deny stays, an ask is refused, an allow is skipped.
 */
function decisionFor(rule: BundleRule): Record<string, unknown> | null {
  const published = rule.decision ?? { effect: rule.effect };
  const effect = typeof published.effect === 'string' ? published.effect : rule.effect;
  const reason = rule.reason ?? PUBLISHED_REASON;
  const observed = published['mode'] === POLICY_MODE.OBSERVE;
  const decision = {
    effect,
    reason,
    ...alternativeOf(rule, published),
    ...recordedFields(published),
    ...(observed ? { mode: POLICY_MODE.OBSERVE } : {}),
  };
  if (observed || !restricted(published)) return decision;
  // A missing allow never permits more, since the strictest matching rule wins.
  if (effect === DECISION_EFFECT.ALLOW) return null;
  if (effect !== DECISION_EFFECT.ASK) return decision;
  return {
    ...decision,
    effect: DECISION_EFFECT.DENY,
    reason: refusedAsk(reason, published),
  };
}

/** Fields this gate enforces as written, each with the values it can enforce. */
const ENFORCED_AS_WRITTEN: Readonly<Record<string, (value: unknown) => boolean>> = {
  reason: () => true,
  alternative: () => true,
  mode: (value) => value === POLICY_MODE.ENFORCE,
  // A hold asks whoever is at the terminal, so it can only honour naming nobody.
  approvers: (value) => Array.isArray(value) && value.length === 0,
  // A hold takes one answer.
  minApprovals: (value) => value === 1,
};

/** Whether the decision names anything this gate would have to ignore to apply it. */
function restricted(published: BundleDecision): boolean {
  return Object.entries(published).some(([field, value]) => {
    if (field === 'effect' || value === null || value === undefined) return false;
    const enforced = ENFORCED_AS_WRITTEN[field];
    return enforced === undefined || !enforced(value);
  });
}

/** Approvers, quorum and rate limit, kept on the rule where they will validate, never enforced. */
function recordedFields(published: BundleDecision): Record<string, unknown> {
  const { approvers, minApprovals, rateLimit } = published;
  const named =
    Array.isArray(approvers) && approvers.every((each) => typeof each === 'string');
  const ceiling =
    rateLimit !== null &&
    typeof rateLimit === 'object' &&
    isPositiveInteger((rateLimit as Record<string, unknown>)['max']) &&
    isPositiveInteger((rateLimit as Record<string, unknown>)['windowSeconds']);
  return {
    ...(named ? { approvers: [...(approvers as string[])] } : {}),
    ...(isPositiveInteger(minApprovals) ? { minApprovals } : {}),
    ...(ceiling ? { rateLimit: { ...(rateLimit as Record<string, unknown>) } } : {}),
  };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Why an ask became a refusal here, naming who the rule wanted asked where it named anybody. */
function refusedAsk(reason: string, published: BundleDecision): string {
  const approvers = published['approvers'];
  const why =
    Array.isArray(approvers) && approvers.length > 0
      ? `only ${approvers.map(String).join(', ')} may approve it, and a question here goes to whoever answers first`
      : 'the rule holds its question to something this machine cannot enforce';
  return `${reason.replace(/\.\s*$/, '')}. Refused on this machine, because ${why}.`;
}

/** The whole alternative where it was published whole, or the action named on the rule. */
function alternativeOf(
  rule: BundleRule,
  published: BundleDecision,
): { alternative?: Alternative } {
  const whole = published['alternative'];
  if (whole !== null && typeof whole === 'object' && !Array.isArray(whole)) {
    const { action, note, resource } = whole as Record<string, unknown>;
    const readable =
      typeof action === 'string' &&
      action !== '' &&
      typeof note === 'string' &&
      note !== '' &&
      (resource === undefined || typeof resource === 'string');
    if (readable) {
      return {
        alternative: { action, note, ...(resource === undefined ? {} : { resource }) },
      };
    }
  }
  const named = typeof whole === 'string' && whole !== '' ? whole : rule.alternative;
  return named === undefined ? {} : { alternative: { action: named, note: named } };
}

/** Every condition key this gate reads; the validator drops any other, which would widen the rule. */
const MACHINE_CLASSES = 'machineClasses';

/**
 * Keyed by every match key the engine reads, so a key added to `PolicyMatch` and left
 * out here fails to compile rather than skipping every rule that uses it.
 */
const HONOURED_CONDITIONS: Readonly<Record<Exclude<keyof PolicyMatch, 'actions'>, true>> = {
  targets: true,
  environments: true,
  agents: true,
  roles: true,
  principals: true,
  models: true,
  providers: true,
  dataClassifications: true,
  jurisdictions: true,
  workingDirectories: true,
  branches: true,
  classes: true,
  capabilities: true,
  arguments: true,
  content: true,
  aboveAmount: true,
  windows: true,
  scope: true,
  state: true,
  unless: true,
};

/** The condition keys on a rule this gate would have to ignore, which it never does silently. */
function unreadableKeys(rule: BundleRule): string[] {
  return Object.keys(matchConditions(rule)).filter((key) => !(key in HONOURED_CONDITIONS));
}

/**
 * The conditions the gate matches on each call. The machine class is sent among them too, so a
 * runtime that never learned it skips the rule rather than holding a server's rule on a laptop;
 * here it is settled once, at apply time, and taken out of what the gate matches.
 */
function matchConditions(rule: BundleRule): Record<string, unknown> {
  const { [MACHINE_CLASSES]: _settledAtApply, ...rest } = rule.conditions ?? {};
  return rest;
}

/** The classes a rule holds on, top level or among its conditions, whichever the plane sent. */
function classesOf(rule: BundleRule): string[] {
  const listed = rule.conditions?.[MACHINE_CLASSES];
  const fromConditions = Array.isArray(listed)
    ? listed.filter((each): each is string => typeof each === 'string')
    : [];
  return [...(rule.machineClasses ?? []), ...fromConditions];
}

/** The patterns a rule really matches, whichever spelling it was sent under. */
function actionsOf(rule: BundleRule): string[] {
  if (rule.actions !== undefined && rule.actions.length > 0) return [...rule.actions];
  return [rule.scopedMatch ?? rule.match];
}

/** Only the scope a rule carries, so an unscoped rule reads exactly as it always did. */
function scopeOf(rule: BundleRule): Record<string, unknown> {
  const unless = [...carveOutsIn(rule.conditions), ...(rule.unless ?? [])];
  return {
    ...(rule.targets === undefined ? {} : { targets: [...rule.targets] }),
    ...(rule.agents === undefined ? {} : { agents: [...rule.agents] }),
    ...(rule.workingDirectories === undefined
      ? {}
      : { workingDirectories: [...rule.workingDirectories] }),
    ...(unless.length === 0 ? {} : { unless: unless.map((carve) => ({ ...carve })) }),
  };
}

/** A rule's own carve-outs and the approved exceptions beside them both hold, so neither is lost. */
function carveOutsIn(conditions: Record<string, unknown> | undefined): PolicyCarveOut[] {
  const own = conditions === undefined ? undefined : conditions['unless'];
  // Shape is the validator's to check; anything but a list is left for it to refuse.
  return Array.isArray(own) ? (own as PolicyCarveOut[]) : [];
}

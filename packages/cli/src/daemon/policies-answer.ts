import {
  DECISION_EFFECT,
  POLICY_METHOD,
  type DaemonRequest,
  type DaemonResponse,
  type RuleDraftInput,
  type RuleTestInput,
} from '@memnox/core';
import { revokeGrant } from '../studio/autopilot-grants';
import { readProgress } from '../studio/progress-view';
import {
  exportRules,
  importPack,
  proposeRuleDraft,
  removeRule,
} from '../studio/rule-changes';
import { shippedRulePacks } from '../studio/rule-packs';
import { testRule } from '../studio/rule-test';
import { readRulesView } from '../studio/rules-in-force';

/**
 * The Policy Studio's methods. A rule proposed, a pack imported, or a deny or ask removed waits on
 * the person's signature; an allow removed or a grant taken back only narrows, so it is done at once.
 */

const POLICY_METHODS: readonly string[] = Object.values(POLICY_METHOD);
const EFFECTS: readonly string[] = Object.values(DECISION_EFFECT);
const LIST_FIELDS = [
  'branches',
  'targets',
  'agents',
  'workingDirectories',
  'classes',
] as const;
type ListField = (typeof LIST_FIELDS)[number];

export function isPolicyMethod(method: string): boolean {
  return POLICY_METHODS.includes(method);
}

interface PolicyDeps {
  now: Date;
  env: NodeJS.ProcessEnv;
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every change answers with the rules as they now stand, so a screen redraws from one answer. */
export async function policiesAnswer(
  home: string,
  request: DaemonRequest,
  deps: PolicyDeps,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, deps).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok || !changesRules(request.method))
    return { id: request.id, ...answered };
  return {
    id: request.id,
    ...answered,
    policyRules: await readRulesView(home, deps.now),
  };
}

function changesRules(method: string): boolean {
  return method === POLICY_METHOD.POLICY_RULES || method === POLICY_METHOD.RULE_REMOVE;
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: PolicyDeps,
): Promise<Answered> {
  const at = deps.now.toISOString();
  switch (request.method) {
    case POLICY_METHOD.RULE_PROPOSE:
      return propose(home, request.ruleDraft, at);
    case POLICY_METHOD.RULE_REMOVE:
      return remove(home, request.ruleName, at);
    case POLICY_METHOD.RULE_TEST:
      return test(home, request.ruleTest, deps);
    case POLICY_METHOD.RULES_EXPORT:
      return { ok: true, rulesToml: await exportRules(home) };
    case POLICY_METHOD.RULE_PACK_IMPORT:
      return importOne(home, request.rulePack, at);
    case POLICY_METHOD.RULE_PACKS:
      return { ok: true, rulePacks: await shippedRulePacks() };
    case POLICY_METHOD.PROGRESS:
      return { ok: true, progress: await readProgress(home, deps.now) };
    case POLICY_METHOD.AUTOPILOT_REVOKE:
      return revoke(home, request.grantId, deps.now);
    default:
      return { ok: true };
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

async function propose(home: string, value: unknown, at: string): Promise<Answered> {
  const draft = ruleDraftFrom(value);
  if (draft === null)
    return refused(
      'Send the rule as an effect, an action, a reason and lists of patterns.',
    );
  const proposed = await proposeRuleDraft(home, draft, at);
  if ('refused' in proposed) return refused(proposed.refused);
  return { ok: true, proposed: proposed.proposed, ruleProposed: proposed.read };
}

async function remove(
  home: string,
  name: string | undefined,
  at: string,
): Promise<Answered> {
  if (name === undefined || name === '') return refused('Name the rule to remove.');
  const removed = await removeRule(home, name, at);
  if ('refused' in removed) return refused(removed.refused);
  return 'proposed' in removed ? { ok: true, proposed: removed.proposed } : { ok: true };
}

async function test(home: string, value: unknown, deps: PolicyDeps): Promise<Answered> {
  const input = ruleTestFrom(value);
  if (input === null) return refused('Name the action to try.');
  return { ok: true, ruleVerdict: await testRule(home, input, deps) };
}

async function importOne(
  home: string,
  toml: string | undefined,
  at: string,
): Promise<Answered> {
  if (toml === undefined || toml.trim() === '')
    return refused('Send the pack as TOML text.');
  const imported = await importPack(home, toml, at);
  if ('refused' in imported) return refused(imported.refused);
  return { ok: true, packProposed: imported.proposed };
}

async function revoke(
  home: string,
  id: string | undefined,
  now: Date,
): Promise<Answered> {
  if (id === undefined || id === '') return refused('Name the grant to take back.');
  const revoked = await revokeGrant(home, id, now.toISOString());
  if (revoked === null) return refused(`No grant ${id}.`);
  return { ok: true, progress: await readProgress(home, now) };
}

/** The rule as a screen sent it, which is untrusted JSON until every field is checked. */
function ruleDraftFrom(value: unknown): RuleDraftInput | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { effect, action, reason } = raw;
  if (typeof effect !== 'string' || !EFFECTS.includes(effect)) return null;
  if (typeof action !== 'string' || typeof reason !== 'string') return null;
  const lists: Partial<Record<ListField, string[]>> = {};
  for (const field of LIST_FIELDS) {
    const list = raw[field];
    if (list === undefined) continue;
    if (!isStringList(list)) return null;
    if (list.length > 0) lists[field] = list;
  }
  // Cast is safe: checked against the engine's own effects above.
  return { effect: effect as RuleDraftInput['effect'], action, reason, ...lists };
}

function ruleTestFrom(value: unknown): RuleTestInput | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { action, target, agent, workingDirectory } = raw;
  if (typeof action !== 'string' || action.trim() === '') return null;
  return {
    action,
    ...(typeof target === 'string' ? { target } : {}),
    ...(typeof agent === 'string' ? { agent } : {}),
    ...(typeof workingDirectory === 'string' ? { workingDirectory } : {}),
  };
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((each) => typeof each === 'string');
}

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { POLICY_DOCUMENT_VERSION, type Policy } from '../policy/policy';
import {
  PolicyValidationError,
  validatePolicyDocument,
} from '../policy/policy-validator';

/** A pack of rules as TOML text, the same shape a rule file has, carried between machines and people. */

/** The most text a pack may be, so a pasted file cannot fill the daemon's memory. */
export const MOST_RULE_PACK_CHARS = 256 * 1024;

/** The rules as one TOML document, loadable as a rule file just as it is. */
export function rulePackToml(rules: readonly Policy[]): string {
  return stringifyToml({ version: POLICY_DOCUMENT_VERSION, policies: [...rules] });
}

/** The rules a pack holds, or every reason it would not load; a pack is never read in part. */
export function rulesOfPack(text: string): { rules: Policy[] } | { problems: string[] } {
  if (text.length > MOST_RULE_PACK_CHARS)
    return { problems: [`a pack is at most ${MOST_RULE_PACK_CHARS} characters`] };
  try {
    const document = validatePolicyDocument(parseToml(text));
    if (document.policies.length === 0) return { problems: ['the pack holds no rules'] };
    return { rules: document.policies.map(asOwnRule) };
  } catch (err) {
    if (err instanceof PolicyValidationError) return { problems: [...err.issues] };
    return { problems: [err instanceof Error ? err.message : String(err)] };
  }
}

/** A pack never speaks for the workspace, so a rule claiming a team's decision arrives as a plain one. */
function asOwnRule(rule: Policy): Policy {
  const { workspace: _workspace, decidedBy: _by, decidedAt: _at, ...own } = rule;
  return own;
}

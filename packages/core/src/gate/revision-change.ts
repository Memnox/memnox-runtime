import { REVISION_KIND, type Revision } from '../store/revisions';
import { validatePolicyDocument } from '../policy/policy-validator';
import { parsePolicySource } from './policy-file';
import type { Allowance } from './allowances';

/**
 * What one change to a rule file or to the autopilot's allowances did, named rather than shown
 * as a diff: rules by name, allowances by the actions they cover. Computed from the two copies,
 * so the history never says a change did something it did not.
 */

export interface RevisionChange {
  added: string[];
  removed: string[];
  /** Present on both sides but written differently. */
  changed: string[];
  /** Either side would not parse, so nothing is claimed about it. */
  unreadable?: true;
}

/** `before` is the revision's copy; `after` is the next copy of the same file, or the file now. */
export function revisionChange(revision: Revision, after: string): RevisionChange {
  const read = revision.kind === REVISION_KIND.RULES ? ruleEntries : allowanceEntries;
  const was = read(revision.content, revision.file);
  const now = read(after, revision.file);
  if (was === null || now === null) {
    return { added: [], removed: [], changed: [], unreadable: true };
  }
  return {
    added: [...now.keys()].filter((name) => !was.has(name)),
    removed: [...was.keys()].filter((name) => !now.has(name)),
    changed: [...now.keys()].filter(
      (name) => was.has(name) && was.get(name) !== now.get(name),
    ),
  };
}

/** "+2 rules, -1, 1 changed", or what could not be said. */
export function describeRevisionChange(change: RevisionChange): string {
  if (change.unreadable === true) return 'one side would not parse';
  const parts = [
    ...(change.added.length === 0 ? [] : [`added ${change.added.join(', ')}`]),
    ...(change.removed.length === 0 ? [] : [`removed ${change.removed.join(', ')}`]),
    ...(change.changed.length === 0 ? [] : [`changed ${change.changed.join(', ')}`]),
  ];
  return parts.length === 0 ? 'nothing a rule reads changed' : parts.join('; ');
}

/** Each rule by name, with its written form, so a rule edited in place reads as changed. */
function ruleEntries(raw: string, file: string): Map<string, string> | null {
  if (raw.trim() === '') return new Map();
  try {
    const document = validatePolicyDocument(parsePolicySource(raw, file));
    return new Map(document.policies.map((rule) => [rule.name, JSON.stringify(rule)]));
  } catch {
    return null;
  }
}

/** Each allowance by its id and actions, so a revoke reads as a change to that one. */
function allowanceEntries(raw: string): Map<string, string> | null {
  if (raw.trim() === '') return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Written by the allowance store, so each entry is its own record.
    const allowances = parsed as Allowance[];
    return new Map(
      allowances.map((each) => [
        `${each.actions.join(' ')} (${each.id})`,
        JSON.stringify(each),
      ]),
    );
  } catch {
    return null;
  }
}

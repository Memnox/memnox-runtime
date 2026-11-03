import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';

import {
  conditionsForMachine,
  detectMachineClass,
  loadPoliciesFromFile,
  MEMNOX_HOME,
  orgConditionsPathFor,
  orgOverlaysFrom,
  orgProjectsFrom,
  readJsonFile,
  writeOrgConditions,
  writeOrgProjects,
  HTTP,
  isCredentialRefused,
  type Account,
  type DataPattern,
  type MachineClass,
  type OrgCondition,
  type PolicyCarveOut,
  type OrgConditionsFile,
  type Overlay,
} from '@memnox/core';

import { registerPolicyFile } from '../policy-registry';
import { documentFrom, notEnforcedIn, type RuleNotEnforced } from './bundle-document';
import { RUNTIME_CAPABILITIES } from './capabilities';
import { callCloud } from './client';
import { keepOrgMcpServers } from './org-mcp';
import { keepOrgSkills } from './org-skills';

/**
 * The rules this workspace publishes, pulled and put where the gate already looks. The
 * engine reads the file later with no network near it, so this is off the decision path.
 */

/** Written by the pull and never by hand; `memnox login` is what starts it. */
const ORG_POLICY_FILE = 'org.policies.json';
const OWNER_ONLY = 0o600;
const OWNER_ONLY_DIR = 0o700;

export interface BundleRule {
  id: string;
  policyHash: string;
  line: number;
  domain: string;
  effect: string;
  specificity: number;
  match: string;
  /** A rule's real pattern where it is narrowed; `match` then names nothing. */
  scopedMatch?: string;
  /** Every pattern it matches, where it names several or carries `conditions`; read over `match`. */
  actions?: string[];
  /** Every other condition on its match, verbatim, as `PolicyMatch` spells it. */
  conditions?: Record<string, unknown>;
  reason?: string;
  alternative?: string;
  /** Where a rule applies, when the workspace scoped it. Absent is everywhere. */
  targets?: string[];
  agents?: string[];
  workingDirectories?: string[];
  /** Where it stands aside, because an exception to it was approved. */
  unless?: PolicyCarveOut[];
  /** Its decision as published, where it says more than its effect. Read over `effect`. */
  decision?: BundleDecision;
  /** The kinds of machine it holds on, server or workstation. Absent is every machine. */
  machineClasses?: string[];
  /** The project it belongs to. Absent is every project. */
  project?: string;
  /** Who in the workspace approved the publish that carried it, and when. */
  decidedBy?: string;
  decidedAt?: string;
}

/** Mode, approvers, quorum, rate limit and the rest, verbatim, with the published effect. */
export interface BundleDecision {
  effect: string;
  [field: string]: unknown;
}

/** The control plane's shape, kept as it arrives. `OrgCondition` is the same row. */
export type BundleCondition = OrgCondition;

export interface Bundle {
  hash: string;
  policies: { hash: string; layer: string; content: string }[];
  rules: BundleRule[];
  conditions: BundleCondition[];
  tags: unknown[];
  /** The team's own sensitive data patterns, each under the classification it adds. */
  classifications?: DataPattern[];
  /** The organization's MCP servers, read by the hub as a scope nobody here edits; checked field by field. */
  mcpServers?: unknown[];
  /** The organization's skills, read by the Skills Hub as a scope nobody here edits; each checked against its digest. */
  skills?: unknown[];
  /** The repositories the organization shares with this machine's owner, each read only over its clone. */
  projects?: unknown[];
}

export const PULL_OUTCOME = {
  /** 304: this machine already holds it. The common answer. */
  UNCHANGED: 'unchanged',
  APPLIED: 'applied',
  /** It arrived and would not load. The previous bundle stays in force. */
  REFUSED: 'refused',
  /** The credential is gone. Stop pulling; the rules on disk stay. */
  REVOKED: 'revoked',
  /** The plan lapsed. Same answer: the rules on disk stay. */
  LAPSED: 'lapsed',
} as const;

export type PullOutcome = (typeof PULL_OUTCOME)[keyof typeof PULL_OUTCOME];

export interface PullResult {
  outcome: PullOutcome;
  hash?: string;
  rules?: number;
  conditions?: number;
  /** The workspace's rules this machine does not enforce as written, and what it does instead. */
  notEnforced?: RuleNotEnforced[];
  /** Why a bundle was refused, in the words `doctor` prints. */
  because?: string;
}

export function orgPolicyPath(home: string): string {
  return join(home, MEMNOX_HOME, ORG_POLICY_FILE);
}

/** Re-exported so the sync tests and `doctor` name the same file the gate reads. */
export const orgConditionsPath = orgConditionsPathFor;

/**
 * One conditional GET, and what to do with each answer. Every failure keeps the rules
 * already on disk, so an unreachable control plane never makes a quieter gate.
 */
export async function pullBundle(
  home: string,
  account: Account,
  held?: string,
  now: () => number = Date.now,
): Promise<PullResult> {
  const answer = await callCloud<Bundle>({
    baseUrl: account.baseUrl,
    path: `/v1/workspaces/${account.workspaceId}/bundle`,
    token: account.token,
    // An exception that ends is sent only to a runtime that ends it, offline too.
    capabilities: RUNTIME_CAPABILITIES,
    ...(held === undefined ? {} : { ifNoneMatch: held }),
  });

  if (answer.status === HTTP.NOT_MODIFIED) {
    // Hearing from the plane moves the horizon, or an unedited workspace freeze would lapse.
    await touchOrgConditions(home, now());
    return { outcome: PULL_OUTCOME.UNCHANGED };
  }
  if (isCredentialRefused(answer.status)) {
    return { outcome: PULL_OUTCOME.REVOKED };
  }
  if (answer.status === HTTP.PAYMENT_REQUIRED) return { outcome: PULL_OUTCOME.LAPSED };
  if (answer.status !== HTTP.OK || answer.body === undefined) {
    return {
      outcome: PULL_OUTCOME.REFUSED,
      because: `the control plane answered ${answer.status}`,
    };
  }

  return applyBundle(home, answer.body, {
    now,
    machineId: account.machineId,
    machineClass: account.machineClass ?? detectMachineClass(platform(), process.env),
  });
}

/**
 * Whole or not at all, because a half-applied bundle is a rule set nobody wrote: staged,
 * loaded through the gate's own reader, and moved into place only once it parsed.
 */
export async function applyBundle(
  home: string,
  bundle: Bundle,
  here: BundleMachine = {},
): Promise<PullResult> {
  const now = here.now ?? Date.now;
  const machineId = here.machineId ?? '';
  const path = orgPolicyPath(home);
  const staging = `${path}.incoming`;
  const document = documentFrom(bundle, here.machineClass);
  await mkdir(dirname(path), { recursive: true, mode: OWNER_ONLY_DIR });
  await writeFile(
    staging,
    JSON.stringify(document, null, 2),
    {
      encoding: 'utf8',
      mode: OWNER_ONLY,
    },
  );

  try {
    // The gate's own loader, so a bundle this accepts is one the gate can read.
    await loadPoliciesFromFile(staging);
  } catch (err) {
    // Leaving it would put a rule set the gate rejected next to the one in force.
    await rm(staging, { force: true });
    return {
      outcome: PULL_OUTCOME.REFUSED,
      hash: bundle.hash,
      because: err instanceof Error ? err.message : String(err),
    };
  }

  // Renamed, which is atomic on one filesystem, so no reader sees half a rule set.
  await rename(staging, path);
  await registerPolicyFile(home, path);
  await keepConditions(home, bundle, now(), machineId);
  await keepOrgMcpServers(home, bundle.mcpServers);
  await keepOrgSkills(home, bundle.skills, new Date(now()));
  // Absent is a bundle sharing none with this owner, which takes back any shared before.
  await writeOrgProjects(home, orgProjectsFrom(bundle.projects ?? []));

  return {
    outcome: PULL_OUTCOME.APPLIED,
    hash: bundle.hash,
    rules: bundle.rules.length,
    conditions: bundle.conditions.length,
    notEnforced: notEnforcedIn(document),
  };
}

/** The machine a bundle is applied on, since freezes name a machine and rules may name a kind of machine. */
interface BundleMachine {
  now?: () => number;
  /** Without one, a freeze scoped to a machine applies nowhere. */
  machineId?: string;
  /** Without one, only rules that name no kind of machine apply, the narrowest reading. */
  machineClass?: MachineClass;
}

/** Only the conditions that are this machine's: a freeze of one agent names its laptop. */
async function keepConditions(
  home: string,
  bundle: Bundle,
  syncedAt: number,
  machineId: string,
): Promise<void> {
  await writeOrgConditions(home, {
    syncedAt,
    conditions: conditionsForMachine(bundle.conditions, machineId),
  });
}

/**
 * The conditions in force, as overlays, kept apart from `memnox freeze`'s file so a local
 * `--lift` cannot end a company-wide incident. Converted by core, beside the gate's reader.
 */
export function overlaysFrom(bundle: Bundle, syncedAt: number = Date.now()): Overlay[] {
  return orgOverlaysFrom({ syncedAt, conditions: bundle.conditions });
}

/** Move the horizon after a 304, keeping the conditions exactly as they were. */
async function touchOrgConditions(home: string, at: number): Promise<void> {
  const held = await readJsonFile<Partial<OrgConditionsFile>>(orgConditionsPathFor(home));
  // Nothing pulled yet, so there is no horizon to move.
  if (held === null || !Array.isArray(held.conditions)) return;
  try {
    await writeOrgConditions(home, { syncedAt: at, conditions: held.conditions });
  } catch {
    // The horizon moves on the next 304, and a pull must not fail over it.
  }
}

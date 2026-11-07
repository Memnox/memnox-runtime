import {
  FileAllowances,
  LocalGate,
  overlaysInForce,
  projectIdAt,
  stateLabelsOf,
  type RuleTestInput,
  type RuleVerdictView,
} from '@memnox/core';
import { policySetInForce } from '../policy-path';
import { dryRun, insteadOf } from '../policy-requests';

/**
 * One action ruled on against what is in force here, the rule files with every grant, allowance
 * and freeze beside them, and nothing recorded: no notice is attached, so no row is written.
 */

/** The agent the rules are matched against when the screen names none, as `policy test` names it. */
const ANY_AGENT = 'agent';

export async function testRule(
  home: string,
  input: RuleTestInput,
  { now, env }: { now: Date; env: NodeJS.ProcessEnv },
): Promise<RuleVerdictView> {
  const at = now.toISOString();
  const [set, allowances, overlays, projectId] = await Promise.all([
    policySetInForce(home),
    new FileAllowances(home).inForce(at),
    overlaysInForce(home),
    projectOf(home, input.workingDirectory),
  ]);
  const gate = new LocalGate(set.policies, {
    agentName: input.agent ?? ANY_AGENT,
    stateFacts: stateLabelsOf(overlays, at),
    allowances,
    now,
  });
  const { verdict, alternative, refused } = dryRun(
    gate,
    input.action,
    {
      ...(input.target === undefined ? {} : { target: input.target }),
      ...(input.workingDirectory === undefined
        ? {}
        : { workingDirectory: input.workingDirectory }),
      ...(projectId === undefined ? {} : { projectId }),
    },
    env,
  );
  const rule = verdict.matchedPolicies[0];
  return {
    effect: verdict.effect,
    reason: verdict.reason,
    ...(rule === undefined ? {} : { rule: rule.name }),
    ...(alternative === undefined ? {} : { instead: insteadOf(alternative, refused) }),
  };
}

/** The project a seam would find for the folder, so a dry run answers as enforcement does. */
async function projectOf(
  home: string,
  workingDirectory: string | undefined,
): Promise<string | undefined> {
  if (workingDirectory === undefined) return undefined;
  // A lookup that fails names no project, which leaves the machine's rules, as at a seam.
  return projectIdAt(home, workingDirectory).catch((): undefined => undefined);
}

import {
  leaseProblem,
  readAssignmentMarks,
  readHeldAssignments,
  systemClock,
} from '@memnox/core';

/**
 * The assignments this machine applied and relies on, read from what its gates hold rather
 * than from what was sent: the version, whether the lease is fresh, and when each agent was gated.
 */
export async function assignmentReport(home: string): Promise<Record<string, unknown>> {
  const held = await readHeldAssignments(home);
  if (held === null) return {};
  const marks = await readAssignmentMarks(home);
  const problem = leaseProblem(held, systemClock());
  return {
    assignmentVersionApplied: held.block.version,
    assignmentLease: problem === null ? 'fresh' : problem.state,
    agentsGated: Object.entries(marks.gated).map(([profile, at]) => ({
      profile,
      gatedAt: new Date(at).toISOString(),
    })),
  };
}

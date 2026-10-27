/**
 * The Windows half of `doctor --wiring`: per agent, which seams govern it natively there and
 * which exist only on macOS or Linux, said plainly rather than reported as a clean machine.
 */
import {
  agentNameIn,
  discover,
  windowsCoverageFor,
  type AgentOnWindows,
  type MachineReader,
} from '@memnox/core';

import type { CliContext } from '../../cli-context';
import { TONE } from '../../flow';

/** The agents this machine has, each with what reaches it on Windows. */
export async function windowsCoverageOf(
  reader: MachineReader,
  at: { now: Date; cwd: string },
): Promise<AgentOnWindows[]> {
  const discovered = await discover(reader, {
    now: at.now.toISOString(),
    projectDirs: [at.cwd],
  });
  return windowsCoverageFor(discovered.agents);
}

export function renderWindowsCoverage(
  context: CliContext,
  agents: readonly AgentOnWindows[],
): void {
  if (agents.length === 0) {
    context.flow.aside('On Windows: no agent found here to report on.');
    return;
  }
  context.flow.list(
    'What can govern each agent on Windows',
    agents.map((agent) => ({
      tone: TONE.WARN,
      text: `${agentNameIn(agent.agentId)}  native on Windows: ${agent.native.map((seam) => seam.seam).join(', ')}`,
      detail: agent.missing.map(
        (seam) => `not available on Windows: ${seam.seam}, because ${seam.detail}`,
      ),
    })),
  );
}

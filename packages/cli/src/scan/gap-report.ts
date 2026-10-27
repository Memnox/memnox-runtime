import {
  areaPhrase,
  capabilitiesOf,
  gapLines,
  measureGap,
  SURFACE_KIND,
  tallyOf,
  type DiscoveryReport,
} from '@memnox/core';

import type { CliContext } from '../cli-context';
import type { LocalCounts } from '../local-counts';
import { describeCount } from '../plural';

/** The scan's closing lines: what can reach outside this laptop against how much of it anything checks. */
export function renderGap(
  context: CliContext,
  report: DiscoveryReport,
  counts: LocalCounts,
  unasked: readonly string[],
): void {
  const { flow, style } = context;
  const surfaces = report.surfaces.filter((surface) => surface.kind !== SURFACE_KIND.MCP);
  const gap = measureGap(report, counts.policies);
  flow.close(
    gap.governed === 0
      ? style.warn(
          `${surfaces.length} execution surfaces, and nothing is checking any of them.`,
        )
      : `${surfaces.length} execution surfaces.`,
  );
  if (unasked.length > 0) {
    // A server never asked holds tools nobody has counted, so a total would be a floor posing as a count.
    flow.hint(
      `What ${describeCount(unasked.length, 'MCP server')} can do is unknown, since nothing has asked yet, so the capabilities are not counted. Run memnox scan to ask.`,
    );
  } else {
    for (const line of gapLines(gap)) flow.hint(line);
    const areas = areaPhrase(tallyOf(capabilitiesOf(report)).areas);
    if (areas !== null) flow.hint(`They reach ${areas}.`);
  }
  if (counts.approvedAgents.length === 0) {
    flow.hint(
      'No agent has been approved or refused here. Decide with ' +
        `"memnox config set approvedAgents ${agentKinds(report).join(',')}".`,
    );
  }
  flow.hint('memnox explain <name>   where any of these comes from');
  flow.hint('memnox protect          put the dangerous ones behind ask or deny');
}

export function agentKinds(report: DiscoveryReport): string[] {
  return report.agents.map((agent) => agent.kind);
}

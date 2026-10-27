import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  ENFORCEMENT_MODE,
  unattendedCheck,
  type UnattendedCheck,
  type UnattendedInput,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import { readHealth } from '../health-probe';
import { agentBoundary, DEFAULT_AGENT } from '../next/boundary-report';
import { policySetInForce } from '../policy-path';

/**
 * `memnox unattended`: can I leave this agent running? The question a person asks before
 * walking away, and the one the voice answers first, so it is one screen of counts.
 */

interface UnattendedDeps {
  home: () => string;
  project: () => string;
  read: (home: string, project: string, agent: string) => Promise<UnattendedInput>;
}

export function registerUnattendedCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<UnattendedDeps> = {},
): void {
  const deps: UnattendedDeps = {
    home: homedir,
    project: () => process.cwd(),
    read: readUnattended,
    ...overrides,
  };
  program
    .command('unattended')
    .description('Whether an agent can be left running, and what to settle first if not')
    .option('--agent <name>', 'the agent to ask about', DEFAULT_AGENT)
    .option('--json', 'machine-readable output')
    .action(async (options: { agent: string; json?: boolean }) => {
      const check = unattendedCheck(
        await deps.read(deps.home(), deps.project(), options.agent),
      );
      if (options.json === true) {
        context.out.json(check);
        return;
      }
      render(context, check);
    });
}

export async function readUnattended(
  home: string,
  project: string,
  agent: string,
): Promise<UnattendedInput> {
  const [rules, health] = await Promise.all([
    policySetInForce(home),
    readHealth(home, project),
  ]);
  const { radius } = agentBoundary({ policies: rules.policies, agent });
  return {
    agent,
    enforcing: health.mode === ENFORCEMENT_MODE.ENFORCE,
    radius,
    waiting: health.waitingApprovals,
    paused: health.pausedSessions,
    spentBudgets: health.spentBudgets,
  };
}

function render(context: CliContext, check: UnattendedCheck): void {
  const { flow, style } = context;
  const { radius } = check;
  flow.open('memnox unattended');
  flow.rows(`If ${check.agent} runs on its own`, [
    { label: 'on its own', value: String(radius.automatic) },
    { label: 'waits for you', value: String(radius.needsApproval) },
    { label: 'never', value: String(radius.never) },
    { label: 'no rule', value: String(radius.ungoverned) },
  ]);
  if (check.canLeave) {
    flow.close(style.ok(`You can leave ${check.agent} running.`));
    return;
  }
  flow.list(
    'Settle these first',
    check.concerns.map((text) => ({ text })),
  );
  flow.close(
    style.warn(
      `${check.concerns.length} ${check.concerns.length === 1 ? 'thing needs' : 'things need'} you before ${check.agent} is left alone.`,
    ),
  );
  flow.hint(`memnox next --agent ${check.agent}   the whole boundary, action by action`);
}

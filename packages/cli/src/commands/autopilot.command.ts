/**
 * `memnox autopilot`: what the daemon handed each agent on its own record, until when, and
 * the way to take one back. Turning it on is `memnox config set autopilot true`.
 */
import { homedir } from 'node:os';

import type { Command } from 'commander';

import {
  describeAllowance,
  EarnedAllowances,
  inForceAt,
  readAutopilot,
  type Allowance,
} from '@memnox/core';

import type { CliContext } from '../cli-context';

interface AutopilotOptions {
  list?: boolean;
  revoke?: string;
}

export function registerAutopilotCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
): void {
  program
    .command('autopilot')
    .description('What the autopilot handed your agents, and taking it back')
    .option('--list', 'what it has granted (the default)')
    .option('--revoke <id>', 'take one grant back now')
    .action(async (options: AutopilotOptions) => runAutopilot(context, home(), options));
}

async function runAutopilot(
  context: CliContext,
  home: string,
  options: AutopilotOptions,
): Promise<void> {
  context.flow.open('memnox autopilot');
  const store = new EarnedAllowances(home);
  const now = new Date().toISOString();
  if (options.revoke !== undefined) {
    const revoked = await store.revoke(options.revoke, now);
    context.flow.close(
      revoked === null
        ? `No grant ${options.revoke}.`
        : `${options.revoke} is taken back: ${revoked.actions.join(', ')} asks again.`,
    );
    return;
  }
  const on = await readAutopilot(home);
  const grants = await store.all();
  const standing = grants.filter((each) => inForceAt(each, now));
  for (const grant of standing) context.flow.rows(grant.id, rowsOf(grant));
  context.flow.close(
    on
      ? `The autopilot is on. ${standing.length} grant(s) in force.`
      : `The autopilot is off. ${standing.length} grant(s) still in force from when it was on.`,
  );
  if (!on) context.flow.hint('memnox config set autopilot true   turn it on');
}

function rowsOf(grant: Allowance): { label: string; value: string }[] {
  return [
    { label: 'agent', value: (grant.agents ?? []).join(', ') },
    { label: 'action', value: grant.actions.join(', ') },
    { label: 'targets', value: (grant.targets ?? []).join(', ') },
    { label: 'says', value: describeAllowance(grant) },
  ];
}

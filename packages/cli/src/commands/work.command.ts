/** `memnox work` and `memnox handoff`: a person pointing agents at tracker issues and answering their handoffs. */
import { homedir } from 'node:os';
import type { Command } from 'commander';
import { HANDOFF_ANSWER_WORD } from '@memnox/core';
import type { CliContext } from '../cli-context';
import {
  runAnswerHandoff,
  runFinishWork,
  runListWork,
  runShowWork,
  runStartWork,
  type StartOptions,
  type WorkDeps,
} from './work/run-work';

/** The issue stays in its tracker; Memnox keeps a reference and who carries it. */
export function registerWorkCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
): void {
  const deps: WorkDeps = { context, home };
  const work = program
    .command('work')
    .description('Point an agent at an issue in your tracker, and see how it is going');
  work
    .command('start <profile> <issue>')
    .description(
      'Have the agent under a profile carry LIN-123, a Jira key or an issue link',
    )
    .option('--tracker <name>', 'linear, jira, github or asana, for a bare key')
    .option('--title <words>', 'a title to show beside the key')
    .option('--project <path>', 'the repository it is scoped to, absolute')
    .action(async (profile: string, issue: string, options: StartOptions) =>
      runStartWork(deps, { profile, target: issue }, options),
    );
  work
    .command('list')
    .description('Every piece of agent work')
    .action(async () => runListWork(deps));
  work
    .command('show <id>')
    .description('One piece of work with its latest progress')
    .action(async (id: string) => runShowWork(deps, id));
  work
    .command('stop <id>')
    .description('Stop it, whatever the agent said')
    .action(async (id: string) => runFinishWork(deps, id, 'stop'));
  work
    .command('close <id>')
    .description('Close it as done')
    .action(async (id: string) => runFinishWork(deps, id, 'close'));
  registerHandoffCommand(program, deps);
}

function registerHandoffCommand(program: Command, deps: WorkDeps): void {
  const handoff = program
    .command('handoff')
    .description('Answer an agent asking to hand its work on');
  handoff
    .command('accept <id>')
    .description('Hand the work on as asked')
    .action(async (id: string) => runAnswerHandoff(deps, id, HANDOFF_ANSWER_WORD.ACCEPT));
  handoff
    .command('decline <id>')
    .description('Keep the work where it is')
    .action(async (id: string) =>
      runAnswerHandoff(deps, id, HANDOFF_ANSWER_WORD.DECLINE),
    );
}

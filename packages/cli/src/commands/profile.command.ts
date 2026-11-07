/** `memnox profile`: the jobs agents do here, and which agent does which. */
import { homedir } from 'node:os';
import type { Command } from 'commander';
import type { CliContext } from '../cli-context';
import {
  runBindProfile,
  runNewProfile,
  runShowProfile,
  runUnbindProfile,
  type NewProfileOptions,
  type ProfileDeps,
} from './profile/run-profile';

/** Binding is a person's act at a terminal, never something an agent or setup does unasked. */
export function registerProfileCommand(
  program: Command,
  context: CliContext,
  home: () => string = homedir,
): void {
  const deps: ProfileDeps = { context, home };
  const profile = program
    .command('profile')
    .description('The jobs your agents do, and which agent does which');
  profile
    .command('new <name>')
    .description('Write a job down; it grants nothing until it is applied or bound')
    .option('--purpose <sentence>', 'the job in a sentence')
    .option('--role <name>', 'matched by roles: for sessions of an agent bound to it')
    .option('--responsible <person>', 'who answers for it; you by default')
    .option('--instructions <text>', 'standing words for every session under it')
    .action(async (name: string, options: NewProfileOptions) =>
      runNewProfile(deps, name, options),
    );
  profile
    .command('show [name]')
    .description('Every profile, or one, with the agents it is connected through')
    .action(async (name: string | undefined) => runShowProfile(deps, name));
  profile
    .command('bind <profile> <agent>')
    .description('Have one agent found here work under a profile')
    .action(async (name: string, agent: string) => runBindProfile(deps, name, agent));
  profile
    .command('unbind <agent>')
    .description('Put an agent back on its default profile')
    .action(async (agent: string) => runUnbindProfile(deps, agent));
}

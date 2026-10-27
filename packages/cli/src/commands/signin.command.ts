/**
 * `memnox signin` and `signout`: you, apart from the machine `memnox login` enrols. The machine's
 * credential pulls the rules; this one lets what is routed to you reach this terminal and the voice.
 */

import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from 'commander';
import { EXIT, readAccount } from '@memnox/core';
import type { CliContext } from '../cli-context';
import { openBrowser } from '../sync/browser';
import { DEFAULT_BASE_URL } from '../sync/connect';
import { claimDeviceSpace } from '../sync/device-space';
import {
  awaitPerson,
  enrolPerson,
  readPerson,
  requestPersonCode,
  signOutPerson,
} from '../sync/person';

interface SignInDeps {
  home: () => string;
  open: (url: string) => Promise<boolean>;
}

export function registerSignInCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<SignInDeps> = {},
): void {
  const deps: SignInDeps = { home: homedir, open: openBrowser, ...overrides };
  program
    .command('signin')
    .description(
      'Sign in as yourself, so what your workspace routes to you reaches this terminal. "login" is the machine; this is you',
    )
    .option('--url <base>', 'the control plane')
    .action(async (options: { url?: string }) => {
      context.flow.open('memnox signin');
      process.exitCode = await runSignIn(context, deps, options.url);
      context.flow.end();
    });
  program
    .command('signout')
    .description('Sign yourself out, and revoke this terminal on the control plane')
    .action(async () => {
      context.flow.open('memnox signout');
      const person = await readPerson(deps.home());
      if (person === null) return context.flow.close('Nobody is signed in here.');
      await signOutPerson(deps.home(), person);
      context.flow.close(`Signed ${person.name} out of this terminal.`);
      context.flow.hint(
        'This machine stays enrolled; "memnox logout" is the one that takes it off.',
      );
    });
}

async function runSignIn(
  context: CliContext,
  deps: SignInDeps,
  url?: string,
): Promise<number> {
  const { flow } = context;
  const account = await readAccount(deps.home());
  const baseUrl = url ?? account?.baseUrl ?? DEFAULT_BASE_URL;
  if (await alreadySignedIn(context, deps, baseUrl)) return EXIT.OK;
  try {
    const code = await requestPersonCode(baseUrl);
    const page = code.verificationUriComplete ?? code.verificationUri;
    const opened = page === undefined ? false : await deps.open(page);
    if (page !== undefined)
      flow.step(opened ? 'Approve it in your browser' : 'Approve it at', page);
    flow.value('Your code', code.userCode);
    flow.aside(
      `Waiting for your approval… the code is good for ${minutesLeft(code.expiresAt)} minutes.`,
    );
    const granted = await awaitPerson(baseUrl, code, (ms) => sleep(ms));
    const person = await enrolPerson(deps.home(), baseUrl, granted);
    // What this Mac connected before any account becomes the person's, so nothing is connected twice.
    const claimed = await claimDeviceSpace(deps.home()).catch(() => null);
    flow.close(`Signed in as ${person.name}.`);
    if (claimed?.connections !== undefined && claimed.connections > 0)
      flow.hint(
        `${claimed.connections} app${claimed.connections === 1 ? '' : 's'} this Mac had connected moved into your account`,
      );
    flow.hint(
      'memnox inbox   lists what is waiting on you, here and from your workspace',
    );
    flow.hint('memnox approve or memnox deny answers one');
    return EXIT.OK;
  } catch (err) {
    flow.fail(err instanceof Error ? err.message : String(err));
    return EXIT.FAILED;
  }
}

/** A second sign in to the same control plane is said rather than minting a second credential. */
async function alreadySignedIn(
  context: CliContext,
  deps: SignInDeps,
  baseUrl: string,
): Promise<boolean> {
  const already = await readPerson(deps.home());
  if (already === null || already.baseUrl !== baseUrl) return false;
  context.flow.close(`Already signed in as ${already.name}.`);
  context.flow.hint(
    'memnox signout   signs out, and memnox inbox lists what is waiting on you',
  );
  return true;
}

/** Said in whole minutes, as the login rail says it, so the two sign ins read alike. */
function minutesLeft(expiresAt: number): number {
  return Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
}

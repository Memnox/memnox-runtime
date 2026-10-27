/**
 * `memnox voice`: the key the Mac app signs its confirmations with. Trusted on first use and
 * never replaced through the daemon, so clearing it is a person's step at a terminal.
 */
import { homedir } from 'node:os';

import type { Command } from 'commander';

import { ConfirmKeys } from '@memnox/core';

import type { CliContext } from '../cli-context';
import { confirmOnTerminal, type Confirm } from '../confirm';
import { forgetHeardWord, readHeardWords } from '../operator/heard-words';
import { keepAddress, keepOwner, readAddress, readOwner } from '../operator/owner';

interface VoiceDeps {
  home: () => string;
  confirm: Confirm;
}

export function registerVoiceCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<VoiceDeps> = {},
): void {
  const deps: VoiceDeps = { home: homedir, confirm: confirmOnTerminal, ...overrides };
  const voice = program
    .command('voice')
    .description('The key the Mac app confirms with, and how the voice addresses you')
    .action(async () => runKey(context, deps));
  voice
    .command('forget-key')
    .description('Clear the confirmation key, so the Mac app can register its own again')
    .option('--yes', 'clear it without asking')
    .action(async (options: { yes?: boolean }) => runForget(context, deps, options));
  voice
    .command('words')
    .description(
      'The words the voice learned it mishears you saying, and what you meant by each',
    )
    .option('--forget <heard>', 'forget one, by how it was heard')
    .action(async (options: { forget?: string }) =>
      runWords(context, deps, options.forget),
    );
  voice
    .command('address')
    .description('How the voice addresses you, such as "sir", "ma\'am" or your name')
    .argument('[words...]', 'the words to use; nothing shows the current one')
    .option('--clear', 'use no form of address at all')
    .action(async (words: string[], options: { clear?: boolean }) =>
      runAddress(context, deps, words, options.clear === true),
    );
  voice
    .command('name')
    .description(
      'Your name, which the voice keeps for a greeting and says far less often than the address',
    )
    .argument('[words...]', 'your name; nothing shows the current one')
    .action(async (words: string[]) => runName(context, deps, words));
}

/** Kept in this person's own home, so each person on a shared Mac sees only their own. */
async function runWords(
  context: CliContext,
  deps: VoiceDeps,
  forget: string | undefined,
): Promise<void> {
  const { flow } = context;
  flow.open('memnox voice words');
  if (forget !== undefined) {
    const gone = await forgetHeardWord(deps.home(), forget);
    flow.close(gone ? `Forgot "${forget}".` : `Nothing was learned for "${forget}".`);
    return;
  }
  const words = await readHeardWords(deps.home());
  if (words.length === 0) {
    flow.close(
      'Nothing learned yet. Correct the voice when it mishears you, and it remembers.',
    );
    return;
  }
  flow.rows(
    'Heard as, meant',
    words.map((each) => ({ label: each.heard, value: each.meant })),
  );
  flow.close(
    `${words.length} learned. Forget one with memnox voice words --forget "<heard>".`,
  );
}

async function runName(
  context: CliContext,
  deps: VoiceDeps,
  words: readonly string[],
): Promise<void> {
  const { flow } = context;
  flow.open('memnox voice name');
  if (words.length > 0) await keepOwner(deps.home(), words.join(' '));
  const kept = await readOwner(deps.home());
  flow.close(
    kept === undefined
      ? 'The voice does not know your name.'
      : `The voice knows you as ${kept} from its next conversation.`,
  );
}

/** Chosen by the person, never guessed from a name, since a wrong "sir" or "ma'am" misgenders them. */
async function runAddress(
  context: CliContext,
  deps: VoiceDeps,
  words: readonly string[],
  clear: boolean,
): Promise<void> {
  const { flow } = context;
  flow.open('memnox voice address');
  if (!clear && words.length === 0) {
    const current = await readAddress(deps.home());
    flow.close(
      current === undefined
        ? 'The voice uses no form of address.'
        : `The voice addresses you as "${current}".`,
    );
    return;
  }
  const kept = await keepAddress(deps.home(), clear ? null : words.join(' '));
  flow.close(
    kept === null
      ? 'The voice uses no form of address from its next conversation.'
      : `The voice addresses you as "${kept}" from its next conversation.`,
  );
}

async function runKey(context: CliContext, deps: VoiceDeps): Promise<void> {
  const { flow } = context;
  flow.open('memnox voice');
  const key = await new ConfirmKeys(deps.home()).read();
  if (key === null) {
    flow.close(
      'No confirmation key is registered, so nothing can be allowed by voice yet.',
    );
    flow.hint('Open the Memnox app on this Mac and it registers its own.');
    return;
  }
  flow.rows('Confirmation key', [
    { label: 'registered', value: key.registeredAt },
    { label: 'key', value: `P-256, ending ${key.point.slice(-8)}` },
  ]);
  flow.close('Allows by voice are signed with this key, and nothing else is accepted.');
}

async function runForget(
  context: CliContext,
  deps: VoiceDeps,
  options: { yes?: boolean },
): Promise<void> {
  const { flow } = context;
  flow.open('memnox voice forget-key');
  const keys = new ConfirmKeys(deps.home());
  if ((await keys.read()) === null) {
    flow.close('No confirmation key is registered, so there is nothing to clear.');
    return;
  }
  // No by default, since whichever key registers next is the one trusted.
  const sure =
    options.yes === true ||
    (await deps.confirm(
      'Clear the confirmation key? The next key to register is trusted, so open the Memnox app right after.',
      false,
    ));
  if (!sure) {
    flow.close('Kept the key as it was.');
    return;
  }
  await keys.forget();
  flow.close('Cleared. Open the Memnox app now, so its key is the one registered.');
}

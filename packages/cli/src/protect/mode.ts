import { homedir } from 'node:os';
import {
  ENFORCEMENT_MODE,
  loadOrCreateConfig,
  saveConfig,
  type EnforcementMode,
} from '@memnox/core';
import type { CliContext } from '../cli-context';

/** What setting the mode moved: where this machine was and where it is now. */
interface ModeSet {
  was: EnforcementMode;
  now: EnforcementMode;
}

/** One line in `config.toml`, shared by the terminal and the daemon so both change the mode the same way. */
export async function setMode(home: string, mode: EnforcementMode): Promise<ModeSet> {
  const config = await loadOrCreateConfig(home);
  await saveConfig(home, { ...config, mode });
  return { was: config.mode, now: mode };
}

/**
 * Moving this machine between observe and enforce, one line in `config.toml`. It prints
 * what the mode was too, because somebody flipping this switch needs to see it move.
 */
export async function runMode(context: CliContext, enforce: boolean): Promise<void> {
  const { flow } = context;
  const mode: EnforcementMode = enforce
    ? ENFORCEMENT_MODE.ENFORCE
    : ENFORCEMENT_MODE.OBSERVE;
  const set = await setMode(homedir(), mode);

  flow.rows('Mode', [
    { label: 'was', value: set.was },
    { label: 'now', value: mode },
    {
      label: 'means',
      value: enforce ? 'verdicts bite' : 'verdicts are recorded and nothing is denied',
    },
  ]);
  flow.close(`This machine is in ${mode}.`);
  flow.hint(
    enforce
      ? '"memnox protect --observe" puts it back.'
      : '"memnox protect --enforce" makes verdicts bite.',
  );
}

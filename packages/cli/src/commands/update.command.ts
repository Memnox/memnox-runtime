/**
 * `memnox update`: the version here against the latest published, the upgrade for how this
 * copy was installed run only after a yes, then the wiring again through the new install.
 */
import { homedir } from 'node:os';
import { Option, type Command } from 'commander';
import { EXIT } from '@memnox/core';
import type { CliContext } from '../cli-context';
import { confirmOnTerminal, type Confirm } from '../confirm';
import { CLI_VERSION } from '../defaults';
import { readKept } from '../keeper/kept';
import { wireMachine, type Wiring } from '../setup-wiring';
import {
  installOf,
  isNewer,
  latestPublished,
  pinnedTo,
  recordUpdate,
  rewireThroughNewInstall,
  runAttached,
  runningEntry,
  verifyRelease,
  type Install,
  type UpdateRecord,
} from './update/install';
import type { Verdict } from './update/provenance';

/** Every outside effect, so a test touches no network and runs no package manager. */
export interface UpdateDeps {
  home: () => string;
  project: () => string;
  installed: () => string;
  latest: () => Promise<string | null>;
  install: () => Install;
  confirm: Confirm;
  run: (command: readonly string[]) => Promise<boolean>;
  /** Who built the release, checked before it is installed rather than trusted after. */
  verify: (version: string) => Promise<Verdict>;
  record: (home: string, record: UpdateRecord) => Promise<void>;
  now: () => Date;
  /** The wiring, run by the upgraded copy rather than this one, which is the old code. */
  rewire: () => Promise<boolean>;
  wire: (home: string, project: string) => Promise<Wiring>;
}

/** The versions and the upgrade, read once, so each step below is a plain branch. */
interface UpdatePlan {
  installed: string;
  latest: string;
  install: Install;
  /** Set only by `--skip-verify`, which is said on screen and kept in the record. */
  skipVerify: boolean;
}

interface UpdateOptions {
  rewire?: boolean;
  yes?: boolean;
  skipVerify?: boolean;
}

export function registerUpdateCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<UpdateDeps> = {},
): void {
  const deps: UpdateDeps = {
    home: homedir,
    project: () => process.cwd(),
    installed: () => CLI_VERSION,
    latest: latestPublished,
    install: () => installOf(runningEntry()),
    confirm: confirmOnTerminal,
    run: runAttached,
    verify: verifyRelease,
    record: recordUpdate,
    now: () => new Date(),
    rewire: rewireThroughNewInstall,
    // The rules are left alone: an upgrade changes the program, never what it enforces.
    wire: (home, project) => wireMachine(home, project, { rules: async () => 0 }),
    ...overrides,
  };
  program
    .command('update')
    .description('Update Memnox to the latest version, and rewire this machine to it')
    .option(
      '-y, --yes',
      'update without asking, as the Mac app does for a daemon too old for it',
    )
    .option(
      '--skip-verify',
      'install without checking the release was built by the Memnox repository',
    )
    .addOption(new Option('--rewire', 'rewire this machine to this install').hideHelp())
    .action(async (options: UpdateOptions) => {
      if (options.rewire === true) return runRewire(context, deps);
      return runUpdate(
        context,
        options.yes === true ? { ...deps, confirm: async () => true } : deps,
        options.skipVerify === true,
      );
    });
}

async function runUpdate(
  context: CliContext,
  deps: UpdateDeps,
  skipVerify: boolean,
): Promise<void> {
  const { flow, style } = context;
  flow.open('memnox update');
  const installed = deps.installed();
  const install = deps.install();
  const latest = await deps.latest();
  if (latest === null) {
    flow.rows('Memnox', [{ label: 'installed', value: installed }]);
    flow.close(
      style.warn('The latest version could not be looked up, so nothing changed.'),
    );
    flow.hint(`Online again, run "memnox update", or update by hand: ${install.display}`);
    return;
  }
  flow.rows('Memnox', [
    { label: 'installed', value: installed },
    { label: 'latest', value: latest },
    { label: 'installed with', value: install.method },
  ]);
  if (!isNewer(latest, installed)) {
    flow.close(style.ok(`This is the latest version, ${installed}.`));
    return;
  }
  await upgrade(context, deps, { installed, latest, install, skipVerify });
}

/** Asks, runs the upgrade, then rewires; each step that does not happen says what would. */
async function upgrade(
  context: CliContext,
  deps: UpdateDeps,
  plan: UpdatePlan,
): Promise<void> {
  const { flow, style } = context;
  const { display } = plan.install;
  if (plan.install.command === null) {
    flow.close(`Memnox ${plan.latest} is out. Update with:`);
    flow.hint(display);
    return;
  }
  const command = pinnedTo(plan.install.command, plan.latest);
  const wanted = await deps.confirm(
    `Update Memnox ${plan.installed} to ${plan.latest} with "${command.join(' ')}"?`,
  );
  if (!wanted) {
    flow.close('Nothing was changed.');
    flow.hint(`Update later with "memnox update", or by hand: ${display}`);
    return;
  }
  if (!(await verified(context, deps, plan))) return;
  if (!(await deps.run(command))) {
    flow.close(
      style.warn('The update did not finish, so this is still the old version.'),
    );
    flow.hint(`Run it by hand to see why: ${display}`);
    return;
  }
  const setUp = (await readKept(deps.home())) !== null;
  const rewired = setUp && (await deps.rewire());
  flow.close(style.ok(`Memnox is now ${plan.latest}.`));
  if (setUp && !rewired)
    flow.hint('"memnox setup" points the hooks and the service at it.');
}

/** The release is checked before it runs anywhere; a check skipped is said aloud and kept. */
async function verified(
  context: CliContext,
  deps: UpdateDeps,
  plan: UpdatePlan,
): Promise<boolean> {
  const { flow, style } = context;
  const record = { at: deps.now().toISOString(), from: plan.installed, to: plan.latest };
  if (plan.skipVerify) {
    flow.step(
      style.warn('Not verified'),
      `--skip-verify: nothing checked that ${plan.latest} was built by the Memnox repository`,
    );
    await deps.record(deps.home(), { ...record, verified: false });
    return true;
  }
  const verdict = await deps.verify(plan.latest);
  if (!verdict.ok) {
    flow.close(
      style.warn(`Memnox ${plan.latest} was not installed, because ${verdict.reason}.`),
    );
    flow.hint(
      'Installing it anyway is "memnox update --skip-verify", which is kept on the record.',
    );
    process.exitCode = EXIT.FAILED;
    return false;
  }
  flow.step(
    'Verified',
    `${verdict.checked.join(', ')} built by the Memnox release workflow`,
  );
  await deps.record(deps.home(), { ...record, verified: true });
  return true;
}

/** Run by the new copy: the same wiring setup draws, idempotent, pointed at this install. */
async function runRewire(context: CliContext, deps: UpdateDeps): Promise<void> {
  const { flow, style } = context;
  flow.open('memnox update');
  const wired = await deps.wire(deps.home(), deps.project());
  flow.step(
    'Rewired this machine',
    `${wired.interceptors} interceptors, hooks and the service point at ${deps.installed()}`,
  );
  flow.close(style.ok('This machine runs the new version.'));
}

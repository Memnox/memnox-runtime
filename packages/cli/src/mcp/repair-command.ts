import { agentShown } from '@memnox/core';
import type { CliContext } from '../cli-context';
import type { Confirm } from '../confirm';
import { TONE } from '../flow';
import { checkRemotes, handBack, REMOTE_VERDICT, type CheckedRemote } from './hub-repair';
import {
  outcomeLine,
  signInServer,
  signInSteps,
  type SignInServerDeps,
} from './sign-in-command';

/**
 * `memnox mcp repair`: asks every remote server behind the proxy whether it connects, then mends the
 * ones that ask for a sign in. Signing in through Memnox comes first, since it keeps the server ruled
 * on; what that cannot mend is handed back to the agent, and only once the person says so.
 */

interface RepairCommandDeps extends SignInServerDeps {
  home: () => string;
  confirm: Confirm;
  /** Whether somebody is at the terminal to be asked. */
  interactive: () => boolean;
}

export interface RepairOptions {
  yes?: boolean;
  dryRun?: boolean;
}

/** What asking each remote server came to, in the words a person reads on one line. */
const VERDICT_LINE: Readonly<Record<string, string>> = {
  [REMOTE_VERDICT.WORKING]: 'connects through Memnox',
  [REMOTE_VERDICT.SIGN_IN]: 'needs a sign in',
  [REMOTE_VERDICT.CREDENTIAL]:
    'refused the secret Memnox holds for it, so replace that secret on its card in the MCP Hub',
  [REMOTE_VERDICT.UNREACHABLE]: 'did not answer, so check its address and your network',
};

const SIGN_IN_QUESTION = 'Sign in now, one at a time?';

/** Asked before anything is handed back, since a server handed back is one Memnox stops ruling on. */
const HAND_BACK_QUESTION = 'Hand them back to your agents?';

const RECONNECT = 'Restart your agent, or reconnect each server in it.';

/** Added where a server was handed back, which the agent then signs in to and Memnox no longer rules on. */
const SIGN_IN_THERE =
  'In the agent, sign in when it asks for a server that was handed back. Memnox no longer rules on that server.';

export async function runRepair(
  context: CliContext,
  deps: RepairCommandDeps,
  options: RepairOptions,
): Promise<void> {
  const { flow, style } = context;
  flow.open('memnox mcp repair');
  const checked = await checkRemotes(deps.home(), {
    ...(deps.secrets === undefined ? {} : { secrets: deps.secrets }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  if (checked.length === 0) {
    flow.close('No remote server here is behind Memnox, so there is nothing to repair.');
    return;
  }
  renderChecked(context, checked);
  const mendable = checked.filter(
    (each) => each.verdict === REMOTE_VERDICT.SIGN_IN && each.locked === undefined,
  );
  if (mendable.length === 0) {
    flow.close(
      checked.every((each) => each.verdict === REMOTE_VERDICT.WORKING)
        ? style.ok('Every one connects, so nothing was changed.')
        : 'None of these is mended by a sign in, so nothing was changed.',
    );
    return;
  }
  if (options.dryRun === true) {
    flow.close(
      `${mendable.length} server(s) can be mended by a sign in. Nothing was changed.`,
    );
    return;
  }
  const signedIn = await signInFirst(context, deps, { options, mendable });
  const rest = mendable.filter((each) => !signedIn.includes(each.name));
  const handed = await handBackRest(context, deps, { options, rest });
  flow.close(summary(style, signedIn.length, handed));
  if (signedIn.length + (handed ?? 0) === 0) return;
  flow.hint((handed ?? 0) > 0 ? `${RECONNECT} ${SIGN_IN_THERE}` : RECONNECT);
}

function renderChecked(context: CliContext, checked: readonly CheckedRemote[]): void {
  context.flow.list(
    'Remote servers behind Memnox',
    checked.map((each) => ({
      tone: each.verdict === REMOTE_VERDICT.WORKING ? TONE.OK : TONE.WARN,
      text: `${each.name}  ${VERDICT_LINE[each.verdict] ?? each.verdict}`,
      detail: [agentsLine(each), each.locked],
    })),
  );
}

function agentsLine(remote: CheckedRemote): string | undefined {
  if (remote.agents.length === 0) return undefined;
  return `used by ${named([...new Set(remote.agents.map(agentShown))])}`;
}

interface Mending {
  options: RepairOptions;
  mendable: readonly CheckedRemote[];
}

/** The names in a sentence, as a person would list them. */
function named(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * Each server signed in to through Memnox, one at a time, each told as it goes and its outcome said
 * before the next begins, and the names that connected. Skipped with nobody at the terminal, since a
 * sign in needs a person, and under --yes, which asks for the hand back.
 */
async function signInFirst(
  context: CliContext,
  deps: RepairCommandDeps,
  { options, mendable }: Mending,
): Promise<string[]> {
  if (options.yes === true || !deps.interactive()) return [];
  const { flow } = context;
  const names = mendable.map((each) => each.name);
  flow.aside(
    `${named(names)} ${names.length === 1 ? 'needs' : 'need'} you to sign in before ${names.length === 1 ? 'it connects' : 'they connect'}. Memnox can do it now, in your browser, and keep ${names.length === 1 ? 'it' : 'them'} governed.`,
  );
  if (!(await deps.confirm(`${flow.prompt}${SIGN_IN_QUESTION}`, true))) return [];
  const connected: string[] = [];
  for (const [index, name] of names.entries()) {
    flow.step(`${index + 1} of ${names.length}  ${name}`);
    const done = await signInServer(
      deps.home(),
      name,
      deps,
      signInSteps(context, name, deps.skip !== undefined),
    );
    flow.aside(outcomeLine(context, name, done));
    if ('signedIn' in done || 'already' in done) connected.push(name);
  }
  return connected;
}

/** How many were handed back, or null where the person was not asked or said no. */
async function handBackRest(
  context: CliContext,
  deps: RepairCommandDeps,
  { options, rest }: { options: RepairOptions; rest: readonly CheckedRemote[] },
): Promise<number | null> {
  if (rest.length === 0) return 0;
  const { flow } = context;
  if (options.yes !== true) {
    if (!deps.interactive()) {
      flow.aside(
        `${rest.length} server(s) can be handed back. Run "memnox mcp repair --yes" to do it, or run it at a terminal to sign in through Memnox.`,
      );
      return null;
    }
    flow.aside(
      `${named(rest.map((each) => each.name))} still ${rest.length === 1 ? 'needs' : 'need'} a sign in. Handed back, your agents sign in to ${rest.length === 1 ? 'it' : 'them'} themselves, and Memnox no longer rules on ${rest.length === 1 ? 'its' : 'their'} calls.`,
    );
    if (!(await deps.confirm(`${flow.prompt}${HAND_BACK_QUESTION}`, false))) return null;
  }
  const done = await handBack(
    deps.home(),
    rest.map((each) => each.name),
  );
  flow.list('Handed back', [
    ...done.handed.map((each) => ({
      tone: TONE.OK,
      text: `${each.name}  ${each.agents.map(agentShown).join(', ')} now reaches it and signs in itself`,
    })),
    ...done.left.map((each) => ({
      tone: TONE.WARN,
      text: `${each.name}  ${each.reason}`,
    })),
  ]);
  return done.handed.length;
}

function summary(
  style: CliContext['style'],
  signedIn: number,
  handed: number | null,
): string {
  const parts = [
    ...(signedIn > 0 ? [`${signedIn} server(s) signed in to through Memnox`] : []),
    ...(handed !== null && handed > 0 ? [`${handed} server(s) handed back`] : []),
  ];
  return parts.length === 0 ? 'Nothing was changed.' : style.ok(`${parts.join(', ')}.`);
}

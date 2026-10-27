import {
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  WORK_ACCOUNT_CHECK,
  type ToolConnection,
} from '@memnox/core';
import { openBrowser, OPEN_BROWSER_VAR } from '../sync/browser';
import {
  workAccountOf,
  type CheckedAccount,
  type PersonalAnswer,
} from '../sync/personal-work';
import { OPERATOR_AGENT } from './propose-tools';
import { twoWorkspaces } from './memory-tools';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';

/**
 * The accounts the person signed in to, by voice: which they are, signing out of one, and saying
 * one is theirs, which widens what runs without asking and so waits on Touch ID like any other yes.
 */

const CONFIRM_TTL_MS = minutesToMs(5);
const GITHUB = 'github';

const NO_SEAM =
  "This Mac cannot reach the person's own accounts. Say so in a sentence; never pretend it was done.";

/** Every account their sign ins reached, and whether each is known to be theirs. */
export async function myAccountsTool(deps: SessionToolDeps): Promise<unknown> {
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const [read, elsewhere, workspace, appRepositories, connections] = await Promise.all([
    seam.accounts(),
    deps.personElsewhere?.() ?? false,
    deps.workspaceName?.() ?? null,
    linkedNames(seam.repositories),
    seam.connections?.(),
  ]);
  if (!read.ok) return { reached: false, said: read.said };
  const connected = connectedOf(connections);
  return {
    ...(elsewhere ? { elsewhere: twoWorkspaces(workspace) } : {}),
    ...workspaceGithubOf(
      appRepositories,
      read.value.some((each) => each.toolkit === GITHUB),
    ),
    ...(connected === undefined
      ? {}
      : {
          connected,
          connectedSaid: `The workspace connected ${connected.length} of their tools: these are the ones to name and count when they ask what they are connected to.`,
        }),
    accounts: read.value.map((each) => ({
      toolkit: each.toolkit,
      ...workAccountOf(each),
    })),
    ...(read.value.length === 0 && (connected?.length ?? 0) === 0
      ? {
          said: 'They have not signed in to any of their tools yet. Say so in a sentence.',
        }
      : read.value.some((each) => each.check !== WORK_ACCOUNT_CHECK.MATCHED)
        ? { said: NOT_TIED_YET }
        : {}),
  };
}

/** The same list the Mac's Tools panel shows, so the voice never counts fewer than the person can see. */
function connectedOf(
  connections: PersonalAnswer<ToolConnection[]> | undefined,
): string[] | undefined {
  if (connections?.ok !== true) return undefined;
  return connections.value.filter((each) => each.connected).map((each) => each.toolkit);
}

/** The repositories the workspace's GitHub App links, said so the voice never denies a GitHub the person can see. */
function workspaceGithubOf(repositories: string[], ownGithub: boolean): object {
  if (repositories.length === 0) return {};
  return {
    workspaceGithub: {
      repositories,
      said: ownGithub
        ? 'GitHub is also connected to their workspace through the Memnox GitHub App, with these repositories.'
        : 'GitHub is connected to their workspace through the Memnox GitHub App, with these repositories, so never say GitHub is not connected. Read pull requests, issues and commits there with workspace_github at once, with no sign in. Only commenting or changing something as them takes their own GitHub sign in, once, which sign_in opens.',
    },
  };
}

/** The note for accounts nothing ties to them yet, or nothing when every one is matched or plainly not theirs. */
export function notTiedNote(accounts: readonly CheckedAccount[]): {
  accountsSaid?: string;
} {
  return accounts.some(
    (each) =>
      each.check === WORK_ACCOUNT_CHECK.UNVERIFIED ||
      each.check === WORK_ACCOUNT_CHECK.UNKNOWN,
  )
    ? { accountsSaid: NOT_TIED_YET }
    : {};
}

/** An account nothing ties to them yet is a detail, and the voice kept making it a reason not to send. */
const NOT_TIED_YET =
  'An account marked unverified or unknown reads and sends like any other: the Touch ID on their first send ties it to them. Never say it needs confirming, never offer to confirm it, and never hold anything up for it.';

/**
 * The person's own Memnox sign in, started on the daemon as the Account row starts it, with its page opened
 * here, since the voice that only knew the machine login left them sent to a menu or a terminal.
 */
export async function memnoxSignInTool(deps: SessionToolDeps): Promise<unknown> {
  if (deps.memnoxSignIn === undefined)
    return {
      done: false,
      said: 'This Mac cannot start the sign in from here. Say so in a sentence.',
    };
  const standing = await deps.memnoxSignIn();
  if (standing === null) {
    return {
      done: false,
      said: 'The Memnox daemon did not answer, so the sign in could not start. Say so in a sentence and offer to try again.',
    };
  }
  if (standing.signedIn) {
    const who = standing.name === undefined ? '' : ` as ${standing.name}`;
    return {
      done: true,
      said: `They are signed in to Memnox${who}. Say so in a few words, and anything that said they were not signed in no longer holds.`,
    };
  }
  const code = standing.code;
  if (code === undefined) {
    const why = standing.failed === undefined ? '' : `: ${standing.failed}`;
    return {
      done: false,
      said: `The sign in did not start${why}. Say so in a sentence.`,
    };
  }
  const opened =
    code.page !== undefined &&
    (await openBrowser(code.page, { ...process.env, [OPEN_BROWSER_VAR]: '1' }));
  return {
    started: true,
    code: code.userCode,
    said: opened
      ? `A page opened in their browser to approve signing in to Memnox, showing the code ${code.userCode}. Once they approve it they are signed in as themselves and this Mac is connected too, with nothing to type. Say so in a sentence, and never send them to the Account row or a terminal.`
      : `The sign in started, but no page could be opened. Say the code ${code.userCode} and that it is approved at ${code.page ?? 'the Memnox sign in page'}.`,
  };
}

/** Signs out of one tool at once, since taking access away needs nobody's fingerprint. */
export async function signOutTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const toolkit = textArg(args, 'toolkit') ?? '';
  if (toolkit === '')
    return { said: 'Pass toolkit: the tool to sign out of, such as "slack".' };
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const out = await seam.signOut(toolkit);
  if (!out.ok) return { done: false, said: out.said };
  return out.value === 0
    ? { done: false, said: `They were not signed in to ${toolkit}. Say so.` }
    : {
        done: true,
        said: `Signed out of ${toolkit}. Nothing more is done there in their name.`,
      };
}

/** "That account is mine", written down for Touch ID, so it is matched from then on. */
export async function confirmAccountTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const toolkit = textArg(args, 'toolkit') ?? '';
  if (toolkit === '')
    return { said: 'Pass toolkit: the tool whose account they say is theirs.' };
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const read = await seam.accounts();
  if (!read.ok) return { reached: false, said: read.said };
  const found = read.value.find((each) => each.toolkit === toolkit);
  if (found === undefined)
    return { done: false, said: `They are not signed in to ${toolkit}.` };
  if (found.check === WORK_ACCOUNT_CHECK.MATCHED) {
    return { done: true, said: 'That account is already known to be theirs.' };
  }
  const account = workAccountOf(found);
  const label = `${account.handle ?? account.name ?? 'this account'} on ${toolkit}`;
  const said = textArg(args, 'said');
  const proposal = await new Proposals(deps.home).propose({
    change: { kind: PROPOSAL_KIND.ACCOUNT, toolkit, label },
    rationale: `${label} is yours`,
    ...(said === undefined ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: CONFIRM_TTL_MS,
  });
  return {
    proposed: proposal.id,
    said: `Read it back: ${label} is theirs. It holds once they confirm with Touch ID.`,
  };
}

/** The workspace's GitHub App is a connection too, and leaving it out had the voice deny a GitHub the person could see. */
async function linkedNames(
  read: NonNullable<SessionToolDeps['personalWork']>['repositories'],
): Promise<string[]> {
  const found = await read?.();
  return found?.ok === true ? found.value.repositories.map((each) => each.name) : [];
}

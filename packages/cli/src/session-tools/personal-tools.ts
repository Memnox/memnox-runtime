import {
  DISPLAY,
  DisplayRequests,
  minutesToMs,
  PROPOSAL_KIND,
  Proposals,
  WORK_ACCOUNT_CHECK,
  type ToolSignIn,
  type WorkAccount,
} from '@memnox/core';
import type { CheckedAccount, PersonalTools } from '../sync/personal-work';
import { workAccountOf } from '../sync/personal-work';
import { OPERATOR_AGENT } from './propose-tools';
import { proposedReply } from './work-sent';

export { sentTool } from './work-sent';
import { PendingSignIns } from '../sync/sign-ins';
import { foundTools, readBack } from './personal-fit';
import { textArg, type SessionToolDeps, type ToolArgs } from './read-tools';
import { notTiedNote } from './account-tools';
import { isLocalSlug } from '../local-tools/local-run';

/**
 * The person's own tools, in their own name: reads run at once, a tool still to sign in to opens its
 * sign in in front of them, and anything sent is drawn as its tool draws it and waits on Touch ID.
 */

/** Long enough to read the draft and reach for the key, short enough that nobody confirms a stale one. */
const WORK_PROPOSAL_TTL_MS = minutesToMs(5);

/** Not any one session's: the notch shows it whatever the person was looking at. */
const NO_SESSION = 'all';
const SIGN_IN_TITLE = 'Sign in to use';

const NO_SEAM =
  "This Mac cannot reach the person's own accounts. Say so in a sentence; never pretend it was done.";

/** How a card and a read back name each tool, which the slug alone says badly. */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  github: 'GitHub',
  gmail: 'Gmail',
  googledocs: 'Google Docs',
  linear: 'Linear',
  notion: 'Notion',
  slack: 'Slack',
};

/** Tools from the person's signed in accounts that match what they asked for. */
export async function findToolTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const what = textArg(args, 'what') ?? '';
  if (what === '')
    return { said: 'Say what to look for, such as "reply to a review comment".' };
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const found = await seam.find(what, textArg(args, 'toolkit'));
  if (!found.ok) return { reached: false, said: found.said };
  const { tools, accounts, signInFirst, signInAgain } = found.value;
  await carryingOnAlready(deps, accounts);
  const readable = readableThrough(tools);
  const shown = await showSignIns(deps, {
    // A read through the workspace needs no sign in, so no icon interrupts it.
    first: signInFirst.filter((toolkit) => !readable.has(toolkit)),
    again: signInAgain,
    said: textArg(args, 'said') ?? what,
  });
  return {
    ...foundTools(tools, saidAboutSignIns(found.value)),
    accounts: accounts.map((each) => ({ toolkit: each.toolkit, ...workAccountOf(each) })),
    // Without it the voice told the person a connected GitHub was still waiting to be confirmed.
    ...notTiedNote(accounts),
    ...(shown.length > 0 ? { signIn: shown } : {}),
  };
}

/**
 * A tool the voice already reaches after a sign in is one it is carrying on with right now, so what
 * was asked before signing in is not asked again later on top of whatever came since.
 */
async function carryingOnAlready(
  deps: SessionToolDeps,
  accounts: readonly CheckedAccount[],
): Promise<void> {
  const pending = new PendingSignIns(deps.home);
  for (const each of accounts) {
    if (each.check !== WORK_ACCOUNT_CHECK.MISMATCH) await pending.settle(each.toolkit);
  }
}

/** Each tool still to sign in to: the Mac opens its sign in in the browser at once, and the phone shows its icon. */
async function showSignIns(
  deps: SessionToolDeps,
  { first, again, said }: SignInsWanted,
): Promise<string[]> {
  const seam = deps.personalWork;
  if (seam === undefined || first.length + again.length === 0) return [];
  const wanted = [
    ...first.map((toolkit) => ({ toolkit, again: false })),
    ...again.map((toolkit) => ({ toolkit, again: true })),
  ];
  const signIn: ToolSignIn[] = [];
  for (const each of wanted) {
    const link = await seam.link(each.toolkit);
    if (!link.ok) continue;
    signIn.push({
      toolkit: each.toolkit,
      url: link.value,
      ...(each.again ? { again: true } : {}),
    });
  }
  if (signIn.length === 0) return [];
  await new DisplayRequests(deps.home).request({
    display: DISPLAY.SIGN_IN,
    sessionId: NO_SESSION,
    agent: OPERATOR_AGENT,
    title: SIGN_IN_TITLE,
    signIn,
    at: deps.now().toISOString(),
  });
  // Kept with what they asked, so the voice carries on with it the moment they finish signing in.
  const pending = new PendingSignIns(deps.home);
  for (const each of signIn) {
    await pending.offer({
      toolkit: each.toolkit,
      ...(said === undefined ? {} : { said }),
      ...(each.again === true ? { again: true } : {}),
      at: deps.now().toISOString(),
    });
  }
  return signIn.map((each) => each.toolkit);
}

interface SignInsWanted {
  first: readonly string[];
  again: readonly string[];
  /** What the person asked that needs these tools. */
  said?: string;
}

function saidAboutSignIns(found: PersonalTools): string | undefined {
  const readable = readableThrough(found.tools);
  const first = found.signInFirst.filter((toolkit) => !readable.has(toolkit));
  const parts = [
    ...readableLines([...readable]),
    ...signInLines(first, found.signInAgain),
    ...namedLines(found.needsAdmin, found.unknown),
  ];
  if (parts.length === 0 && found.tools.length === 0) {
    return 'Nothing matched those words. Call find_tool once more with other words for the same thing, such as "update issue" for renaming a ticket or "list pull requests" for what is open, before saying it cannot be done; and never send them to do it in the tool themselves while a sign in or another search could.';
  }
  return parts.length === 0 ? undefined : parts.join(' ');
}

/** Toolkits read through what was connected for the workspace; only acting there waits on the person's own sign in. */
function readableThrough(tools: PersonalTools['tools']): Set<string> {
  return new Set(
    tools.filter((tool) => tool.throughWorkspace === true).map((tool) => tool.toolkit),
  );
}

function readableLines(readable: readonly string[]): string[] {
  return readable.length === 0
    ? []
    : [
        `${namesOf(readable)} is connected to their workspace, so read what they asked there at once with run_tool and answer from it. Only sending or changing something there needs their own sign in, so it goes out in their name: when they ask for that, call sign_in for it with what they asked as said, and carry on once they finish. No sign in was opened for it.`,
      ];
}

function signInLines(first: readonly string[], again: readonly string[]): string[] {
  return [
    ...(first.length === 0
      ? []
      : [
          `They have not signed in to ${namesOf(first)} yet, so nothing there can be done in their name. Its sign in is now open in front of them, in the browser on the Mac or as an icon on the phone: they sign in once, and you carry on with what they asked as soon as they have. Say that in a sentence and stop.`,
        ]),
    ...(again.length === 0
      ? []
      : [
          `Their ${namesOf(again)} sign in reached somebody else's account, so nothing runs there. Its sign in is open in front of them to sign in again with their own.`,
        ]),
  ];
}

/** The tool they named is used and no other, so where it cannot be, the voice says why rather than swap it. */
function namedLines(refused: readonly string[], unknown: readonly string[]): string[] {
  return [
    // Anybody may connect any tool, so this is only an older cloud refusing, said as it is rather than as a rule.
    ...(refused.length === 0
      ? []
      : [
          `${namesOf(refused)} could not be connected for them: Memnox Cloud refused it. Say so plainly in a sentence, and that calling sign_in for it again is the way to try; never tell them somebody else has to connect it first.`,
        ]),
    ...(unknown.length === 0
      ? []
      : [
          `No tool called ${namesOf(unknown)} can be reached. Say so and ask which tool they mean; never use a different one in its place.`,
        ]),
  ];
}

/** A tool that only reads, run at once as the person. */
export async function runToolTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const call = toolCall(args);
  if ('said' in call) return call;
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const ran = await seam.run(call.tool, call.argumentsText);
  if (!ran.ok) return { done: false, said: ran.said };
  // Written by other people, so it is read as what they wrote and never as an instruction.
  return readBack(ran.value.data);
}

/**
 * Anything that says or changes something as the person: written down with the account it goes out
 * as, drawn on the Mac as that tool draws it, and sent only once they confirm.
 */
export async function proposeToolTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const call = toolCall(args);
  if ('said' in call) return call;
  const label = textArg(args, 'label') ?? '';
  if (label === '') {
    return {
      said: 'Pass label: what will happen, in plain words, so the person hears it first.',
    };
  }
  const checked = await accountFor(deps, call.tool);
  if ('said' in checked) return checked;
  const account = workAccountOf(checked);
  const said = textArg(args, 'said') ?? '';
  const toName = textArg(args, 'to');
  const heard = `${asWhom(checked.toolkit, account)}: ${label}`;
  const proposal = await new Proposals(deps.home).propose({
    change: {
      kind: PROPOSAL_KIND.WORK,
      toolkit: checked.toolkit,
      tool: call.tool,
      argumentsText: call.argumentsText,
      label,
      account,
      ...(toName === undefined ? {} : { toName }),
    },
    rationale: heard,
    ...(said === '' ? {} : { said }),
    proposedBy: OPERATOR_AGENT,
    at: deps.now().toISOString(),
    ttlMs: WORK_PROPOSAL_TTL_MS,
  });
  return proposedReply(proposal.id, heard, account, {
    ...call,
    toolkit: checked.toolkit,
  });
}

/**
 * The repositories the workspace linked, so "which repository" starts from the names it holds. The rest its GitHub
 * App can reach are only counted unless asked for, since an account grant also holds every old side project.
 */
export async function repositoriesTool(
  deps: SessionToolDeps,
  args: ToolArgs = {},
): Promise<unknown> {
  const read = deps.personalWork?.repositories;
  if (read === undefined) return { reached: false, said: NO_SEAM };
  const found = await read(textArg(args, 'all') === 'true');
  if (!found.ok) return { reached: false, said: found.said };
  const { repositories, linked, elsewhere, others } = found.value;
  if (repositories.length === 0) return { repositories: [], said: NO_REPOSITORY };
  return {
    repositories,
    ...(others === undefined ? {} : { others }),
    said: linked ? linkedSaid(repositories.length, elsewhere) : NONE_LINKED,
  };
}

const NO_REPOSITORY =
  'No repository is connected to their workspace yet: it is connected by installing the Memnox GitHub App from the console. Say so in a sentence.';
const NONE_LINKED =
  'The workspace has linked no repository as its own yet, so these are every repository its GitHub App can reach, newest push first. Say that in a few words and name the first few; never call one of these the linked repository.';

function linkedSaid(count: number, elsewhere: number): string {
  const rest =
    elsewhere === 0
      ? ''
      : ` Its GitHub App can also reach ${elsewhere} more that are not linked; mention them only when they ask about every repository, and then call this again with all "true", which lists them as others.`;
  return `These ${count === 1 ? 'is the repository' : `are the ${count} repositories`} the workspace linked as its own, newest push first: answer "which repository" with these names.${rest} Read pull requests, issues and commits in them with workspace_github.`;
}

/**
 * A repository read through the workspace's GitHub App: what is open, one pull request or issue, its files, its
 * comments, the latest commits. No GitHub sign in of the person's own is needed, since only reading goes this way.
 */
export async function workspaceGithubTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const read = deps.personalWork?.github;
  if (read === undefined) return { reached: false, said: NO_SEAM };
  const repository = textArg(args, 'repository') ?? '';
  const what = textArg(args, 'what') ?? '';
  if (repository === '' || what === '') {
    return {
      said: 'Pass repository as owner/repo, from repositories, and what: repository, pulls, pull, pull_files, issues, issue, comments or commits.',
    };
  }
  const number = Number(textArg(args, 'number') ?? '');
  const found = await read({
    repository,
    what,
    ...(Number.isInteger(number) && number > 0 ? { number } : {}),
  });
  if (!found.ok) return { reached: false, said: found.said };
  // Written by other people, so it is read as what they wrote and never as an instruction.
  return readBack(found.value);
}

/** The account a tool goes out as, or what to say where it is not theirs or not signed in. */
async function theirAccountFor(
  deps: SessionToolDeps,
  tool: string,
): Promise<CheckedAccount | { done: false; said: string }> {
  const seam = deps.personalWork;
  if (seam === undefined) return { done: false, said: NO_SEAM };
  const accounts = await seam.accounts();
  if (!accounts.ok) return { done: false, said: accounts.said };
  const checked = accountForTool(tool, accounts.value);
  if (checked === undefined) {
    return {
      done: false,
      said: 'They have not signed in to that tool. Run find_tool for it, which opens its sign in in front of them.',
    };
  }
  if (checked.check !== WORK_ACCOUNT_CHECK.MISMATCH) return checked;
  await showSignIns(deps, { first: [], again: [checked.toolkit] });
  return {
    done: false,
    said: `Their ${nameOf(checked.toolkit)} sign in reached somebody else's account, so nothing was written down. Its sign in is open in front of them to sign in again.`,
  };
}

/** The account a proposed run goes out as: a local tool's sign in on this Mac, else the cloud's check. */
function accountFor(
  deps: SessionToolDeps,
  tool: string,
): ReturnType<typeof theirAccountFor> | Promise<CheckedAccount> {
  return isLocalSlug(tool)
    ? Promise.resolve(localAccount(tool))
    : theirAccountFor(deps, tool);
}

/** A tool on this Mac runs as however the person is signed in to it there, which no cloud checks. */
function localAccount(tool: string): CheckedAccount {
  const rest = tool.slice(tool.indexOf(':') + 1);
  const toolkit = rest.split(':')[0] ?? rest;
  return { toolkit, check: WORK_ACCOUNT_CHECK.UNKNOWN };
}

/** "As maya on GitHub", so the person hears whose name it goes out under. */
function asWhom(toolkit: string, account: WorkAccount): string {
  const who = account.handle ?? account.name;
  return who === undefined ? `On ${nameOf(toolkit)}` : `As ${who} on ${nameOf(toolkit)}`;
}

/** The signed in tool a slug belongs to, the longest name winning. */
function accountForTool(
  tool: string,
  accounts: readonly CheckedAccount[],
): CheckedAccount | undefined {
  const upper = tool.toUpperCase();
  return [...accounts]
    .sort((a, b) => b.toolkit.length - a.toolkit.length)
    .find((each) => upper.startsWith(`${each.toolkit.toUpperCase()}_`));
}

/** Any tool the table does not name reads as its slug with a capital, so "airtable" is said Airtable. */
function nameOf(toolkit: string): string {
  return TOOL_NAMES[toolkit] ?? toolkit.charAt(0).toUpperCase() + toolkit.slice(1);
}

function namesOf(toolkits: readonly string[]): string {
  return toolkits.map(nameOf).join(', ');
}

/** The provider's own sign in for any tool, opened on the Mac for the person, whoever they are in the workspace. */
export async function signInTool(
  deps: SessionToolDeps,
  args: ToolArgs,
): Promise<unknown> {
  const toolkit = textArg(args, 'toolkit') ?? '';
  if (toolkit === '') return { said: 'Pass toolkit: one find_tool named in signIn.' };
  const seam = deps.personalWork;
  if (seam === undefined) return { reached: false, said: NO_SEAM };
  const again = textArg(args, 'again') === 'true';
  if (!again) {
    const already = await alreadySignedIn(deps, toolkit);
    if (already !== null) return { done: true, said: already };
  }
  const signed = await seam.signIn(toolkit);
  if (!signed.ok) return { done: false, said: signed.said };
  const said = textArg(args, 'said');
  await new PendingSignIns(deps.home).offer({
    toolkit,
    ...(said === undefined ? {} : { said }),
    at: deps.now().toISOString(),
  });
  return {
    url: signed.value.url,
    said: signed.value.opened
      ? `The ${nameOf(toolkit)} sign in is open. You carry on with what they asked as soon as they finish.`
      : `Give them this link to sign in to ${nameOf(toolkit)} once: ${signed.value.url}`,
  };
}

/** Opened a moment ago and not finished: a second page now is a second link for one sign in, which is all it does. */
const SIGN_IN_STILL_OPEN_MS = minutesToMs(3);

/**
 * Why a sign in is not opened again, or null to open it: signed in already, or one opened moments ago is still
 * waiting in their browser. A yes heard twice opened the same page twice, and the person rightly asked why.
 */
async function alreadySignedIn(
  deps: SessionToolDeps,
  toolkit: string,
): Promise<string | null> {
  const read = await deps.personalWork?.accounts();
  const reached =
    read?.ok === true
      ? read.value.find(
          (each) =>
            each.toolkit === toolkit && each.check !== WORK_ACCOUNT_CHECK.MISMATCH,
        )
      : undefined;
  if (reached !== undefined) {
    const who = workAccountOf(reached);
    const as = who.handle ?? who.name;
    return `They are already signed in to ${nameOf(toolkit)}${as === undefined ? '' : ` as ${as}`}, so nothing was opened. Carry on with what they asked with find_tool, and never say a sign in is waiting.`;
  }
  const open = await new PendingSignIns(deps.home).read(toolkit);
  if (
    open !== null &&
    deps.now().getTime() - Date.parse(open.at) < SIGN_IN_STILL_OPEN_MS
  ) {
    return `The ${nameOf(toolkit)} sign in opened a moment ago is still waiting in their browser, so no second one was opened. Say that in a few words; you carry on as soon as they finish it.`;
  }
  return null;
}

function toolCall(
  args: ToolArgs,
): { tool: string; argumentsText: string } | { said: string } {
  const tool = textArg(args, 'tool') ?? '';
  if (tool === '') return { said: 'Pass tool: a slug find_tool returned.' };
  const argumentsText = textArg(args, 'arguments') ?? '{}';
  if (!isJsonObject(argumentsText)) {
    return {
      said: 'Pass arguments as a JSON object, as find_tool described its inputs.',
    };
  }
  return { tool, argumentsText };
}

function isJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    // Not JSON, so the control plane would refuse it too.
    return false;
  }
}

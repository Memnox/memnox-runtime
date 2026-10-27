import {
  DAEMON_EVENT,
  minutesToMs,
  NOTICE_KIND,
  shortDigest,
  WORK_ACCOUNT_CHECK,
  type DaemonEvent,
} from '@memnox/core';
import {
  workAccountOf,
  type CheckedAccount,
  type PersonalAnswer,
} from '../sync/personal-work';
import { PendingSignIns, type PendingSignIn } from '../sync/sign-ins';

/**
 * Watches the sign ins the person was offered: once one finishes, the notch says whose account it
 * reached and the voice carries on with what they asked; one left unfinished is explained, since a
 * company's approval screen is what usually stops it. Asks the workspace only while one is waiting.
 */

/** Long enough to read a consent screen and an approval request, short enough to stop asking. */
const PATIENCE_MS = minutesToMs(5);
const MEMNOX_AGENT = 'memnox';
const MEMNOX_NAME = 'Memnox';

/** How a person reads each tool's name, which its slug says badly. */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  github: 'GitHub',
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  googledocs: 'Google Docs',
  googledrive: 'Google Drive',
  linear: 'Linear',
  notion: 'Notion',
  slack: 'Slack',
};

/** Why each kind of tool usually stops part way, said when a sign in never finished. */
const STALLED_BECAUSE: Readonly<Record<string, string>> = {
  slack:
    "If Slack asked you to request approval, your company's Slack wants an admin to approve Memnox first.",
  google:
    "If Google said an admin has to allow it, your company's Google account only allows apps an admin approved.",
  github:
    'If GitHub asked an organisation to approve it, your own repositories still work once you sign in.',
};

const GOOGLE_PREFIX = 'google';
const GMAIL = 'gmail';

type ReadAccounts = () => Promise<PersonalAnswer<CheckedAccount[]>>;

export class SignInWatcher {
  private readonly pending: PendingSignIns;

  constructor(
    home: string,
    private readonly accounts: ReadAccounts,
  ) {
    this.pending = new PendingSignIns(home);
  }

  /** The sign ins that finished or gave up since the last look, as notices ready to send. */
  async look(moment: string): Promise<DaemonEvent[]> {
    const waiting = await this.pending.all();
    if (waiting.length === 0) return [];
    const read = await this.accounts();
    // The workspace could not be asked just now; the next look asks again.
    if (!read.ok) return [];
    const events: DaemonEvent[] = [];
    for (const each of waiting) {
      const event = this.outcome(each, read.value, moment);
      if (event === null) continue;
      await this.pending.settle(each.toolkit);
      // Never a question of its own: the account is named on the pill and on every draft, and the
      // first one they send with Touch ID ties it to them.
      events.push(event);
    }
    return events;
  }

  private outcome(
    waiting: PendingSignIn,
    accounts: readonly CheckedAccount[],
    moment: string,
  ): DaemonEvent | null {
    const done = accounts.find(
      (each) =>
        each.toolkit === waiting.toolkit && each.check !== WORK_ACCOUNT_CHECK.MISMATCH,
    );
    if (done !== undefined) return signedInEvent(waiting, done, moment);
    if (Date.parse(moment) - Date.parse(waiting.at) < PATIENCE_MS) return null;
    return stalledEvent(waiting, moment);
  }
}

function signedInEvent(
  waiting: PendingSignIn,
  done: CheckedAccount,
  moment: string,
): DaemonEvent {
  const account = workAccountOf(done);
  const who = account.handle ?? account.name;
  const tool = nameOf(waiting.toolkit);
  return {
    ...noticeBase(NOTICE_KIND.SIGNED_IN, waiting, moment),
    summary:
      who === undefined ? `Signed in to ${tool}.` : `Signed in to ${tool} as ${who}.`,
    signedIn: {
      toolkit: waiting.toolkit,
      account,
      ...(waiting.said === undefined ? {} : { resume: waiting.said }),
    },
  };
}

function stalledEvent(waiting: PendingSignIn, moment: string): DaemonEvent {
  const tool = nameOf(waiting.toolkit);
  const because = STALLED_BECAUSE[familyOf(waiting.toolkit)];
  return {
    ...noticeBase(NOTICE_KIND.SIGN_IN_STALLED, waiting, moment),
    summary: [
      `The ${tool} sign in did not finish.`,
      because ?? `Ask me to sign in to ${tool} again when you are ready.`,
    ].join(' '),
    signedIn: { toolkit: waiting.toolkit },
  };
}

function noticeBase(
  notice: string,
  waiting: PendingSignIn,
  moment: string,
): Pick<DaemonEvent, 'kind' | 'subject' | 'agent' | 'agentName' | 'notice' | 'at'> {
  return {
    kind: DAEMON_EVENT.NOTICE,
    subject: `ntc_${notice}_${shortDigest(`${waiting.toolkit}${waiting.at}`)}`,
    agent: MEMNOX_AGENT,
    agentName: MEMNOX_NAME,
    notice,
    at: moment,
  };
}

/** Google's tools share one company policy, so one sentence covers all of them. */
function familyOf(toolkit: string): string {
  return toolkit.startsWith(GOOGLE_PREFIX) || toolkit === GMAIL ? GOOGLE_PREFIX : toolkit;
}

function nameOf(toolkit: string): string {
  return TOOL_NAMES[toolkit] ?? toolkit.charAt(0).toUpperCase() + toolkit.slice(1);
}

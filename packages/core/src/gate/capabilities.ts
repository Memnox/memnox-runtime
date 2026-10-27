import { DISPLAY, DISPLAY_VIA, type DisplayKind } from '../daemon/display';
import { DAEMON_METHOD, type DaemonEvent } from '../daemon/protocol';
import { START_ID_PREFIX } from '../coordination/session-starts';
import { PROPOSAL_KIND, type ProposedChange } from './proposals';
import { REMOTE_CAPABILITY, type RemoteCapability } from './remote-capability';

export { REMOTE_CAPABILITY, type RemoteCapability };

/** Which capability each remote method needs, and what a phone holds the moment it pairs. */

export const ALL_REMOTE_CAPABILITIES: readonly RemoteCapability[] =
  Object.values(REMOTE_CAPABILITY);

/** What a phone holds the moment it is paired; the rest is turned on from the Mac with Touch ID. */
export const PHONE_DEFAULT_CAPABILITIES: readonly RemoteCapability[] = [
  REMOTE_CAPABILITY.SEE,
  REMOTE_CAPABILITY.ASK,
  REMOTE_CAPABILITY.ANSWER,
  REMOTE_CAPABILITY.STEER,
];

/** The remote allowlist: a method missing here is refused from afar whatever the device holds. */
const REMOTE_METHODS: Readonly<Record<string, RemoteCapability>> = {
  [DAEMON_METHOD.PING]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.SESSIONS_LIST]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.SESSION_VIEW]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.WAITING]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.SUBSCRIBE]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.TRACE]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.VOICE_AGENTS]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.VOICE_CHOICE]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.FILES_LIST]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.HOME]: REMOTE_CAPABILITY.SEE,
  // Which app accounts the person connected and whether each sign in still works; acting in one is a separate signed proposal.
  [DAEMON_METHOD.CONNECTIONS_LIST]: REMOTE_CAPABILITY.SEE,
  // Only names from the cloud's catalogue, which tells the phone no more than the list does.
  [DAEMON_METHOD.TOOLKITS_SEARCH]: REMOTE_CAPABILITY.SEE,
  // Signing in or out changes what may be done in the person's name, so it takes what answering for them takes.
  [DAEMON_METHOD.CONNECTIONS_SIGN_IN]: REMOTE_CAPABILITY.ANSWER,
  [DAEMON_METHOD.CONNECTIONS_SIGN_OUT]: REMOTE_CAPABILITY.ANSWER,
  // Only writes a proposal; the rule holds once the person signs it with the rules capability.
  [DAEMON_METHOD.HAND_OVER]: REMOTE_CAPABILITY.ASK,
  // Drafts and proposes a spoken rule; it holds only once the person signs it with the rules capability.
  [DAEMON_METHOD.RULE]: REMOTE_CAPABILITY.ASK,
  [DAEMON_METHOD.ASK]: REMOTE_CAPABILITY.ASK,
  [DAEMON_METHOD.CANCEL]: REMOTE_CAPABILITY.ASK,
  [DAEMON_METHOD.WARM]: REMOTE_CAPABILITY.ASK,
  [DAEMON_METHOD.BRIEF]: REMOTE_CAPABILITY.ASK,
  // Hearing a line in the person's own voice, which grants nothing beyond the sound of it.
  [DAEMON_METHOD.SPEAK]: REMOTE_CAPABILITY.ASK,
  // How a page the phone was sent to open went; the voice surface keeps it to that phone's own shows.
  [DAEMON_METHOD.DELIVERED]: REMOTE_CAPABILITY.SEE,
  // Giving the voice back to the Mac only takes from the phone, so the least a paired phone holds is enough.
  [DAEMON_METHOD.VOICE_RELEASE]: REMOTE_CAPABILITY.SEE,
  [DAEMON_METHOD.DRIVE]: REMOTE_CAPABILITY.MAC,
  // Words for an agent to act on, so the follow up also carries a Face ID signature over them.
  [DAEMON_METHOD.FOLLOW_UP]: REMOTE_CAPABILITY.STEER,
};

/** What the phone that asked does on its own screen, so the Mac never does it as well. */
export const PHONE_OWN_DISPLAYS: readonly DisplayKind[] = [DISPLAY.LINK];

/** A confirm is allowed by what it answers, which only the subject can say. */
export const PER_SUBJECT = 'per-subject';

/** The memnox commands a phone may confirm, by what each one changes. */
const COMMAND_CAPABILITY: Readonly<Record<string, RemoteCapability>> = {
  stop: REMOTE_CAPABILITY.STEER,
  start: REMOTE_CAPABILITY.STEER,
  freeze: REMOTE_CAPABILITY.STEER,
  resume: REMOTE_CAPABILITY.STEER,
  allow: REMOTE_CAPABILITY.RULES,
  deny: REMOTE_CAPABILITY.RULES,
  rewind: REMOTE_CAPABILITY.REWIND,
};

/** What only the Mac app can do, so it is shown there whoever asked. */
export const MAC_DISPLAYS: readonly DisplayKind[] = [
  DISPLAY.OPEN,
  DISPLAY.TYPE,
  DISPLAY.PREFILL,
  DISPLAY.FOCUS,
  DISPLAY.LAUNCH,
  DISPLAY.APP,
  DISPLAY.CLOSE,
  DISPLAY.INTERRUPT,
  DISPLAY.DISMISS,
  DISPLAY.FOLDER,
  DISPLAY.LOOK,
];

/** Of those, what only reads or tidies, so it runs under `see` with no proposal and no signature. */
export const MAC_READS: readonly DisplayKind[] = [DISPLAY.LOOK, DISPLAY.DISMISS];

/** A show that starts a new session, which a phone may ask for only with Face ID, never under a drive. */
export function startsSession(
  event: Pick<DaemonEvent, 'display' | 'sessionId' | 'via'>,
): boolean {
  if (event.display === DISPLAY.LAUNCH) return true;
  if (event.display !== DISPLAY.APP) return false;
  // An app show types into the chat already open unless it carries a start's id or opens a new chat.
  return (
    event.via === DISPLAY_VIA.NEW_CHAT ||
    (event.sessionId?.startsWith(START_ID_PREFIX) ?? false)
  );
}

/** The capability a remote request needs, `per-subject` for a confirm, or null when it is never remote. */
export function remoteCapabilityFor(
  method: string,
  voice?: string,
): RemoteCapability | typeof PER_SUBJECT | null {
  if (method === DAEMON_METHOD.CONFIRM) return PER_SUBJECT;
  // Setting the voice is the Mac's; a phone may only ask which one is set.
  if (method === DAEMON_METHOD.VOICE_CHOICE && voice !== undefined) return null;
  return REMOTE_METHODS[method] ?? null;
}

/** The capability answering a proposal takes, or null when no device but the Mac may answer it. */
export function proposalCapability(change: ProposedChange): RemoteCapability | null {
  if (change.kind === PROPOSAL_KIND.ANSWER || change.kind === PROPOSAL_KIND.TEAM)
    return REMOTE_CAPABILITY.ANSWER;
  if (change.kind === PROPOSAL_KIND.RESUME) return REMOTE_CAPABILITY.STEER;
  if (change.kind === PROPOSAL_KIND.RULES) return REMOTE_CAPABILITY.RULES;
  if (change.kind === PROPOSAL_KIND.REWIND) return REMOTE_CAPABILITY.REWIND;
  if (change.kind === PROPOSAL_KIND.MAC) return REMOTE_CAPABILITY.MAC;
  // Saying something as the person is answering for them, so a phone allowed to answer may sign it.
  if (change.kind === PROPOSAL_KIND.WORK || change.kind === PROPOSAL_KIND.ACCOUNT)
    return REMOTE_CAPABILITY.ANSWER;
  return COMMAND_CAPABILITY[change.argv[0] ?? ''] ?? null;
}

/**
 * A drive grant lets only a Mac proposal from that device run unsigned. A held call may delete or
 * send something off the machine, and rules, rewind and commands are never driven, so all keep asking.
 */
export function driveCovers(change: ProposedChange, deviceId: string): boolean {
  return (
    change.kind === PROPOSAL_KIND.MAC &&
    change.deviceId === deviceId &&
    !startsSession(change.event)
  );
}

export function isRemoteCapability(value: string): value is RemoteCapability {
  // Widened only to ask whether a string is one of them.
  return (ALL_REMOTE_CAPABILITIES as readonly string[]).includes(value);
}

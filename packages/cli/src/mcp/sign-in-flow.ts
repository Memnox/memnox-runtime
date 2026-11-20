import {
  approvalUrl,
  discoverSignIn,
  exchangeCode,
  minutesToMs,
  newSignInRequest,
  registerClient,
  REPAIR_COMMAND,
  RemoteSignIns,
  signInAsked,
  signInCommand,
  type RemoteSignIn,
  type SecretStore,
  type SignInClient,
} from '@memnox/core';
import type {
  CallbackAnswer,
  CallbackListener,
  ListenForCallback,
} from './callback-listener';
import { SIGN_IN_PAGE } from './callback-page';

/**
 * One sign in to one remote server, done by Memnox in the person's browser. Every step is told as it
 * happens, every wait is bounded and can be skipped, and every way it can stop is a sentence saying
 * what happened, since a half done sign in must never leave a server worse off than it was.
 */

/** Where the sign in stands, told as it moves so a person is never left looking at a still screen. */
export type SignInStep =
  { kind: 'opened'; page: string; browser: boolean } | { kind: 'approved' };

/** A key a person presses to stop waiting on this server; released once the wait is over. */
export interface SkipKey {
  pressed: Promise<void>;
  release(): void;
}

interface SignInFlowDeps {
  home: string;
  secrets: SecretStore;
  listen: ListenForCallback;
  /** Opens the approval page; false where no browser could be opened, and the link is said instead. */
  open: (url: string) => Promise<boolean>;
  progress: (step: SignInStep) => void;
  /** Asks the server again with the new sign in kept, true where it answered. */
  connects: () => Promise<boolean>;
  now: () => Date;
  /** Starts listening for a skip; absent where nobody is at a keyboard to press one. */
  skip?: () => SkipKey;
  /** How a server is reached; injected so a test needs no network. */
  fetch?: typeof fetch;
  /** How long the person has to approve; injected so a test does not wait. */
  waitMs?: number;
  /** A client the server already knows, used in place of registering a new one. */
  client?: SignInClient;
  /** The port the sign in comes back to, where that client was registered with one. */
  port?: number;
}

type SignedIn = { signedIn: RemoteSignIn } | { refused: string } | { skipped: true };

/** Long enough to find a password, short enough that a forgotten tab does not hold a port all day. */
const APPROVAL_WAIT_MS = minutesToMs(5);

const TIMED_OUT =
  'Nobody approved the sign in within five minutes, so nothing was changed.';
const NOT_KEPT =
  'Memnox could not keep the sign in on this computer, so nothing was changed.';

/** What the wait answers when the person chose to move on. */
const SKIPPED = 'skipped';

export async function signInThroughMemnox(
  target: { name: string; url: string },
  deps: SignInFlowDeps,
): Promise<SignedIn> {
  const { name, url } = target;
  const fetcher = deps.fetch ?? fetch;
  const asked = await signInAsked(url, fetcher);
  if (!asked.asked)
    return {
      refused: `${name} did not ask for a sign in, so there is nothing to sign in to.`,
    };
  const endpoints = await discoverSignIn(url, fetcher, asked.metadata);
  if (endpoints === null)
    return { refused: `${name} does not say where to sign in. ${handBackInstead(name)}` };
  const listener = await deps.listen({
    server: name,
    ...(deps.port === undefined ? {} : { port: deps.port }),
  });
  try {
    const client =
      deps.client ?? (await registerClient(endpoints, listener.redirectUri, fetcher));
    if (client === null) return { refused: knownAppsOnly(name) };
    const request = newSignInRequest(listener.redirectUri);
    const page = approvalUrl(endpoints, client, request);
    deps.progress({ kind: 'opened', page, browser: await deps.open(page) });
    const answer = await approvalOf(listener, deps);
    if (answer === SKIPPED) return { skipped: true };
    const code = codeOf(answer, request.state);
    if ('refused' in code) return failed(listener, name, code.refused);
    deps.progress({ kind: 'approved' });
    const signedIn = await exchangeCode(
      { url, endpoints, client, request, code: code.code },
      fetcher,
      deps.now(),
    );
    if (signedIn === null)
      return failed(
        listener,
        name,
        `${name} approved the sign in and then gave no token for it.`,
      );
    return await keptIfItConnects(listener, signedIn, { name, deps });
  } catch {
    // A store or a network that threw is one more way this did not finish, said rather than thrown.
    return failed(listener, name, NOT_KEPT);
  } finally {
    await listener.close();
  }
}

/** The approval, nothing in time, or the person choosing to move on. */
async function approvalOf(
  listener: CallbackListener,
  deps: SignInFlowDeps,
): Promise<CallbackAnswer | null | typeof SKIPPED> {
  const key = deps.skip?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deps.waitMs ?? APPROVAL_WAIT_MS);
  });
  try {
    return await Promise.race([
      listener.answer(),
      late,
      ...(key === undefined ? [] : [key.pressed.then((): typeof SKIPPED => SKIPPED)]),
    ]);
  } finally {
    clearTimeout(timer);
    key?.release();
  }
}

/**
 * Kept, then proved by asking the server with it, while the tab still waits to say how it went.
 * One that does not connect is never kept, and whatever was kept before stands again.
 */
async function keptIfItConnects(
  listener: CallbackListener,
  signedIn: RemoteSignIn,
  { name, deps }: { name: string; deps: SignInFlowDeps },
): Promise<SignedIn> {
  const signIns = new RemoteSignIns(deps.secrets, deps.home);
  const before = await signIns.get(signedIn.url);
  await signIns.set(signedIn);
  if (await deps.connects()) {
    listener.reply({ kind: SIGN_IN_PAGE.CONNECTED, server: name });
    return { signedIn };
  }
  if (before === null) await signIns.remove(signedIn.url);
  else await signIns.set(before);
  return failed(
    listener,
    name,
    `${name} took the sign in and still would not answer, so the sign in was not kept.`,
  );
}

function failed(listener: CallbackListener, name: string, why: string): SignedIn {
  listener.reply({ kind: SIGN_IN_PAGE.FAILED, server: name, detail: why });
  return { refused: why };
}

/** Said where a server registers nobody new, with both ways on from there. */
function knownAppsOnly(name: string): string {
  return `${name} takes sign ins only from apps it already knows, and Memnox is not one of them. If its maker gave you a client id, run "${signInCommand(name)} --client-id <id>". Otherwise "${REPAIR_COMMAND}" hands it back to your agent, which can sign in.`;
}

function handBackInstead(name: string): string {
  return `Memnox cannot sign in to ${name}, and "${REPAIR_COMMAND}" hands it back to your agent, which can.`;
}

/** The code to exchange, only where the answer belongs to the request this run began. */
function codeOf(
  answer: CallbackAnswer | null,
  state: string,
): { code: string } | { refused: string } {
  if (answer === null) return { refused: TIMED_OUT };
  if (answer.error !== undefined)
    return {
      refused: `The sign in was not approved (${answer.error}), so nothing was changed.`,
    };
  if (answer.state !== state || answer.code === undefined)
    return { refused: 'The answer did not belong to this sign in, so it was not used.' };
  return { code: answer.code };
}

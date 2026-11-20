import {
  MCP_HEALTH,
  readHub,
  readHubHealth,
  readOrgServers,
  withOrganization,
  writeHubHealth,
  type DaemonResponse,
  type SecretStore,
} from '@memnox/core';
import { listenOnLoopback, type ListenForCallback } from '../mcp/callback-listener';
import { testHubServer } from '../mcp/hub-test';
import { signInServer, type SignInOutcome } from '../mcp/sign-in-command';
import { openBrowser, OPEN_BROWSER_VAR } from '../sync/browser';

/**
 * A sign in started from the hub card. It waits on a person in a browser for minutes and the daemon
 * answers its requests in order, so the press is answered at once and what the sign in came to is
 * written onto the server's card, where the screen that asked reads it.
 */

type Answered = Omit<DaemonResponse, 'id'>;

/** What a sign in from a screen opens and waits on; injected so a test binds no port and opens no browser. */
export interface HubSignInSeams {
  listen: ListenForCallback;
  open: (url: string) => Promise<boolean>;
  waitMs?: number;
  /** Handed the sign in running in the background, so a test can wait for it to end. */
  running?: (done: Promise<void>) => void;
}

interface HubSignInDeps {
  now: Date;
  /** A paired phone, which is not where the browser opens. */
  remote: boolean;
  secrets: SecretStore;
  fetch?: typeof fetch;
  signIn?: HubSignInSeams;
}

const LIVE: HubSignInSeams = {
  listen: listenOnLoopback,
  // The person pressed sign in at this computer, so the page opens with no terminal in front of them.
  open: (url) => openBrowser(url, { ...process.env, [OPEN_BROWSER_VAR]: '1' }),
};

/** The page opens on this computer, so a press from a phone would open it where nobody is looking. */
const SIGN_IN_FROM_AFAR =
  'Sign in at the computer, since its browser is where the page opens.';

/** Servers with a sign in open now, so a second press does not open a second page for one answer. */
const open = new Set<string>();

export function startHubSignIn(
  home: string,
  name: string | undefined,
  deps: HubSignInDeps,
): Answered {
  if (deps.remote) return refused(SIGN_IN_FROM_AFAR);
  if (name === undefined) return refused('Name the server to sign in to.');
  if (open.has(name))
    return refused(`A sign in to ${name} is already open in your browser.`);
  const seams = deps.signIn ?? LIVE;
  open.add(name);
  const done = signInServer(
    home,
    name,
    {
      listen: seams.listen,
      open: seams.open,
      secrets: deps.secrets,
      now: () => new Date(),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(seams.waitMs === undefined ? {} : { waitMs: seams.waitMs }),
    },
    // The card is where this run speaks, and the page it opened says the rest.
    () => undefined,
  )
    .then((outcome) => keepOutcome(home, name, outcome, deps))
    .catch((err: unknown) =>
      keepError(home, name, err instanceof Error ? err.message : String(err), deps.now),
    )
    .finally(() => open.delete(name));
  seams.running?.(done);
  return {
    ok: true,
    outcome: `The sign in page of ${name} is opening in your browser. Approve it there, and ${name} connects.`,
  };
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

/** What the sign in came to, put on the server's card: its tools where it connected, the reason where it did not. */
async function keepOutcome(
  home: string,
  name: string,
  outcome: SignInOutcome,
  deps: HubSignInDeps,
): Promise<void> {
  if ('refused' in outcome) return keepError(home, name, outcome.refused, deps.now);
  const hub = withOrganization(await readHub(home), await readOrgServers(home));
  const server = hub.servers.find((each) => each.name === name);
  if (server === undefined) return;
  await testHubServer(home, server, {
    secrets: deps.secrets,
    now: new Date(),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
}

async function keepError(
  home: string,
  name: string,
  error: string,
  now: Date,
): Promise<void> {
  const health = await readHubHealth(home);
  await writeHubHealth(home, {
    ...health,
    [name]: { state: MCP_HEALTH.ERROR, checkedAt: now.toISOString(), error },
  });
}

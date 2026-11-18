import {
  HUB_TRANSPORT,
  nodeSecretStore,
  readHub,
  ServerTroubles,
  withServer,
  type SecretStore,
  type SignInClient,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import type { ListenForCallback } from './callback-listener';
import { findRemote, REMOTE_VERDICT, remoteVerdict } from './hub-repair';
import { syncHub } from './hub-writer';
import { signInThroughMemnox, type SignInStep, type SkipKey } from './sign-in-flow';

/**
 * Signing in to one remote server through Memnox, so it connects behind the proxy and its calls stay
 * ruled on: the one routine `memnox mcp signin`, `memnox mcp repair` and the hub card all run.
 * There is no sign out, because nothing here may disconnect a tool.
 */

export interface SignInServerDeps {
  listen: ListenForCallback;
  open: (url: string) => Promise<boolean>;
  secrets?: SecretStore;
  fetch?: typeof fetch;
  now?: () => Date;
  waitMs?: number;
  /** Starts listening for a person choosing to skip; absent where nobody is at a keyboard. */
  skip?: () => SkipKey;
  /** A client the server's maker gave the person, for a server that registers nobody new. */
  client?: SignInClient;
  /** The port the sign in comes back to, where such a client was registered with one. */
  port?: number;
}

/** How one sign in ended. `governed` is whether it also went back behind the proxy from the agent's own reach. */
export type SignInOutcome =
  | { signedIn: true; governed: boolean }
  | { already: true }
  | { skipped: true }
  | { refused: string };

export async function signInServer(
  home: string,
  name: string,
  deps: SignInServerDeps,
  progress: (step: SignInStep) => void,
): Promise<SignInOutcome> {
  const target = await findRemote(home, name);
  if (target === null)
    return { refused: `No remote MCP server named ${name} is set up on this computer.` };
  const secrets = deps.secrets ?? nodeSecretStore(home);
  const reach = { secrets, ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) };
  // A server that already answers is left alone: a second sign in could only put a working one at risk.
  if ((await remoteVerdict(home, target, reach)) === REMOTE_VERDICT.WORKING)
    return { already: true };
  const done = await signInThroughMemnox(target, {
    ...reach,
    home,
    listen: deps.listen,
    open: deps.open,
    progress,
    // Asked with the token on it, so "connected" is only said of a server that answered.
    connects: async () =>
      (await remoteVerdict(home, target, reach)) === REMOTE_VERDICT.WORKING,
    now: deps.now ?? (() => new Date()),
    ...(deps.skip === undefined ? {} : { skip: deps.skip }),
    ...(deps.waitMs === undefined ? {} : { waitMs: deps.waitMs }),
    ...(deps.client === undefined ? {} : { client: deps.client }),
    ...(deps.port === undefined ? {} : { port: deps.port }),
  });
  if ('refused' in done || 'skipped' in done) return done;
  await new ServerTroubles(home).clearServer(name);
  return { signedIn: true, governed: await putBehindProxy(home, name) };
}

/** A hub server left for the agent to sign in to goes back behind the proxy, now that Memnox can sign in. */
async function putBehindProxy(home: string, name: string): Promise<boolean> {
  const hub = await readHub(home);
  const held = hub.servers.find((each) => each.name === name);
  if (held?.transport !== HUB_TRANSPORT.HTTP || held.direct !== true) return false;
  const { direct: _direct, ...proxied } = held;
  await syncHub(home, withServer(hub, proxied));
  return true;
}

/** How one server's sign in reads on the rail, the same in `signin` and in `repair`. */
export function signInSteps(
  context: CliContext,
  name: string,
  skippable: boolean,
): (step: SignInStep) => void {
  const { flow, style } = context;
  return (step) => {
    if (step.kind === 'approved') {
      flow.aside(`Approved. Checking that ${name} connects with it.`);
      return;
    }
    if (step.browser)
      flow.aside(
        `Your browser is open on the sign in page of ${name}. Approve it there.`,
      );
    else
      flow.aside(`Open this page in your browser to sign in to ${name}:\n${step.page}`);
    flow.aside(
      style.dim(
        skippable
          ? 'Waiting for you, up to five minutes. Press Enter to skip this one.'
          : 'Waiting for you, up to five minutes.',
      ),
    );
  };
}

/** One server's outcome as a line on the rail. */
export function outcomeLine(
  context: CliContext,
  name: string,
  outcome: SignInOutcome,
): string {
  const { style } = context;
  if ('signedIn' in outcome)
    return style.ok(`${name} is connected, and Memnox rules on its calls.`);
  if ('already' in outcome) return style.ok(`${name} is already connected.`);
  if ('skipped' in outcome) return `${name} was skipped, and nothing was changed.`;
  return style.warn(outcome.refused);
}

const RECONNECT = 'Restart your agent, or reconnect the server in it.';

export async function runSignIn(
  context: CliContext,
  deps: SignInServerDeps & { home: () => string },
  name: string,
): Promise<void> {
  const { flow } = context;
  flow.open(`memnox mcp signin ${name}`);
  const done = await signInServer(
    deps.home(),
    name,
    deps,
    signInSteps(context, name, deps.skip !== undefined),
  );
  flow.close(outcomeLine(context, name, done));
  if ('signedIn' in done)
    flow.hint(
      done.governed
        ? `${name} is behind Memnox again, so its calls are ruled on. ${RECONNECT}`
        : RECONNECT,
    );
}

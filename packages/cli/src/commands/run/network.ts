/**
 * Where a run's agent sends its HTTP: through a relay to the daemon's egress proxy when one
 * runs, else a proxy of its own. An untrusted session always gets its own, decided for it.
 */
import { desktopNotice, LocalGate } from '@memnox/core';
import {
  log,
  proxyUrlFor,
  RELAY_STATE,
  startEgressProxy,
  startEgressRelay,
  type EgressCaller,
  type EgressProxy,
  type EgressProxyOptions,
  type EgressRelay,
  type EgressRelayOptions,
  type RelayState,
} from '@memnox/interceptors';
import { daemonEgressPort, egressSeamFor } from '../../daemon/egress';
import { policySetInForce } from '../../policy-path';

/** Loopback is never proxied: a dev server on this machine is not egress. */
const NO_PROXY = 'localhost,127.0.0.1,::1';

/** Every spelling the tools an agent runs read, since curl, git and npm disagree. */
const PROXY_VARIABLES: readonly string[] = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];

/** Node's own `fetch` reads the proxy variables only when this is set (Node 24 and later). */
const NODE_PROXY_SWITCH = 'NODE_USE_ENV_PROXY';

/** Where the proxy the agent was pointed at came from, as the start screen says it. */
const EGRESS_SOURCE = {
  DAEMON: 'daemon',
  SESSION: 'session',
} as const;

export type EgressSource = (typeof EGRESS_SOURCE)[keyof typeof EGRESS_SOURCE];

export interface SessionEgress {
  url: string;
  port: number;
  source: EgressSource;
  close: () => Promise<void>;
}

/** The variables that point every HTTP client in the agent's tree at the proxy. */
export function proxyEnvironment(url: string): Record<string, string> {
  return {
    ...Object.fromEntries(PROXY_VARIABLES.map((name) => [name, url])),
    NO_PROXY,
    no_proxy: NO_PROXY,
    [NODE_PROXY_SWITCH]: '1',
  };
}

export interface EgressSeams {
  /** The daemon's port, or null when none is running. */
  daemonPort?: (home: string) => Promise<number | null>;
  /** Injected so a test starts nothing that listens. */
  start?: (options: EgressProxyOptions) => Promise<EgressProxy>;
  /** Injected so a test starts nothing that listens. */
  relay?: (options: EgressRelayOptions) => Promise<EgressRelay>;
  /** How the person hears that the daemon went, and that it came back. */
  notice?: (message: string) => void;
}

interface SessionEgressInput {
  home: string;
  caller: Required<EgressCaller>;
  untrusted: boolean;
  seams?: EgressSeams;
}

/** The daemon's proxy where it can be leaned on, and otherwise one held by this run. */
export async function sessionEgress(input: SessionEgressInput): Promise<SessionEgress> {
  const { home, caller, seams = {} } = input;
  if (!input.untrusted) {
    const daemonPort = seams.daemonPort ?? daemonEgressPort;
    if ((await daemonPort(home)) !== null) {
      return relayedToDaemon({ home, caller, seams, upstream: () => daemonPort(home) });
    }
  }
  const set = await policySetInForce(home);
  const gate =
    set.policies.length === 0
      ? undefined
      : new LocalGate(set.policies, { agentName: caller.agent });
  const seam = egressSeamFor({
    home,
    log,
    fixed: caller,
    ...(gate === undefined ? {} : { gate }),
  });
  const proxy = await (seams.start ?? startEgressProxy)({ seam, port: 0, log });
  return {
    url: proxyUrlFor(proxy.port, caller),
    port: proxy.port,
    source: EGRESS_SOURCE.SESSION,
    close: proxy.close,
  };
}

interface RelayInput {
  home: string;
  caller: Required<EgressCaller>;
  seams: EgressSeams;
  upstream: () => Promise<number | null>;
}

/**
 * The daemon's proxy behind a port this run holds, so a daemon that stops or moves never
 * refuses the agent's calls. Without it the calls go through unruled, and the person is
 * told Memnox is not watching rather than finding out from an agent that cannot connect.
 */
async function relayedToDaemon(input: RelayInput): Promise<SessionEgress> {
  const { home, caller, seams } = input;
  let standIn: Promise<EgressProxy> | null = null;
  const startStandIn = (): Promise<EgressProxy> => {
    standIn ??= (seams.start ?? startEgressProxy)({
      seam: egressSeamFor({ home, log, fixed: caller }),
      port: 0,
      log,
    });
    return standIn;
  };
  const notice = seams.notice ?? desktopNotice;
  const relay = await (seams.relay ?? startEgressRelay)({
    upstream: input.upstream,
    standIn: async () => (await startStandIn()).port,
    changed: (state) => notice(relayNotice(state, caller.agent)),
  });
  return {
    url: proxyUrlFor(relay.port, caller),
    port: relay.port,
    source: EGRESS_SOURCE.DAEMON,
    close: async () => {
      await relay.close();
      if (standIn !== null) await (await standIn).close();
    },
  };
}

/** What the person is told when the relay changes where it sends the agent's calls. */
export function relayNotice(state: RelayState, agent: string): string {
  return state === RELAY_STATE.UNWATCHED
    ? `Memnox is not watching ${agent}: its daemon stopped, so the agent's network calls go straight through until it is back. Run memnox daemon to watch again.`
    : `Memnox is watching ${agent} again: its daemon is back and rules the agent's network calls.`;
}

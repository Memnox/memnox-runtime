/**
 * The ports agents already running still send their HTTP to, read back from the proxy
 * variables `memnox run` gave them. A run from before the relay pointed its agent straight
 * at the daemon's port, and a daemon that came back elsewhere refuses every call it makes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { SessionHosts, type SessionHost } from '@memnox/core';
import { EGRESS_LOOPBACK } from '@memnox/interceptors';

const PS_TIMEOUT_MS = 2000;

/** Prefix of the session ids `memnox run` mints, the only sessions it set a proxy for. */
const RUN_SESSION_PREFIX = 'ses_';

/** Both spellings, since a run set every one and either is enough to name the port. */
const PROXY_VARIABLE = /(?:^|[\s\0])(?:HTTPS?_PROXY|https?_proxy)=(\S+?)(?=[\s\0]|$)/g;

interface StrandedSeams {
  hosts?: () => Promise<SessionHost[]>;
  /** The process's environment as text, or null when it cannot be read. */
  environmentOf?: (pid: number) => string | null;
  alive?: (pid: number) => boolean;
}

/** Every loopback port a live run session's agent was told to use, each once. */
export async function strandedEgressPorts(
  home: string,
  seams: StrandedSeams = {},
): Promise<number[]> {
  const hosts = await (
    seams.hosts ?? ((): Promise<SessionHost[]> => new SessionHosts(home).all())
  )();
  const environmentOf = seams.environmentOf ?? processEnvironment;
  const alive = seams.alive ?? isAlive;
  const ports = new Set<number>();
  for (const host of hosts) {
    if (!host.sessionId.startsWith(RUN_SESSION_PREFIX) || host.endedAt !== undefined)
      continue;
    if (!alive(host.pid)) continue;
    const environment = environmentOf(host.pid);
    if (environment === null) continue;
    const port = proxyPortIn(environment, host.sessionId);
    if (port !== null) ports.add(port);
  }
  return [...ports];
}

/**
 * The port in a proxy variable that `proxyUrlFor` wrote for this session, and no other:
 * the session id riding as the user is what tells Memnox's proxy apart from anybody else's.
 */
export function proxyPortIn(environment: string, sessionId: string): number | null {
  for (const match of environment.matchAll(PROXY_VARIABLE)) {
    const port = memnoxPort(match[1] ?? '', sessionId);
    if (port !== null) return port;
  }
  return null;
}

function memnoxPort(value: string, sessionId: string): number | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not a URL is not a proxy this run wrote.
    return null;
  }
  if (url.hostname !== EGRESS_LOOPBACK || decodeURIComponent(url.username) !== sessionId)
    return null;
  const port = Number(url.port);
  return Number.isInteger(port) && port > 0 ? port : null;
}

/** Read only for the agent pids a session note names, never for the whole machine. */
function processEnvironment(pid: number): string | null {
  try {
    if (process.platform === 'linux') return readFileSync(`/proc/${pid}/environ`, 'utf8');
    return execFileSync('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: PS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Gone, or not ours to read: either way there is no port to keep for it.
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Gone, or not ours to signal: either way no agent is waiting on that port.
    return false;
  }
}

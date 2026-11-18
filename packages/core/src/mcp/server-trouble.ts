import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * A server behind the proxy that could not be reached, written down by the proxy that found out,
 * because the agent only ever says "disconnected" and the person is otherwise left to debug it.
 */

export const SERVER_TROUBLE = {
  /** It asks for a sign in nobody has done through Memnox yet, or one that ran out and would not renew. */
  SIGN_IN: 'sign-in',
  /** It refused the credential the proxy sent, which the person replaces and no sign in settles. */
  CREDENTIAL: 'credential',
  /** It did not answer, or refused, which a wrong address or a network down both look like. */
  UNREACHABLE: 'unreachable',
  /** A local server whose command would not run, or that stopped before it said anything. */
  NOT_STARTED: 'not-started',
  /** It names a secret this machine does not hold, so the proxy never started it. */
  MISSING_SECRET: 'missing-secret',
} as const;

export type ServerTroubleKind = (typeof SERVER_TROUBLE)[keyof typeof SERVER_TROUBLE];

export interface ServerTrouble {
  server: string;
  /** The agent whose config started the proxy, where the line named one. */
  agent?: string;
  kind: ServerTroubleKind;
  at: string;
  /** On a missing secret: its name, never a value. */
  secret?: string;
}

/** The one command that puts such a server back, named wherever the trouble is said. */
export const REPAIR_COMMAND = 'memnox mcp repair';

/** The command that signs in to one server through Memnox, so it connects and stays ruled on. */
export function signInCommand(server: string): string {
  return `memnox mcp signin ${server}`;
}

/** The status a server answers when it wants a sign in first. */
const UNAUTHORIZED = 401;

/**
 * What a refused request means: a sign in to do, a credential that was sent and turned down, or a
 * server that is simply not answering. `keyed` is whether a credential went with the request.
 */
export function troubleOfStatus(
  status: number | undefined,
  keyed = false,
): ServerTroubleKind {
  if (status !== UNAUTHORIZED) return SERVER_TROUBLE.UNREACHABLE;
  return keyed ? SERVER_TROUBLE.CREDENTIAL : SERVER_TROUBLE.SIGN_IN;
}

/** The trouble as a person is told it: what happened, why, and the one thing to do about it. */
export function describeTrouble(trouble: ServerTrouble, agentName?: string): string {
  const agent = agentName ?? trouble.agent ?? 'your agent';
  const { server } = trouble;
  switch (trouble.kind) {
    case SERVER_TROUBLE.SIGN_IN:
      return `${server} is disconnected in ${agent} because it asks for a sign in. Run "${signInCommand(server)}" to sign in through Memnox and keep its calls ruled on, or "${REPAIR_COMMAND}" to hand it back to ${agent}.`;
    case SERVER_TROUBLE.CREDENTIAL:
      return `${server} is disconnected in ${agent} because it refused the credential Memnox holds for it. Replace that secret on the server's card in the MCP Hub.`;
    case SERVER_TROUBLE.NOT_STARTED:
      return `${server} is disconnected in ${agent} because its own command did not start. "memnox doctor --servers" starts it and says what it answered.`;
    case SERVER_TROUBLE.MISSING_SECRET:
      return `${server} cannot start in ${agent} because it needs the secret ${trouble.secret ?? 'it names'}, which this computer does not hold. Add it on the server's card in the MCP Hub.`;
    default:
      return `${server} is disconnected in ${agent} because it did not answer Memnox. "${REPAIR_COMMAND}" checks it and says what it found.`;
  }
}

/** The same trouble as the agent reads it, in the error its own server list shows the person. */
export function troubleForAgent(server: string, kind: ServerTroubleKind): string {
  if (kind === SERVER_TROUBLE.SIGN_IN)
    return `${server} asks for a sign in before it connects. Tell your person to run "${signInCommand(server)}" in a terminal, which signs in through Memnox, or "${REPAIR_COMMAND}", which hands it back to this agent to sign in to.`;
  if (kind === SERVER_TROUBLE.CREDENTIAL)
    return `${server} refused the credential Memnox holds for it. Tell your person to replace that secret on the server's card in the MCP Hub.`;
  return `${server} did not answer Memnox. Tell your person that "${REPAIR_COMMAND}" in a terminal checks it.`;
}

const TROUBLE_DIR = 'mcp-trouble';
const NO_AGENT = '';

/** One file per server and agent, since every proxy is its own process and none may clobber another's. */
export class ServerTroubles {
  private readonly records: JsonRecordDir<ServerTrouble>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, TROUBLE_DIR));
  }

  async note(trouble: ServerTrouble): Promise<void> {
    await this.records.write(idOf(trouble.server, trouble.agent), trouble);
  }

  /** It answered, or was handed back, so whatever was wrong is over. */
  async clear(server: string, agent?: string): Promise<void> {
    await this.records.remove(idOf(server, agent));
  }

  /** Every agent's trouble with one server forgotten, for when the server itself was put right. */
  async clearServer(server: string): Promise<void> {
    for (const each of await this.all())
      if (each.server === server) await this.clear(each.server, each.agent);
  }

  /** Every trouble that reads, oldest first. */
  async all(): Promise<ServerTrouble[]> {
    const found = await this.records.all();
    return found
      .filter((each) => typeof each.server === 'string' && typeof each.at === 'string')
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}

/** A digest, since a server's name is somebody else's text and may hold a slash or a space. */
function idOf(server: string, agent: string | undefined): string {
  return shortDigest(`${agent ?? NO_AGENT}\u0000${server}`);
}

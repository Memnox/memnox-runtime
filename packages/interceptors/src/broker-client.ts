import { connect } from 'node:net';

import { BROKER_VAR, type BrokerReply } from '@memnox/core';

/**
 * Asks the session's broker for the credentials one binary is entitled to. Empty on any
 * failure, which leaves the command to fail its own login rather than hang the agent.
 */

/** As short as the daemon's: this runs before every command a shim fronts. */
const BROKER_TIMEOUT_MS = 250;

/** A reply is a handful of variables; anything far longer is not the broker. */
const MOST_REPLY_BYTES = 64 * 1024;

export function askBroker(
  path: string,
  binary: string,
  timeoutMs: number = BROKER_TIMEOUT_MS,
): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let reply = '';
    let settled = false;
    const finish = (variables: Record<string, string>): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(variables);
    };
    const socket = connect(path, () => socket.write(`${JSON.stringify({ binary })}\n`));
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finish({}));
    socket.on('error', () => finish({}));
    socket.on('data', (chunk: string) => {
      reply += chunk;
      if (reply.length > MOST_REPLY_BYTES) finish({});
    });
    socket.on('end', () => finish(variablesIn(reply)));
  });
}

/** The variables in a reply, keeping only string values, or none for anything malformed. */
export function variablesIn(line: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }
  const variables =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Partial<BrokerReply>).variables
      : undefined;
  if (typeof variables !== 'object' || variables === null) return {};
  return Object.fromEntries(
    Object.entries(variables).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * The environment a fronted binary runs with: its own credentials added where a broker
 * holds them, and the broker's address taken off, since the binary has no use for it.
 */
export async function brokeredEnvironment(
  env: NodeJS.ProcessEnv,
  binary: string,
  ask: typeof askBroker = askBroker,
): Promise<NodeJS.ProcessEnv> {
  const path = env[BROKER_VAR];
  if (path === undefined || path === '') return env;
  const { [BROKER_VAR]: _address, ...rest } = env;
  return { ...rest, ...(await ask(path, binary)) };
}

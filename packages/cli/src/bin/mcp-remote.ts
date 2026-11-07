/**
 * `memnox-mcp-remote <url>`: the workspace's MCP server for an agent that only starts commands,
 * with the credential read from the environment its config gives it.
 */
import { createInterface } from 'node:readline';
import { BRIDGE_AUTHORIZATION_ENV, createBridge } from '../mcp/remote-bridge';

const url = process.argv[2];
const authorization = process.env[BRIDGE_AUTHORIZATION_ENV];
if (url === undefined || authorization === undefined || authorization === '') {
  process.stderr.write(
    `Usage: ${BRIDGE_AUTHORIZATION_ENV}=<authorization> memnox-mcp-remote <url>\n`,
  );
  process.exit(2);
}

const bridge = createBridge({
  url,
  authorization,
  write: (line) => process.stdout.write(`${line}\n`),
  log: (line) => process.stderr.write(`memnox-mcp-remote: ${line}\n`),
});

const pending = new Set<Promise<void>>();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  // Each line goes as it arrives, so a long tool call never holds up the next one.
  const sent = bridge.handle(line).finally(() => pending.delete(sent));
  pending.add(sent);
});
lines.on('close', () => {
  void Promise.allSettled([...pending])
    .then(() => bridge.close())
    .finally(() => process.exit(0));
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as proxy from '@memnox/proxy';
import { describe, expect, it } from 'vitest';
import { ollamaEmbedder } from '../src/memory/ollama-embedding';
import { insecureRelayUrl } from '../src/remote/relay-link';

/**
 * The promise on the front page, as a test.
 *
 * *No account. No network. Nothing leaves your machine* is the open half's whole
 * credibility, and `memnox login` is the one thing that changes it. Keeping every
 * outbound call in one module is what makes the claim checkable rather than
 * believed: a reviewer reads `src/sync/client.ts` and is done.
 *
 * If this fails, the fix is to route the call through `callCloud` — not to widen
 * the list below.
 */

const ROOT = join(__dirname, '..', 'src');

/**
 * Every file allowed to name a socket, and why, each one deliberate.
 *
 * `node:net` is in the pattern rather than excluded from it, because the same
 * import opens a unix socket and a TCP one, so the daemon is named here and
 * pinned to the unix side by the test below.
 */
const ALLOWED: Record<string, string> = {
  'sync/client.ts': 'the one outbound module; nothing runs until `memnox login`',
  'remote/relay-link.ts':
    'the relay WebSocket for a paired phone; nothing opens until `memnox login` and a pairing',
  'daemon-server.ts': 'a unix socket on this machine, pinned by the next test',
  'commands/run/credential-broker.ts':
    'a unix socket a session holds its credentials behind, pinned below',
  'daemon/kokoro-speech.ts':
    "the Mac app's own Kokoro server on 127.0.0.1, pinned below, so nothing leaves the machine",
  'remote/lan-link.ts':
    'a listener for paired phones on private addresses only, opened only once the person signs it on, pinned below',
  'remote/mdns.ts':
    'the Bonjour announcement beside that listener, a random name and nothing more, on the local network only',
  'memory/ollama-embedding.ts':
    'a local embedding model on this machine, off until the person names one, and refusing any other address, pinned below',
  'mcp/remote-tools.ts':
    "lists a remote MCP server's tools through the proxy's upstream, only when the person asks to test that server",
  'bin/mcp-proxy.ts':
    'the proxy bin, which reaches a remote MCP server only when the person wrapped one',
  'daemon/workspace-stream.ts':
    "the person's own workspace stream, held open only once `memnox login` has left a credential",
  'edit-watcher.ts':
    'hands fetch to the cloud lease register, which names a held path only once `memnox login` has left a credential',
  'memory/memory-reach.ts':
    'hands fetch to a memory source, which calls only an API the person added themselves',
  'trace/otlp.ts':
    'sends spans only when the person asks, to the OpenTelemetry address they name',
};

/** What `@memnox/proxy` exports that dials a server, since importing one reaches the network as surely as fetch. */
const PROXY_NETWORK_EXPORTS = ['HttpUpstream', 'McpFirewall'] as const;

/** Node's socket and name modules, imported with or without the `node:` prefix. */
const NODE_NETWORK_MODULES = 'https?|http2|net|tls|dgram|dns';

/** Anything that opens a socket or resolves a name: a fetch called or handed on, a socket module, undici, or the proxy's upstream. */
const OUTBOUND = new RegExp(
  [
    String.raw`\bfetch\s*\(`,
    String.raw`(?:=|\?\?|\|\|)\s*fetch\b`,
    String.raw`globalThis\.fetch\b`,
    String.raw`['"]node:(?:${NODE_NETWORK_MODULES})(?:/promises)?['"]`,
    String.raw`(?:from|import|require)\s*\(?\s*['"](?:${NODE_NETWORK_MODULES})(?:/promises)?['"]`,
    String.raw`['"]undici(?:/[^'"]*)?['"]`,
    String.raw`\bWebSocket\b`,
    String.raw`\bXMLHttpRequest\b`,
    String.raw`\bEventSource\b`,
    String.raw`['"]@memnox/proxy/cli['"]`,
    ...PROXY_NETWORK_EXPORTS.map((name) => String.raw`\b${name}\b`),
  ].join('|'),
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('nothing reaches the network but the sync client', () => {
  it('keeps every outbound call in one module', () => {
    const offenders = sources(ROOT)
      .filter((path) => OUTBOUND.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length + 1))
      .filter((path) => ALLOWED[path] === undefined);

    expect(
      offenders,
      'route it through callCloud in src/sync/client.ts rather than widening this list',
    ).toEqual([]);
  });

  // A renamed proxy export would leave the pattern looking for a name nothing imports any more.
  it('names exports the proxy still has', () => {
    for (const name of PROXY_NETWORK_EXPORTS) expect(proxy).toHaveProperty(name);
  });

  /* The daemon listens on a unix socket, which is not a network — but a change
     from `node:net` to a TCP port would be, and would pass unnoticed without
     this. Named rather than excluded, so the exception is a decision. */
  it('leaves the daemon on a unix socket', () => {
    const daemon = readFileSync(join(ROOT, 'daemon-server.ts'), 'utf8');

    expect(daemon).toContain('createServer');
    expect(daemon).not.toMatch(/listen\(\s*\d/);
  });

  // The local listener binds the addresses it is handed, which are private ones only, never every interface.
  it('keeps the local network listener off the wildcard address', () => {
    const link = readFileSync(join(ROOT, 'remote', 'lan-link.ts'), 'utf8');

    expect(link).toContain('privateAddresses(networkInterfaces())');
    expect(link).not.toMatch(/0\.0\.0\.0|['"]::['"]/);
  });

  // The relay reads a bearer token from a header, so the link refuses anything but TLS off this machine.
  it('keeps the relay link on wss, or plain ws to this machine only', () => {
    expect(insecureRelayUrl('wss://api.memnox.com/v1/relay')).toBeNull();
    expect(insecureRelayUrl('ws://127.0.0.1:8787/v1/relay')).toBeNull();
    expect(insecureRelayUrl('ws://relay.example.com/v1/relay')).not.toBeNull();
    expect(insecureRelayUrl('https://api.memnox.com/v1/relay')).not.toBeNull();
  });

  /* Credentials held for a session are served to its own interceptors and to nothing
     off this machine, so the broker is pinned to a path exactly as the daemon is. */
  it('leaves the credential broker on a unix socket', () => {
    const broker = readFileSync(
      join(ROOT, 'commands', 'run', 'credential-broker.ts'),
      'utf8',
    );

    expect(broker).toContain('server.listen(path');
    expect(broker).not.toMatch(/listen\(\s*\d/);
  });

  // A line is rendered by the Mac app's Kokoro on this machine, never by anything off it.
  it('keeps speech rendering on the loopback address', () => {
    const speech = readFileSync(join(ROOT, 'daemon', 'kokoro-speech.ts'), 'utf8');
    const hosts = [...speech.matchAll(/https?:\/\/([^:/`'"]+)/g)].map(
      (match) => match[1],
    );

    expect(hosts).toEqual(['127.0.0.1']);
  });

  // Memory's words are embedded on this machine or not at all, so any other address is refused before a request.
  it('keeps the embedding model on this machine', () => {
    const model = 'nomic-embed-text';
    expect(ollamaEmbedder({ model, url: 'http://127.0.0.1:11434' })).not.toBeNull();
    expect(ollamaEmbedder({ model, url: 'http://localhost:11434' })).not.toBeNull();
    expect(ollamaEmbedder({ model, url: 'https://embed.example.com' })).toBeNull();
    expect(ollamaEmbedder({ model, url: 'http://10.0.0.5:11434' })).toBeNull();
  });
});

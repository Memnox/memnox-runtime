import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
 * Every file allowed to name a socket, and why. Five entries, each deliberate.
 *
 * `node:net` is in the pattern rather than excluded from it, because the same
 * import opens a unix socket and a TCP one — so the daemon is named here and
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
};

/** Anything that opens a socket or resolves a name. */
const OUTBOUND =
  /\bfetch\s*\(|node:https?['"]|node:dgram|node:net|\bWebSocket\b|XMLHttpRequest/;

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

  /* The daemon listens on a unix socket, which is not a network — but a change
     from `node:net` to a TCP port would be, and would pass unnoticed without
     this. Named rather than excluded, so the exception is a decision. */
  it('leaves the daemon on a unix socket', () => {
    const daemon = readFileSync(join(ROOT, 'daemon-server.ts'), 'utf8');

    expect(daemon).toContain('createServer');
    expect(daemon).not.toMatch(/listen\(\s*\d/);
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
});

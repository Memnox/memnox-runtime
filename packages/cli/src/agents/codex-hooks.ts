import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  CODEX_HOOK_TRUST,
  codexHookStandingOf,
  type CodexHookStanding,
} from '@memnox/core';
import { EDIT_HOOK_BINARY } from '@memnox/interceptors';
import { onPath } from '../on-path';

/**
 * Whether Codex runs Memnox's hooks, asked of Codex rather than worked out here: it trusts a
 * hook by a hash of its entry, and reproducing that hash would be a guess that goes stale.
 */

const CODEX_HOOKS = join('.codex', 'hooks.json');
const CODEX_BINARY = 'codex';
/** The CLI the ChatGPT app ships, which is the only Codex on a Mac that runs it from the app. */
const CODEX_IN_APP = join(
  'ChatGPT.app',
  'Contents',
  'Resources',
  'codex-cli',
  'bin',
  'codex',
);
const APP_DIRS: readonly string[] = ['/Applications'];
/** Long enough for Codex to start, short enough that `doctor` never looks hung. */
const ASK_MS = 8_000;
const INITIALIZE_ID = 1;
const HOOKS_LIST_ID = 2;

export async function readCodexHookStanding(
  home: string,
  cwd: string,
  // Replaced in a test, so no Codex is started.
  ask: (cwd: string, binary: string) => Promise<unknown> = askCodexForHooks,
  found: (binary: string) => boolean = onPath,
): Promise<CodexHookStanding> {
  let text: string;
  try {
    text = await readFile(join(home, CODEX_HOOKS), 'utf8');
  } catch {
    // No hooks file is a Codex Memnox never hooked.
    return { trust: CODEX_HOOK_TRUST.ABSENT };
  }
  if (!text.includes(EDIT_HOOK_BINARY)) return { trust: CODEX_HOOK_TRUST.ABSENT };
  const binary = codexBinary(home, found);
  if (binary === null) return { trust: CODEX_HOOK_TRUST.UNKNOWN };
  const result = await ask(cwd, binary).catch(() => null);
  if (result === null) return { trust: CODEX_HOOK_TRUST.UNKNOWN };
  return codexHookStandingOf(result, EDIT_HOOK_BINARY);
}

/** Codex on PATH, then the one inside the ChatGPT app, in the system's or the person's Applications. */
function codexBinary(home: string, found: (binary: string) => boolean): string | null {
  if (found(CODEX_BINARY)) return CODEX_BINARY;
  const inApps = [...APP_DIRS, join(home, 'Applications')].map((dir) =>
    join(dir, CODEX_IN_APP),
  );
  return inApps.find((path) => found(path)) ?? null;
}

/**
 * Codex's own list of the hooks it would run in `cwd`, through its app server: initialize,
 * then `hooks/list`. No thread, turn or model call is made. Null where it does not answer.
 */
function askCodexForHooks(cwd: string, binary: string): Promise<unknown> {
  return new Promise((done) => {
    const child = spawn(binary, ['app-server'], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let settled = false;
    const timer = setTimeout(() => finish(null), ASK_MS);
    function finish(value: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      done(value);
    }
    function send(message: unknown): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin.on('error', () => finish(null));
    createInterface({ input: child.stdout }).on('line', (line) =>
      answerLine(line, cwd, send, finish),
    );
    send(INITIALIZE);
  });
}

const INITIALIZE = {
  id: INITIALIZE_ID,
  method: 'initialize',
  params: {
    clientInfo: { name: 'memnox-doctor', version: '1' },
    capabilities: { experimentalApi: true },
  },
};

/** One line from the app server: initialized, so ask for the hooks; or the hooks themselves. */
function answerLine(
  line: string,
  cwd: string,
  send: (message: unknown) => void,
  finish: (value: unknown) => void,
): void {
  let message: { id?: unknown; result?: unknown; error?: unknown };
  try {
    message = JSON.parse(line) as typeof message;
  } catch {
    // A line that is not JSON is the server talking, not answering.
    return;
  }
  if (message.error !== undefined && message.error !== null) return finish(null);
  if (message.id === INITIALIZE_ID) {
    send({ method: 'initialized' });
    send({ id: HOOKS_LIST_ID, method: 'hooks/list', params: { cwds: [cwd] } });
  } else if (message.id === HOOKS_LIST_ID) {
    finish(message.result ?? null);
  }
}

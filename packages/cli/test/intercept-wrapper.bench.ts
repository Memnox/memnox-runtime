import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeRequest, INTERCEPT_PLAN, LineBuffer, socketPathFor } from '@memnox/core';
import { planIntercept } from '@memnox/interceptors';

import { InterceptSurface } from '../src/daemon/intercept-surface';
import { write } from '../src/daemon/socket-write';

/**
 * What one wrapped command costs an agent, on each path: the Node interceptor as it runs
 * today, the daemon's share of the native path, and the native path end to end. The plan's
 * budget for a wrapped command is ten milliseconds over running the binary itself.
 */
const RUNS = 25;
const BUDGET_MS = 10;

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NODE_WRAPPER = join(ROOT, 'packages/cli/dist/bin/intercept.js');
const NATIVE = join(
  ROOT,
  `native/intercept/dist/${process.platform}-${process.arch}/memnox-intercept-native`,
);

function median(spans: number[]): number {
  const sorted = [...spans].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

async function agentHome(): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-wrapper-bench-'));
  // The rest of this environment kept, as an agent's would be, so git looks where the daemon's does.
  return { home, env: { ...process.env, HOME: home, CLAUDECODE: '1' } };
}

function report(label: string, ms: number): void {
  // eslint-disable-next-line no-console
  console.log(`  ${label}: ${ms.toFixed(2)}ms median over ${RUNS}`);
}

/** A daemon with only the native wrapper's surface, so the round trip is measured alone. */
async function listen(home: string): Promise<Server | null> {
  const address = socketPathFor(home);
  await mkdir(dirname(address), { recursive: true });
  const surface = new InterceptSurface({
    home,
    report: () => undefined,
    plan: (scene) => planIntercept(scene, { home }),
    log: () => undefined,
  });
  const server = createServer((socket) => {
    const reader = new LineBuffer();
    let answered: Promise<void> = Promise.resolve();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        const request = decodeRequest(line);
        if (request === null) continue;
        answered = answered.then(() =>
          surface.respond(socket, request, (response) => write(socket, response)),
        );
      }
    });
    socket.on('close', () => {
      answered = answered.then(() => surface.drop(socket));
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.once('error', () => resolve(null));
    server.listen(address, () => resolve(server));
  });
}

describe('a wrapped command', () => {
  it('costs this much through the Node interceptor, which is the number to beat', async () => {
    if (!existsSync(NODE_WRAPPER)) return;
    const { home, env } = await agentHome();
    const bare = median(
      Array.from({ length: RUNS }, () => timed(() => spawnSync('true'))),
    );
    const spans = Array.from({ length: RUNS }, () =>
      timed(() =>
        spawnSync(process.execPath, [NODE_WRAPPER, 'true'], { env, cwd: home }),
      ),
    );
    report('true, unwrapped', bare);
    report('true, through the Node interceptor', median(spans));
  }, 120_000);

  it('costs the daemon this much to plan, in process', async () => {
    const { home, env } = await agentHome();
    const scene = { argv: ['true'], env, cwd: home, ppid: process.pid };
    const spans: number[] = [];
    for (let n = 0; n < RUNS; n += 1) {
      const started = performance.now();
      const plan = await planIntercept(scene, { home });
      spans.push(performance.now() - started);
      // Measuring a fallback would measure nothing.
      expect(plan.kind).toBe(INTERCEPT_PLAN.RUN);
    }
    report('the daemon planning one command', median(spans));
    expect(median(spans)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it(`runs through the native wrapper and the daemon within ${BUDGET_MS}ms of the binary`, async () => {
    if (!existsSync(NATIVE)) return;
    const { home, env } = await agentHome();
    const server = await listen(home);
    // A sandbox that cannot listen on a socket cannot measure this; the number is then unknown.
    if (server === null) return;
    try {
      const bare = median(
        Array.from({ length: RUNS }, () => timed(() => spawnSync('true'))),
      );
      const spans: number[] = [];
      for (let n = 0; n < RUNS; n += 1) {
        const started = performance.now();
        // Not spawnSync, because the daemon answering it lives in this same process.
        await new Promise<void>((resolve) => {
          spawn(NATIVE, ['true'], { env, cwd: home, stdio: 'ignore' }).on('exit', () =>
            resolve(),
          );
        });
        spans.push(performance.now() - started);
      }
      report('true, through the native wrapper', median(spans));
      expect(median(spans) - bare).toBeLessThan(BUDGET_MS);
    } finally {
      server.close();
    }
  }, 120_000);
});

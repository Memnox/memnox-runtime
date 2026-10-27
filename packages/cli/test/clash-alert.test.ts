import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Clashes, type DaemonEvent } from '@memnox/core';
import { NoticeWatcher } from '../src/daemon/notice-watch';

/* Two machines in one workspace, one file: the second agent is held off, and its person has
   to hear it on the notch while the agent is still deciding what to do, not ten seconds on
   at the next look of the ledger. */

/** The promise the notch is held to. */
const UNDER_A_SECOND_MS = 1_000;

const watchers: NoticeWatcher[] = [];

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.close();
});

async function following(): Promise<{ home: string; told: DaemonEvent[] }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-clash-'));
  const watcher = new NoticeWatcher(home, '2000-01-01T00:00:00.000Z');
  watchers.push(watcher);
  const told: DaemonEvent[] = [];
  watcher.followCollisions(
    (event) => told.push(event),
    () => new Date().toISOString(),
  );
  return { home, told };
}

async function within(ms: number, done: () => boolean): Promise<number> {
  const started = Date.now();
  while (!done() && Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return Date.now() - started;
}

const clash = {
  sessionId: 'ses_second',
  agent: 'claude-code',
  what: 'src/billing/invoice.ts',
  said: 'Claude Code on ana-mbp is editing retryCharge (lines 7 to 12) of src/billing/invoice.ts.',
};

describe('a write held off by another machine reaching the notch', () => {
  it('is told as a collision in under a second, naming the holder', async () => {
    const { home, told } = await following();
    await new Clashes(home).note({ ...clash, at: new Date().toISOString() });

    const took = await within(UNDER_A_SECOND_MS, () => told.length > 0);
    expect(told).toHaveLength(1);
    expect(took).toBeLessThan(UNDER_A_SECOND_MS);
    expect(told[0]).toMatchObject({ kind: 'notice', notice: 'collision' });
    expect(told[0]?.summary).toContain('invoice.ts');
    expect(told[0]?.summary).toContain('ana-mbp');
  });

  it('tells one clash once, though writing it is several events and the look reads it too', async () => {
    const { home, told } = await following();
    const at = new Date().toISOString();
    await new Clashes(home).note({ ...clash, at });
    await new Clashes(home).note({ ...clash, at });
    await within(UNDER_A_SECOND_MS, () => told.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(told).toHaveLength(1);
  });
});

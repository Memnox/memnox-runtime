import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEASE_GATE, LeaseGate, proceeds } from '../src/coordination/lease-gate';
import { LeaseRegistry } from '../src/coordination/lease-store';
import type { LeaseHolder } from '../src/coordination/lease';
import {
  CloudLeases,
  SHARED_OUTCOME,
  type SharedLeases,
  type SharedTake,
} from '../src/coordination/shared-leases';
import { MEMNOX_HOME } from '../src/config/config';

const first: LeaseHolder = { agent: 'cursor', sessionId: 'ses_1', pid: 111 };
const second: LeaseHolder = { agent: 'claude-code', sessionId: 'ses_2', pid: 222 };

const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-wait-'));

/** A clock the test moves, so a bounded wait is proven rather than waited through. */
class Clock {
  private ms = Date.parse('2026-10-23T10:00:00.000Z');
  now = (): string => new Date(this.ms).toISOString();
  sleep = async (by: number): Promise<void> => {
    this.ms += by;
  };
}

/** Another machine's register: held until `free` is called, counting every ask. */
class OtherMachine implements SharedLeases {
  asked = 0;
  private held = true;

  free(): void {
    this.held = false;
  }

  async take(path: string): Promise<SharedTake> {
    this.asked += 1;
    if (!this.held) return { outcome: SHARED_OUTCOME.TAKEN, lease: {} as never };
    return {
      outcome: SHARED_OUTCOME.HELD_BY_ANOTHER,
      holder: 'hermes',
      machine: 'vps-1',
      path,
      message: 'held',
      leaseId: 'lse_9',
    };
  }
  async release(): Promise<void> {}
  async releaseSession(): Promise<void> {}
  async renewSession(): Promise<void> {}
}

const answering = (result: SharedTake): SharedLeases => ({
  take: async () => result,
  release: async () => undefined,
  releaseSession: async () => undefined,
  renewSession: async () => undefined,
});

describe('two agents on one machine', () => {
  /* Real timers on purpose: the promise is that a release is noticed within a few
     hundred milliseconds, and only a real clock can break it. */
  it('lets the second agent in within 300 ms of the first letting go', async () => {
    const registry = new LeaseRegistry(await home(), () => true);
    const now = (): string => new Date().toISOString();
    const taken = await registry.take(
      { path: 'src/billing/invoice.ts', holder: first, minutes: 5, activity: 'edit' },
      now(),
    );
    if (taken.outcome !== 'taken') throw new Error('the first agent could not take it');

    let releasedAt = 0;
    setTimeout(() => {
      releasedAt = Date.now();
      void registry.release(taken.lease.id, first, now());
    }, 200);

    const gate = new LeaseGate({ registry, now, ceilingMs: 5_000 });
    const verdict = await gate.claim('src/billing/invoice.ts', second, 'edit');
    const proceededAt = Date.now();

    expect(verdict.outcome).toBe(LEASE_GATE.WAITED);
    expect(releasedAt).toBeGreaterThan(0);
    expect(proceededAt - releasedAt).toBeLessThan(300);
  });
});

describe('two agents on two machines', () => {
  it('waits for the other machine to let go, then proceeds', async () => {
    const clock = new Clock();
    const registry = new LeaseRegistry(await home(), () => true);
    const other = new OtherMachine();
    const gate = new LeaseGate({
      registry,
      shared: other,
      now: clock.now,
      sleep: async (ms) => {
        await clock.sleep(ms);
        // The other machine finishes a few asks in.
        if (other.asked >= 3) other.free();
      },
      ceilingMs: 45_000,
    });

    const verdict = await gate.claim('src/billing/invoice.ts', second, 'edit');
    expect(verdict.outcome).toBe(LEASE_GATE.WAITED);
    expect(proceeds(verdict)).toBe(true);
    expect((await registry.held(clock.now())).map((each) => each.holder.agent)).toEqual([
      'claude-code',
    ]);
  });

  /* Doubling to two seconds: forty five seconds of asking is a few dozen calls, not
     one every quarter second from every waiting agent in the workspace. */
  it('backs off while it waits, and refuses naming the holder when the window ends', async () => {
    const clock = new Clock();
    const registry = new LeaseRegistry(await home(), () => true);
    const other = new OtherMachine();
    const gate = new LeaseGate({
      registry,
      shared: other,
      now: clock.now,
      sleep: clock.sleep,
      ceilingMs: 45_000,
    });

    const verdict = await gate.claim('src/billing/invoice.ts', second, 'edit');
    expect(verdict.outcome).toBe(LEASE_GATE.TIMED_OUT);
    expect(verdict.message).toContain('hermes on vps-1');
    expect(verdict.sharedLeaseId).toBe('lse_9');
    expect(other.asked).toBeLessThan(30);
    // Nothing is left held here for a path this session never got.
    expect(await registry.held(clock.now())).toEqual([]);
  });
});

describe('when the workspace cannot be asked', () => {
  it('goes ahead and says plainly that a collision was not ruled out', async () => {
    const clock = new Clock();
    const gate = new LeaseGate({
      registry: new LeaseRegistry(await home(), () => true),
      shared: answering({
        outcome: SHARED_OUTCOME.UNKNOWN,
        because: 'the control plane did not answer',
        unanswered: true,
      }),
      now: clock.now,
      sleep: clock.sleep,
    });

    const verdict = await gate.claim('src/billing/invoice.ts', second, 'edit');
    expect(verdict.outcome).toBe(LEASE_GATE.TAKEN);
    expect(verdict.unconfirmed).toBe(
      'Could not check whether another machine is writing src/billing/invoice.ts, because the control plane did not answer. The write went ahead, but a collision with another machine was not ruled out.',
    );
  });

  it('says nothing where there was no register to ask', async () => {
    const clock = new Clock();
    const gate = new LeaseGate({
      registry: new LeaseRegistry(await home(), () => true),
      shared: answering({
        outcome: SHARED_OUTCOME.UNKNOWN,
        because: 'this machine is not enrolled',
      }),
      now: clock.now,
      sleep: clock.sleep,
    });

    const verdict = await gate.claim('src/billing/invoice.ts', second, 'edit');
    expect(verdict.unconfirmed).toBeUndefined();
  });

  it('marks an enrolled machine that got no answer, and a plan refusal not', async () => {
    const enrolled = await home();
    await mkdir(join(enrolled, MEMNOX_HOME), { recursive: true });
    await writeFile(
      join(enrolled, MEMNOX_HOME, 'account.json'),
      JSON.stringify({
        version: 1,
        baseUrl: 'https://control.example.com',
        workspaceId: 'acme',
        machineId: 'mch_1',
        token: 'mch_token',
        privateKey: 'pem',
        enrolledAt: '2026-09-05T10:00:00.000Z',
      }),
    );
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const status = (code: number) =>
      (async () =>
        new Response('{}', { status: code })) as unknown as typeof globalThis.fetch;

    const down = await new CloudLeases(enrolled, failing).take('src/a.ts', second, 5);
    const fault = await new CloudLeases(enrolled, status(503)).take(
      'src/a.ts',
      second,
      5,
    );
    const plan = await new CloudLeases(enrolled, status(403)).take('src/a.ts', second, 5);

    expect(down).toMatchObject({ outcome: SHARED_OUTCOME.UNKNOWN, unanswered: true });
    expect(fault).toMatchObject({ outcome: SHARED_OUTCOME.UNKNOWN, unanswered: true });
    expect(plan).not.toHaveProperty('unanswered');
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LeaseHolder } from '../src/coordination/lease';
import { LEASE_OUTCOME, LeaseRegistry } from '../src/coordination/lease-store';
import { regionsMeet, sameCode } from '../src/coordination/region-overlap';
import type { WrittenRegion } from '../src/coordination/written-region';

const NOW = '2026-09-05T10:00:00.000Z';
const cursor: LeaseHolder = { agent: 'cursor', sessionId: 'ses_1', pid: 111 };
const claude: LeaseHolder = { agent: 'claude-code', sessionId: 'ses_2', pid: 222 };
const living = (): boolean => true;
const registry = async (): Promise<LeaseRegistry> =>
  new LeaseRegistry(await mkdtemp(join(tmpdir(), 'memnox-regions-')), living);

const FILE = 'src/billing/payment-service.ts';
const retry: WrittenRegion = {
  lines: [{ from: 6, to: 12 }],
  symbols: ['PaymentService.retryCharge'],
};
const refund: WrittenRegion = {
  lines: [{ from: 14, to: 16 }],
  symbols: ['PaymentService.refund'],
};

describe('two agents on one machine in one file', () => {
  it('lets them work on different functions side by side', async () => {
    const leases = await registry();
    const first = await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    const second = await leases.take({ path: FILE, holder: claude, region: refund }, NOW);
    expect(first.outcome).toBe(LEASE_OUTCOME.TAKEN);
    expect(second.outcome).toBe(LEASE_OUTCOME.TAKEN);
  });

  it('stops the second on the same function, and names what the first holds', async () => {
    const leases = await registry();
    await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    const second = await leases.take(
      {
        path: FILE,
        holder: claude,
        region: { lines: [{ from: 9, to: 9 }], symbols: ['PaymentService.retryCharge'] },
      },
      NOW,
    );
    expect(second.outcome).toBe(LEASE_OUTCOME.HELD_BY_ANOTHER);
    if (second.outcome !== LEASE_OUTCOME.HELD_BY_ANOTHER) return;
    expect(second.holding.symbols).toEqual(['PaymentService.retryCharge']);
  });

  it('stops an edit to the class body while another agent is in one of its methods', async () => {
    const leases = await registry();
    await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    const second = await leases.take(
      {
        path: FILE,
        holder: claude,
        region: { lines: [{ from: 4, to: 4 }], symbols: ['PaymentService'] },
      },
      NOW,
    );
    expect(second.outcome).toBe(LEASE_OUTCOME.HELD_BY_ANOTHER);
  });

  it('compares lines where either side could not be named', async () => {
    const leases = await registry();
    await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    const apart = await leases.take(
      {
        path: FILE,
        holder: claude,
        region: { lines: [{ from: 1, to: 2 }], symbols: [] },
      },
      NOW,
    );
    expect(apart.outcome).toBe(LEASE_OUTCOME.TAKEN);
    const across = await leases.take(
      {
        path: FILE,
        holder: { ...claude, sessionId: 'ses_3' },
        region: { lines: [{ from: 10, to: 11 }], symbols: [] },
      },
      NOW,
    );
    expect(across.outcome).toBe(LEASE_OUTCOME.HELD_BY_ANOTHER);
  });

  it('treats an edit it could not place as the whole file', async () => {
    const leases = await registry();
    await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    const whole = await leases.take({ path: FILE, holder: claude }, NOW);
    expect(whole.outcome).toBe(LEASE_OUTCOME.HELD_BY_ANOTHER);
  });

  it('grows one lease as a session moves to another function, so the next agent sees both', async () => {
    const leases = await registry();
    await leases.take({ path: FILE, holder: cursor, region: retry }, NOW);
    await leases.take({ path: FILE, holder: cursor, region: refund }, NOW);
    const held = await leases.held(NOW);
    expect(held).toHaveLength(1);
    expect(held[0]?.symbols).toEqual([
      'PaymentService.retryCharge',
      'PaymentService.refund',
    ]);

    const blocked = await leases.take(
      {
        path: FILE,
        holder: claude,
        region: { lines: [{ from: 15, to: 15 }], symbols: ['PaymentService.refund'] },
      },
      NOW,
    );
    expect(blocked.outcome).toBe(LEASE_OUTCOME.HELD_BY_ANOTHER);
  });
});

describe('what counts as the same code', () => {
  it('is one declaration, one inside the other, or one method spelled bare', () => {
    expect(sameCode('PaymentService.retryCharge', 'PaymentService.retryCharge')).toBe(
      true,
    );
    expect(sameCode('PaymentService', 'PaymentService.retryCharge')).toBe(true);
    expect(sameCode('retryCharge', 'PaymentService.retryCharge')).toBe(true);
    expect(sameCode('PaymentService.refund', 'PaymentService.retryCharge')).toBe(false);
    expect(sameCode('Payment', 'PaymentService.retryCharge')).toBe(false);
  });

  it('never narrows across a directory and a file', () => {
    expect(
      regionsMeet({ path: 'src/billing' }, { path: FILE, lines: [{ from: 1, to: 1 }] }),
    ).toBe(true);
  });
});

describe('which checkouts are one repository', () => {
  const file = { path: 'src/billing.ts' };

  it('joins two checkouts that name one project', () => {
    expect(
      regionsMeet(
        { ...file, repository: '/work/api', project: 'acme/api' },
        { ...file, repository: '/work/api-wt', project: 'acme/api' },
      ),
    ).toBe(true);
  });

  it('keeps two projects apart even in one folder name', () => {
    expect(
      regionsMeet(
        { ...file, repository: '/a/api', project: 'acme/api' },
        { ...file, repository: '/b/api', project: 'other/api' },
      ),
    ).toBe(false);
  });

  it('falls back to the checkout where either side never recorded a project', () => {
    expect(
      regionsMeet(
        { ...file, repository: '/work/api' },
        { ...file, repository: '/work/api-wt', project: 'acme/api' },
      ),
    ).toBe(false);
    expect(
      regionsMeet(
        { ...file, repository: '/work/api' },
        { ...file, repository: '/work/api', project: 'acme/api' },
      ),
    ).toBe(true);
  });
});

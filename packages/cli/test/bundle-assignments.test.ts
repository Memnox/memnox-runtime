import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHeldAssignments } from '@memnox/core';

import { applyBundle, PULL_OUTCOME, type Bundle } from '../src/sync/bundle';
import { RUNTIME_CAPABILITIES } from '../src/sync/capabilities';

/**
 * Which agent each install belongs to arrives with the rules and lands with them, whole or
 * not at all, so the rules and the agents they are written for never come from two pulls.
 */

const bundleWith = (assignments: unknown): Bundle => ({
  hash: 'h1',
  policies: [],
  rules: [],
  conditions: [],
  tags: [],
  assignments,
});

describe('the agent assignments a bundle carries', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-bundle-assignments-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('are kept as confirmed when the bundle applies, and the version is reported', async () => {
    const result = await applyBundle(
      home,
      bundleWith({
        version: 4,
        leaseSeconds: 600,
        assignments: [{ id: 'a', scope: 'agent', names: ['claude-code'], profile: 'p1' }],
      }),
    );
    expect(result.outcome).toBe(PULL_OUTCOME.APPLIED);
    expect(result.assignmentVersion).toBe(4);
    expect((await readHeldAssignments(home))?.block.version).toBe(4);
  });

  it('refuse the whole bundle when they do not read, keeping what was held', async () => {
    await applyBundle(
      home,
      bundleWith({ version: 1, leaseSeconds: 600, assignments: [] }),
    );
    const result = await applyBundle(
      home,
      bundleWith({ version: 2, leaseSeconds: 600, assignments: [{ id: 'a' }] }),
    );
    expect(result.outcome).toBe(PULL_OUTCOME.REFUSED);
    expect((await readHeldAssignments(home))?.block.version).toBe(1);
  });

  it('leave nothing held when a cloud too old to send them answers', async () => {
    await applyBundle(home, bundleWith(undefined));
    expect(await readHeldAssignments(home)).toBeNull();
  });

  it('are asked for by name, so a cloud never sends them to a runtime that cannot apply them', () => {
    expect(RUNTIME_CAPABILITIES).toContain('agent-roles');
  });
});

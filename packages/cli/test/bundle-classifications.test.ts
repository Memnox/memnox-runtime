import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyOutgoingData,
  loadPoliciesFromFile,
  setDataPatterns,
} from '@memnox/core';

import {
  applyBundle,
  orgPolicyPath,
  PULL_OUTCOME,
  type Bundle,
} from '../src/sync/bundle';

/**
 * A team's own words for what must not leave are set once in the control plane and pulled
 * with the rules, written where the gate registers a policy file's patterns as it loads it.
 */

const bundleWith = (classifications: Bundle['classifications']): Bundle => ({
  hash: 'h1',
  policies: [],
  rules: [],
  conditions: [],
  tags: [],
  ...(classifications === undefined ? {} : { classifications }),
});

describe('the workspace patterns a bundle carries', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-bundle-classifications-'));
  });
  afterEach(async () => {
    setDataPatterns(orgPolicyPath(home), []);
    setDataPatterns(`${orgPolicyPath(home)}.incoming`, []);
    await rm(home, { recursive: true, force: true });
  });

  it('reach the classifier once the gate loads the pulled file', async () => {
    const result = await applyBundle(
      home,
      bundleWith([{ classification: 'confidential', patterns: ['bluebird'] }]),
    );
    expect(result.outcome).toBe(PULL_OUTCOME.APPLIED);

    await loadPoliciesFromFile(orgPolicyPath(home));
    expect(
      classifyOutgoingData({ note: 'Bluebird ships in May' })?.classifications,
    ).toEqual(['confidential', 'sensitive']);
  });

  it('drop a pattern this runtime cannot compile and keep the rest of the bundle', async () => {
    const result = await applyBundle(
      home,
      bundleWith([
        { classification: 'codename', patterns: ['/(/'] },
        { classification: 'financial', patterns: ['kestrel'] },
      ]),
    );
    expect(result.outcome).toBe(PULL_OUTCOME.APPLIED);

    await loadPoliciesFromFile(orgPolicyPath(home));
    expect(classifyOutgoingData({ note: 'kestrel ledger' })?.classifications).toEqual([
      'financial',
      'sensitive',
    ]);
  });
});

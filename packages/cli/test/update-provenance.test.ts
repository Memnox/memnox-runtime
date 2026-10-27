import { describe, expect, it } from 'vitest';
import { installedFrom, judgeRelease } from '../src/commands/update/provenance';

/**
 * The verdict `memnox update` gives on a release before installing it. npm's own output is
 * the input, so these are the shapes `npm audit signatures --include-attestations` prints.
 */

// Self signed stand ins for Fulcio certificates; npm checked the real chain before this runs.
const RELEASE_CERT = [
  'MIIB0zCCAXigAwIBAgIUTIAMSroebOb3adctVxFGtauXGAYwCgYIKoZIzj0EAwIwDzENMAsGA1UECgwE',
  'dGVzdDAeFw0yNjEwMDcyMzMwMzhaFw0zNjEwMDQyMzMwMzhaMA8xDTALBgNVBAoMBHRlc3QwWTATBgcq',
  'hkjOPQIBBggqhkjOPQMBBwNCAATsaW3lniuu49+BD2f2H0iVhLhdamEBAIkWAgOVVIJHIuoPaR/3knst',
  '3mdRnmsML+2bJkT8F+wK/chH4bCTse/To4GxMIGuMB0GA1UdDgQWBBSedLYnvxdG118dqvGQXkMROpSJ',
  'JzAfBgNVHSMEGDAWgBSedLYnvxdG118dqvGQXkMROpSJJzAPBgNVHRMBAf8EBTADAQH/MFsGA1UdEQRU',
  'MFKGUGh0dHBzOi8vZ2l0aHViLmNvbS9NZW1ub3gvbWVtbm94Ly5naXRodWIvd29ya2Zsb3dzL3JlbGVh',
  'c2UueW1sQHJlZnMvdGFncy92MC4xNC4wMAoGCCqGSM49BAMCA0kAMEYCIQCXYSeZde8jvzdbGLuHllMk',
  'Nfljo0SX6juNKxF5gilyuQIhAPCJ0cpB5lVjyCJwLO6O/tJFJeGGXdZ8+pekrOsNYs2l',
].join('');

const FORK_CERT = [
  'MIIB0DCCAXagAwIBAgIUDPBCQin3iTzIc/c+On8LX9OS6QUwCgYIKoZIzj0EAwIwDzENMAsGA1UECgwE',
  'dGVzdDAeFw0yNjEwMDcyMzMwMzhaFw0zNjEwMDQyMzMwMzhaMA8xDTALBgNVBAoMBHRlc3QwWTATBgcq',
  'hkjOPQIBBggqhkjOPQMBBwNCAAS/23VLucNClr4iSMA0gSBFXM763X7UKIiIGaB6NI3s40MicAq0Uyn5',
  'xqew7/FzKik0RVVQm4LmIHv4+mUde4yHo4GvMIGsMB0GA1UdDgQWBBSSCT9va/jiYdM7oVgwKBgnmhWM',
  '0TAfBgNVHSMEGDAWgBSSCT9va/jiYdM7oVgwKBgnmhWM0TAPBgNVHRMBAf8EBTADAQH/MFkGA1UdEQRS',
  'MFCGTmh0dHBzOi8vZ2l0aHViLmNvbS9ldmlsL21lbW5veC8uZ2l0aHViL3dvcmtmbG93cy9yZWxlYXNl',
  'LnltbEByZWZzL3RhZ3MvdjAuMTQuMDAKBggqhkjOPQQDAgNIADBFAiAmB2xkBUIikswoQEVC0G9/D4yA',
  'Lol2due8dWzWfbKpYgIhAM4CGoYUpH31MJQtzSqoBAMvu+EEyh7Uhn+rdvGbFYFH',
].join('');

const RELEASE_WORKFLOW = {
  repository: 'https://github.com/Memnox/memnox',
  path: '.github/workflows/release.yml',
  ref: 'refs/tags/v0.14.0',
};

interface Workflow {
  repository: string;
  path: string;
  ref: string;
}

function bundle(workflow: Workflow, cert: string): unknown {
  const statement = {
    predicate: { buildDefinition: { externalParameters: { workflow } } },
  };
  return {
    predicateType: 'https://slsa.dev/provenance/v1',
    bundle: {
      verificationMaterial: { certificate: { rawBytes: cert } },
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      },
    },
  };
}

function verifiedRow(
  name: string,
  workflow: Workflow = RELEASE_WORKFLOW,
  cert: string = RELEASE_CERT,
): unknown {
  return { name, version: '0.14.0', attestationBundles: [bundle(workflow, cert)] };
}

const TREE = [
  { name: 'memnox', version: '0.14.0' },
  { name: '@memnox/core', version: '0.14.0' },
  { name: 'commander', version: '12.1.0' },
];

function audit(body: Record<string, unknown>): string {
  return JSON.stringify({ invalid: [], missing: [], ...body });
}

describe('judging a release before it is installed', () => {
  it('passes a release whose every package of ours was built by the release workflow', () => {
    const verdict = judgeRelease(
      audit({ verified: [verifiedRow('memnox'), verifiedRow('@memnox/core')] }),
      TREE,
      '0.14.0',
    );

    expect(verdict).toEqual({
      ok: true,
      checked: ['memnox@0.14.0', '@memnox/core@0.14.0'],
    });
  });

  it('refuses a package of ours published without provenance, as a stolen token would', () => {
    const verdict = judgeRelease(
      audit({ verified: [verifiedRow('memnox')] }),
      TREE,
      '0.14.0',
    );

    expect(verdict).toEqual({
      ok: false,
      reason:
        '@memnox/core@0.14.0 was published without provenance, so nothing ties it to https://github.com/Memnox/memnox',
    });
  });

  it('refuses provenance from another repository', () => {
    const fork = { ...RELEASE_WORKFLOW, repository: 'https://github.com/evil/memnox' };
    const verdict = judgeRelease(
      audit({ verified: [verifiedRow('memnox', fork), verifiedRow('@memnox/core')] }),
      TREE,
      '0.14.0',
    );

    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain(
      'built by https://github.com/evil/memnox',
    );
  });

  it('refuses a build from a branch rather than a version tag', () => {
    const branch = { ...RELEASE_WORKFLOW, ref: 'refs/heads/main' };
    const verdict = judgeRelease(
      audit({ verified: [verifiedRow('memnox', branch), verifiedRow('@memnox/core')] }),
      TREE,
      '0.14.0',
    );

    expect(!verdict.ok && verdict.reason).toContain('at refs/heads/main');
  });

  it('refuses a statement naming us under a certificate issued to somebody else', () => {
    const verdict = judgeRelease(
      audit({
        verified: [
          verifiedRow('memnox', RELEASE_WORKFLOW, FORK_CERT),
          verifiedRow('@memnox/core'),
        ],
      }),
      TREE,
      '0.14.0',
    );

    expect(!verdict.ok && verdict.reason).toContain('signing certificate does not name');
  });

  it('refuses whatever npm found invalid, our package or a dependency', () => {
    const invalid = [
      { name: 'commander', version: '12.1.0', code: 'EINTEGRITYSIGNATURE' },
    ];
    const verdict = judgeRelease(
      audit({ invalid, verified: [verifiedRow('memnox'), verifiedRow('@memnox/core')] }),
      TREE,
      '0.14.0',
    );

    expect(verdict).toEqual({
      ok: false,
      reason: "commander@12.1.0 failed npm's signature check (EINTEGRITYSIGNATURE)",
    });
  });

  it('refuses a package npm found with no registry signature', () => {
    const missing = [{ name: 'commander', version: '12.1.0' }];
    const verdict = judgeRelease(audit({ missing, verified: [] }), TREE, '0.14.0');

    expect(!verdict.ok && verdict.reason).toBe(
      'commander@12.1.0 carries no registry signature',
    );
  });

  it('refuses rather than guesses when npm is too old to show who built it', () => {
    const verdict = judgeRelease(audit({}), TREE, '0.14.0');

    expect(!verdict.ok && verdict.reason).toContain('this npm is too old');
  });

  it('refuses when npm did not answer at all', () => {
    expect(judgeRelease('', TREE, '0.14.0').ok).toBe(false);
  });

  it('refuses when the version asked for is not what npm installed', () => {
    const verdict = judgeRelease(audit({ verified: [] }), TREE, '0.15.0');

    expect(!verdict.ok && verdict.reason).toContain('memnox@0.15.0 was not in');
  });
});

describe('reading what npm installed', () => {
  it('names every package in the lockfile, nested ones included', () => {
    const lockfile = JSON.stringify({
      packages: {
        '': { name: 'scratch' },
        'node_modules/memnox': { version: '0.14.0' },
        'node_modules/memnox/node_modules/@memnox/core': { version: '0.14.0' },
      },
    });

    expect(installedFrom(lockfile)).toEqual([
      { name: 'memnox', version: '0.14.0' },
      { name: '@memnox/core', version: '0.14.0' },
    ]);
  });
});

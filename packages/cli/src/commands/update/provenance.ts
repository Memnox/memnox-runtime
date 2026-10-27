/**
 * Whether a release about to be installed was built by this repository's release workflow,
 * judged from what `npm audit signatures` and the lockfile say; npm does the cryptography.
 */
import { X509Certificate } from 'node:crypto';

/** The only build allowed to produce a package that runs on every command an agent issues. */
const RELEASE_SOURCE = {
  repository: 'https://github.com/Memnox/memnox',
  workflow: '.github/workflows/release.yml',
  refPrefix: 'refs/tags/v',
} as const;

const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1';

/** The packages this repository publishes, which are held to provenance rather than a signature alone. */
function isOurs(name: string): boolean {
  return name === 'memnox' || name.startsWith('@memnox/');
}

export type Verdict = { ok: true; checked: string[] } | { ok: false; reason: string };

interface Installed {
  name: string;
  version: string;
}

interface Workflow {
  repository: string;
  path: string;
  ref: string;
}

/** Every package npm put in the scratch install, read from its lockfile so nothing is guessed. */
export function installedFrom(lockfile: string): Installed[] {
  const lock: unknown = JSON.parse(lockfile);
  const packages = field(lock, 'packages');
  if (!isRecord(packages)) return [];
  return Object.entries(packages).flatMap(([path, entry]) => {
    const version = field(entry, 'version');
    const at = path.lastIndexOf('node_modules/');
    if (at === -1 || typeof version !== 'string') return [];
    return [{ name: path.slice(at + 'node_modules/'.length), version }];
  });
}

/** The verdict on one release: npm's own failures first, then who built each of ours. */
export function judgeRelease(
  auditOutput: string,
  installed: readonly Installed[],
  release: string,
): Verdict {
  let audit: unknown;
  try {
    audit = JSON.parse(auditOutput);
  } catch {
    return {
      ok: false,
      reason: 'npm could not check its signatures, so nothing vouches for it',
    };
  }
  const failed = npmFailure(audit);
  if (failed !== null) return { ok: false, reason: failed };
  const ours = installed.filter((pkg) => isOurs(pkg.name));
  if (!ours.some((pkg) => pkg.name === 'memnox' && pkg.version === release))
    return {
      ok: false,
      reason: `memnox@${release} was not in what npm installed to check`,
    };
  const verified = field(audit, 'verified');
  // An npm that predates --include-attestations verifies but cannot show who built it.
  if (!Array.isArray(verified))
    return {
      ok: false,
      reason:
        'this npm is too old to show who built a package, and "npm install -g npm@latest" brings one that can',
    };
  for (const pkg of ours) {
    const problem = provenanceProblem(pkg, verified);
    if (problem !== null) return { ok: false, reason: problem };
  }
  return { ok: true, checked: ours.map((pkg) => `${pkg.name}@${pkg.version}`) };
}

function npmFailure(audit: unknown): string | null {
  const invalid = first(field(audit, 'invalid'));
  if (invalid !== null)
    return `${idOf(invalid)} failed npm's signature check (${String(field(invalid, 'code'))})`;
  const missing = first(field(audit, 'missing'));
  if (missing !== null) return `${idOf(missing)} carries no registry signature`;
  return null;
}

function provenanceProblem(pkg: Installed, verified: readonly unknown[]): string | null {
  const id = `${pkg.name}@${pkg.version}`;
  const entry = verified.find(
    (row) => field(row, 'name') === pkg.name && field(row, 'version') === pkg.version,
  );
  const bundle = entry === undefined ? undefined : provenanceBundle(entry);
  if (bundle === undefined)
    return `${id} was published without provenance, so nothing ties it to ${RELEASE_SOURCE.repository}`;
  const claimed = workflowOf(bundle);
  if (claimed === null) return `${id} has provenance npm could not read`;
  if (!fromRelease(claimed))
    return `${id} was built by ${claimed.repository} ${claimed.path} at ${claimed.ref}, not by ${RELEASE_SOURCE.repository} ${RELEASE_SOURCE.workflow} at a version tag`;
  // The statement is what the builder said; the certificate is what Sigstore issued to it.
  if (!signedByRelease(bundle))
    return `${id} has provenance whose signing certificate does not name ${RELEASE_SOURCE.repository}`;
  return null;
}

function fromRelease(claimed: Workflow): boolean {
  return (
    claimed.repository === RELEASE_SOURCE.repository &&
    claimed.path === RELEASE_SOURCE.workflow &&
    claimed.ref.startsWith(RELEASE_SOURCE.refPrefix)
  );
}

function provenanceBundle(entry: unknown): unknown {
  const bundles = field(entry, 'attestationBundles');
  if (!Array.isArray(bundles)) return undefined;
  const items: readonly unknown[] = bundles;
  const found = items.find((item) => field(item, 'predicateType') === SLSA_PROVENANCE);
  return found === undefined ? undefined : field(found, 'bundle');
}

/** The workflow named in the signed SLSA statement, which npm checked against the tarball. */
function workflowOf(bundle: unknown): Workflow | null {
  const payload = field(field(bundle, 'dsseEnvelope'), 'payload');
  if (typeof payload !== 'string') return null;
  let statement: unknown;
  try {
    statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  const params = field(
    field(field(statement, 'predicate'), 'buildDefinition'),
    'externalParameters',
  );
  const workflow = field(params, 'workflow');
  const repository = field(workflow, 'repository');
  const path = field(workflow, 'path');
  const ref = field(workflow, 'ref');
  if (
    typeof repository !== 'string' ||
    typeof path !== 'string' ||
    typeof ref !== 'string'
  )
    return null;
  return { repository, path, ref };
}

function signedByRelease(bundle: unknown): boolean {
  const material = field(bundle, 'verificationMaterial');
  const chain = first(field(field(material, 'x509CertificateChain'), 'certificates'));
  const raw = field(field(material, 'certificate') ?? chain, 'rawBytes');
  if (typeof raw !== 'string') return false;
  let names: string | undefined;
  try {
    names = new X509Certificate(Buffer.from(raw, 'base64')).subjectAltName;
  } catch {
    return false;
  }
  const identity = `URI:${RELEASE_SOURCE.repository}/${RELEASE_SOURCE.workflow}@${RELEASE_SOURCE.refPrefix}`;
  return (names ?? '').split(', ').some((name) => name.startsWith(identity));
}

function idOf(row: unknown): string {
  return `${String(field(row, 'name'))}@${String(field(row, 'version'))}`;
}

function first(value: unknown): unknown {
  if (!Array.isArray(value)) return null;
  const items: readonly unknown[] = value;
  return items[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

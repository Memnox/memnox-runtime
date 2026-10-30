import { join } from 'node:path';
import { runGit } from '../coordination/git-region';
import { secondsToMs } from '../domain/time';
import { isInside } from '../gate/containment';
import { readPolicyDocumentFile } from '../gate/policy-file';
import { allProjectStates, readProjectManifest } from './project-store';
import { sharedProjectFor, sharedRepositoryOf } from './shared-project';
import { readOrgProjects } from './shared-project-store';

/**
 * The project an action belongs to, as rules name it in their `project`, read from where the
 * action runs: a shared clone's organization rule pack first, then the project its own rule file
 * declares for the opened project around it. Without this a project scoped rule never decides.
 */

/** Short, since a seam waits on it before an action runs. */
const ORIGIN_TIMEOUT_MS = secondsToMs(2);

/** Reads a folder's `origin`; injected so a test needs no git. */
export type OriginAt = (cwd: string) => Promise<string | undefined>;

/** The `origin` remote of the checkout holding `cwd`, or undefined outside one. */
export async function gitOriginAt(cwd: string): Promise<string | undefined> {
  const said = await runGit(['remote', 'get-url', 'origin'], cwd, ORIGIN_TIMEOUT_MS);
  const origin = said === null ? '' : said.trim();
  return origin === '' ? undefined : origin;
}

/** The `projectId` an action in `cwd` carries, or undefined where no project names it. */
export async function projectIdAt(
  home: string,
  cwd: string,
  originAt: OriginAt = gitOriginAt,
): Promise<string | undefined> {
  return (
    (await sharedRulePackAt(home, cwd, originAt)) ?? (await declaredProjectAt(home, cwd))
  );
}

async function sharedRulePackAt(
  home: string,
  cwd: string,
  originAt: OriginAt,
): Promise<string | undefined> {
  const projects = await readOrgProjects(home);
  // Most machines carry no shared project, and they pay no git call for it.
  if (projects.length === 0) return undefined;
  const origin = await originAt(cwd);
  const shared = sharedProjectFor(
    projects,
    origin === undefined ? undefined : sharedRepositoryOf(origin),
  );
  return shared === undefined ? undefined : shared.rulePack;
}

/** The innermost opened project around `cwd`, by the `project` its rule file declares. */
async function declaredProjectAt(home: string, cwd: string): Promise<string | undefined> {
  const around = (await allProjectStates(home))
    .filter((state) => isInside(state.root, cwd))
    .sort((one, two) => two.root.length - one.root.length)[0];
  if (around === undefined) return undefined;
  const read = await readProjectManifest(around.root);
  if (!('manifest' in read) || read.manifest.policy === undefined) return undefined;
  const document = await readPolicyDocumentFile(
    join(around.root, read.manifest.policy),
  ).catch(
    // A rule file that will not load is said on the projects page; here it names no project.
    () => null,
  );
  return document === null ? undefined : document.project;
}

/** Short, so a project opened while a long-lived seam runs decides its calls within seconds. */
const PROJECT_LOOKUP_TTL_MS = secondsToMs(10);

/** A folder's project as a long-lived seam asks for it: remembered briefly, per folder. */
export type ProjectLookup = (cwd: string) => Promise<string | undefined>;

interface ProjectLookupOptions {
  /** Injected so a test needs no git and no opened project. */
  find?: (home: string, cwd: string) => Promise<string | undefined>;
  now?: () => number;
}

/**
 * `projectIdAt` for a process that lives, such as the daemon or its egress proxy. A lookup
 * that fails names no project, so only the machine's rules decide and never fewer of them.
 */
export function projectLookup(
  home: string,
  options: ProjectLookupOptions = {},
): ProjectLookup {
  const find =
    options.find ?? ((at, cwd): Promise<string | undefined> => projectIdAt(at, cwd));
  const now = options.now ?? Date.now;
  const known = new Map<string, { at: number; project: Promise<string | undefined> }>();
  return (cwd) => {
    const kept = known.get(cwd);
    if (kept !== undefined && now() - kept.at < PROJECT_LOOKUP_TTL_MS)
      return kept.project;
    const project = find(home, cwd).catch((): undefined => undefined);
    known.set(cwd, { at: now(), project });
    return project;
  };
}

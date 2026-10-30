import { MEMORY_SCOPE } from './project';

/**
 * A repository the organization shares with this machine's owner, carried by the bundle as
 * `projects` and laid over the local clone whose `origin` reduces to the same identity. Read
 * only: what it names is changed in Memnox Cloud, and nothing here writes it back.
 */

/** The longest remote read, before it is reduced to `host/owner/name`. */
const MOST_REMOTE = 300;
/** `user@host:owner/name`, the form `git clone` prints for SSH. */
const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;
/** A remote with a scheme, `https://`, `ssh://`, `git://` and `git+ssh://`. */
const SCHEMED_REMOTE = /^(?:https?|ssh|git|git\+ssh):\/\//;
const FILE_SCHEME = /^file:/i;
/** `C:` and the like, a path on a Windows machine. */
const DRIVE_PATH = /^[a-z]:/i;
/** A host as a forge names one: letters, digits, dots and dashes, with a dot in it. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** One path segment of a repository on a forge. */
const SEGMENT = /^[a-z0-9._~-]+$/;
const GIT_SUFFIX = '.git';
const PATH_SEPARATOR = '/';
/** Owner and name at the least; a group nests more. */
const FEWEST_SEGMENTS = 2;

/** Where a shared project's agents keep what they learn; a person's own memory is never one. */
export const SHARED_PROJECT_MEMORY = {
  PROJECT: MEMORY_SCOPE.PROJECT,
  NONE: MEMORY_SCOPE.NONE,
} as const;

export type SharedProjectMemory =
  (typeof SHARED_PROJECT_MEMORY)[keyof typeof SHARED_PROJECT_MEMORY];

const SHARED_MEMORIES: readonly string[] = Object.values(SHARED_PROJECT_MEMORY);

/** A project as the bundle carries it, in the cloud's own words. */
export interface OrgProject {
  /** The cloud's id, which project memory is keyed on, since a repository keeps it across edits. */
  id: string;
  name: string;
  /** `host/owner/name`, lower case, as `sharedRepositoryOf` reduces a remote. */
  repository: string;
  description?: string;
  mcpServers: string[];
  skills: string[];
  /** The `project` the bundle's rules carry for this repository. */
  rulePack?: string;
  agents?: string[];
  memory: SharedProjectMemory;
}

/**
 * A git remote reduced to the one identity every clone shares, `host/owner/name` in lower case
 * with no scheme, user, port or `.git`, exactly as Memnox Cloud reduces it; undefined for a path.
 */
export function sharedRepositoryOf(remote: string): string | undefined {
  const trimmed = remote.trim().toLowerCase();
  if (trimmed === '' || trimmed.length > MOST_REMOTE) return undefined;
  if (isLocalPath(trimmed)) return undefined;
  const parts = hostAndPath(trimmed);
  if (parts === undefined || !HOST.test(parts.host)) return undefined;
  const segments = parts.path.split(PATH_SEPARATOR).filter((segment) => segment !== '');
  const last = segments.length - 1;
  const named = segments.map((segment, index) =>
    index === last && segment.endsWith(GIT_SUFFIX)
      ? segment.slice(0, -GIT_SUFFIX.length)
      : segment,
  );
  if (named.length < FEWEST_SEGMENTS) return undefined;
  if (named.some((segment) => !isSegment(segment))) return undefined;
  return [parts.host, ...named].join(PATH_SEPARATOR);
}

function isLocalPath(remote: string): boolean {
  return (
    remote.startsWith(PATH_SEPARATOR) ||
    remote.startsWith('~') ||
    remote.startsWith('.') ||
    remote.includes('\\') ||
    FILE_SCHEME.test(remote) ||
    (DRIVE_PATH.test(remote) && !SCHEMED_REMOTE.test(remote))
  );
}

/** The host and the path after it, whichever of the three spellings the remote uses. */
function hostAndPath(remote: string): { host: string; path: string } | undefined {
  if (SCHEMED_REMOTE.test(remote)) {
    let url: URL;
    try {
      url = new URL(remote.replace(/^git\+ssh:/, 'ssh:'));
    } catch {
      // Not a URL after all, which is a remote nobody can share.
      return undefined;
    }
    return { host: url.hostname, path: url.pathname };
  }
  const scp = SCP_REMOTE.exec(remote);
  if (scp !== null && scp[1] !== undefined && scp[2] !== undefined) {
    return { host: scp[1], path: scp[2] };
  }
  const slash = remote.indexOf(PATH_SEPARATOR);
  if (slash <= 0) return undefined;
  return { host: remote.slice(0, slash), path: remote.slice(slash) };
}

function isSegment(segment: string): boolean {
  return SEGMENT.test(segment) && segment !== '.' && segment !== '..';
}

/** Every project the bundle carried that reads whole; one that does not is left out rather than half laid. */
export function orgProjectsFrom(value: unknown): OrgProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) => {
    const project = orgProjectOf(each);
    return project === null ? [] : [project];
  });
}

function orgProjectOf(value: unknown): OrgProject | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const { id, name, repository, description, rulePack, memory } = raw;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null;
  if (typeof repository !== 'string') return null;
  // The cloud sends it reduced already; reducing again refuses a path a hand edit slipped in.
  if (sharedRepositoryOf(repository) !== repository) return null;
  if (typeof memory !== 'string' || !SHARED_MEMORIES.includes(memory)) return null;
  const mcpServers = textList(raw['mcpServers']);
  const skills = textList(raw['skills']);
  const agents = raw['agents'] === undefined ? undefined : textList(raw['agents']);
  if (mcpServers === null || skills === null || agents === null) return null;
  return {
    id,
    name,
    repository,
    ...(typeof description === 'string' ? { description } : {}),
    mcpServers,
    skills,
    ...(typeof rulePack === 'string' && rulePack !== '' ? { rulePack } : {}),
    ...(agents === undefined ? {} : { agents }),
    // Cast is safe: checked against the shared memory scopes above.
    memory: memory as SharedProjectMemory,
  };
}

function textList(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? [...value]
    : null;
}

/** The project shared for this repository identity, if the organization shares one with this person. */
export function sharedProjectFor(
  projects: readonly OrgProject[],
  repository: string | undefined,
): OrgProject | undefined {
  if (repository === undefined) return undefined;
  return projects.find((project) => project.repository === repository);
}

/** What the organization hands this project once its names are looked up in the same bundle. */
export interface ResolvedOrgProject {
  servers: string[];
  skills: string[];
  /** Rules in the bundle that carry the project's rule pack. */
  rules: number;
  /** Each name the bundle does not carry, said in a sentence, and left out. */
  skipped: string[];
}

/** Servers and skills by name against the organization's own, the rule pack against the rules' `project`. */
export function resolveOrgProject(
  project: OrgProject,
  carried: {
    servers: readonly string[];
    skills: readonly string[];
    ruleProjects: readonly string[];
  },
): ResolvedOrgProject {
  const servers = project.mcpServers.filter((name) => carried.servers.includes(name));
  const skills = project.skills.filter((name) => carried.skills.includes(name));
  const rules =
    project.rulePack === undefined
      ? 0
      : carried.ruleProjects.filter((each) => each === project.rulePack).length;
  const skipped = [
    ...missing(project.mcpServers, servers, 'server'),
    ...missing(project.skills, skills, 'skill'),
    ...(project.rulePack !== undefined && rules === 0
      ? [
          `No rule the organization publishes carries the ${project.rulePack} rule pack, so none is in force for it.`,
        ]
      : []),
  ];
  return { servers, skills, rules, skipped };
}

function missing(
  named: readonly string[],
  found: readonly string[],
  what: string,
): string[] {
  return named
    .filter((name) => !found.includes(name))
    .map(
      (name) =>
        `${name} is not a ${what} the organization hands out now, so this project goes without it.`,
    );
}

const SHARED_MEMORY_PREFIX = 'org-project:';

/** Where a shared project's memory is kept: on the cloud's id, apart from personal memory and from any path. */
export function sharedProjectMemoryKey(project: Pick<OrgProject, 'id'>): string {
  return `${SHARED_MEMORY_PREFIX}${project.id}`;
}

/** The line every local edit of a shared project is refused with. */
export function orgProjectOwned(name: string): string {
  return `${name} is the organization's project, so it is changed in Memnox Cloud rather than here.`;
}

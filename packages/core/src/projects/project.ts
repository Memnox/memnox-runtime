import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { HubAssignment } from '../mcp/registry';
import type { SkillAssignment } from '../skills/hub';

/**
 * A project: one repository and what every agent opened in it is given. `.memnox/project.toml` is
 * committed so a team shares it; what is this machine's own stays under the Memnox home.
 */

/** Inside the repository, beside the code fingerprint and the hooks. */
export const PROJECT_FILE = join('.memnox', 'project.toml');

/** Under the Memnox home: one folder per project, for what never leaves this machine. */
export const PROJECTS_DIR = 'projects';

const PROJECT_ID_PREFIX = 'prj_';
const PROJECT_ID_LENGTH = 12;

/** Where what an agent learns in this project is kept and read from. */
export const MEMORY_SCOPE = {
  /** Kept with the project, so every agent opened in it reads the same. */
  PROJECT: 'project',
  /** The person's own memory, shared across every project. */
  PERSONAL: 'personal',
  /** Nothing kept. */
  NONE: 'none',
} as const;

export type MemoryScope = (typeof MEMORY_SCOPE)[keyof typeof MEMORY_SCOPE];

const MEMORY_SCOPES: readonly string[] = Object.values(MEMORY_SCOPE);

export interface ProjectManifest {
  name: string;
  /** Files whose text is the project's instructions, relative to the repository. */
  instructions: string[];
  /** MCP Hub servers, by name, given to every agent opened here. */
  servers: string[];
  /** Skills Hub skills, by name, written into every agent opened here. */
  skills: string[];
  /** The agents the project is opened with; empty is every agent seen working in it. */
  agents: string[];
  /** The rule file, relative to the repository. */
  policy?: string;
  memory: MemoryScope;
}

/** What opening a project hands its agents that they did not have, which the person signs. */
export interface ProjectChange {
  projectId: string;
  root: string;
  servers: HubAssignment[];
  skills: ({ name: string } & SkillAssignment)[];
  /** The rule file put in force, absolute. */
  policy?: string;
}

/** The machine's own id for a repository, from its path, so two clones are two projects. */
export function projectIdOf(root: string): string {
  const hash = createHash('sha256').update(root, 'utf8').digest('hex');
  return `${PROJECT_ID_PREFIX}${hash.slice(0, PROJECT_ID_LENGTH)}`;
}

/** Checked before an id becomes a folder name, since a screen sends it. */
export function isProjectId(id: string): boolean {
  return new RegExp(`^${PROJECT_ID_PREFIX}[0-9a-f]{${PROJECT_ID_LENGTH}}$`).test(id);
}

/** Every list empty, memory kept with the project. */
export function emptyManifest(name: string): ProjectManifest {
  return {
    name,
    instructions: [],
    servers: [],
    skills: [],
    agents: [],
    memory: MEMORY_SCOPE.PROJECT,
  };
}

interface ProjectToml {
  name: string;
  agents: string[];
  instructions: { sources: string[] };
  mcp: { servers: string[] };
  skills: { names: string[] };
  policy?: { file: string };
  memory: { scope: string };
}

export function projectToml(manifest: ProjectManifest): string {
  const document: ProjectToml = {
    name: manifest.name,
    agents: [...manifest.agents],
    instructions: { sources: [...manifest.instructions] },
    mcp: { servers: [...manifest.servers] },
    skills: { names: [...manifest.skills] },
    ...(manifest.policy === undefined ? {} : { policy: { file: manifest.policy } }),
    memory: { scope: manifest.memory },
  };
  return stringifyToml(document);
}

/** The manifest, or every reason it will not read; a list left out is a list with nothing in it. */
export function parseProjectToml(text: string): ProjectManifest | { problems: string[] } {
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text);
  } catch (err) {
    return {
      problems: [
        `project.toml will not read: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const problems: string[] = [];
  const name = raw['name'];
  if (typeof name !== 'string' || name.trim() === '')
    problems.push('project.toml needs a name.');
  const memory = textAt(tableAt(raw, 'memory'), 'scope') ?? MEMORY_SCOPE.PROJECT;
  if (!MEMORY_SCOPES.includes(memory))
    problems.push(`A memory scope is one of ${MEMORY_SCOPES.join(', ')}.`);
  const policy = textAt(tableAt(raw, 'policy'), 'file');
  const manifest: ProjectManifest = {
    name: typeof name === 'string' ? name.trim() : '',
    agents: listAt(raw, 'agents', problems),
    instructions: listAt(tableAt(raw, 'instructions'), 'sources', problems),
    servers: listAt(tableAt(raw, 'mcp'), 'servers', problems),
    skills: listAt(tableAt(raw, 'skills'), 'names', problems),
    ...(policy === undefined ? {} : { policy }),
    // Cast is safe: checked against the scopes just above, and a problem otherwise.
    memory: memory as MemoryScope,
  };
  problems.push(...manifestProblems(manifest));
  return problems.length > 0 ? { problems } : manifest;
}

/** Every path stays inside the repository, so a shared file cannot point an agent at the home folder. */
export function manifestProblems(manifest: ProjectManifest): string[] {
  const paths = [
    ...manifest.instructions,
    ...(manifest.policy === undefined ? [] : [manifest.policy]),
  ];
  return paths
    .filter((path) => !isInsidePath(path))
    .map((path) => `${path} is outside the repository, so a project cannot name it.`);
}

function isInsidePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('~') || path.includes('\\'))
    return false;
  return !path.split('/').includes('..');
}

function tableAt(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key];
  // Cast is safe: a plain table is checked for in the same expression.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textAt(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function listAt(raw: Record<string, unknown>, key: string, problems: string[]): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((each) => typeof each === 'string'))
    return [...new Set(value)];
  problems.push(`project.toml needs ${key} as a list of text.`);
  return [];
}

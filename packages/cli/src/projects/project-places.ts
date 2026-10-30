import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import {
  allProjectStates,
  CURSOR_RULES_DIR,
  CURSOR_RULES_FILE,
  emptyManifest,
  INSTRUCTION_FILES,
  isOwnInstructionFile,
  projectFilePathFor,
  readProjectManifest,
  SessionHosts,
  type ProjectManifest,
  type ProjectState,
  type SessionHost,
} from '@memnox/core';
import { POLICY_FILES } from '../policy-path';
import { knownRepositories } from '../session-tools/known-repositories';
import { mainCheckoutOf } from '../session-tools/main-checkout';

/**
 * Where the projects on this machine are: every one opened here, every repository a session ran
 * in, and every known repository that declares itself, each with the sessions that ran in it.
 */

export interface ProjectPlace {
  root: string;
  hosts: SessionHost[];
  state: ProjectState | null;
}

/** A repository the agents read, or the problems with its committed manifest. */
interface ProjectRead {
  manifest: ProjectManifest;
  declared: boolean;
  problems?: string[];
}

/** Cursor's rule files, by extension, read beside the single instruction files. */
const CURSOR_RULE_EXTENSIONS: readonly string[] = ['.mdc', '.md'];

export async function projectPlaces(home: string): Promise<ProjectPlace[]> {
  const [hosts, states] = await Promise.all([
    new SessionHosts(home).all(),
    allProjectStates(home),
  ]);
  const byRoot = new Map<string, SessionHost[]>();
  for (const host of hosts) {
    const root = rootOf(host.cwd);
    if (root !== null) byRoot.set(root, [...(byRoot.get(root) ?? []), host]);
  }
  const roots = new Set([...states.map((state) => state.root), ...byRoot.keys()]);
  for (const repository of await knownRepositories({ home }))
    if (existsSync(projectFilePathFor(repository))) roots.add(repository);
  return [...roots].map((root) => ({
    root,
    hosts: byRoot.get(root) ?? [],
    state: states.find((state) => state.root === root) ?? null,
  }));
}

/** The repository a folder belongs to, the main checkout rather than a worktree; null outside any. */
export function rootOf(folder: string | undefined): string | null {
  if (folder === undefined || !isAbsolute(folder) || !existsSync(folder)) return null;
  const root = mainCheckoutOf(folder);
  return existsSync(join(root, '.git')) ? root : null;
}

/** The committed manifest, or what the repository says of itself where nobody declared one. */
export async function readProject(root: string): Promise<ProjectRead> {
  const read = await readProjectManifest(root);
  if ('manifest' in read) return { manifest: read.manifest, declared: true };
  const found = await foundManifest(root);
  return 'problems' in read
    ? { manifest: found, declared: true, problems: read.problems }
    : { manifest: found, declared: false };
}

/** Every instruction file and rule file the repository already holds. */
async function foundManifest(root: string): Promise<ProjectManifest> {
  const policy = POLICY_FILES.find((file) => existsSync(join(root, file)));
  return {
    ...emptyManifest(basename(root)),
    instructions: await instructionFilesIn(root),
    ...(policy === undefined ? {} : { policy }),
  };
}

/** The instruction files at the top of the repository, Cursor's rules among them, never one of ours. */
async function instructionFilesIn(root: string): Promise<string[]> {
  const single = [...INSTRUCTION_FILES, CURSOR_RULES_FILE].filter((file) =>
    existsSync(join(root, file)),
  );
  const rules = await readdir(join(root, CURSOR_RULES_DIR)).catch(
    // No rules folder is a repository Cursor was never set up in.
    (): string[] => [],
  );
  const cursor = rules
    .filter((name) =>
      CURSOR_RULE_EXTENSIONS.some((extension) => name.endsWith(extension)),
    )
    .sort()
    .map((name) => `${CURSOR_RULES_DIR}/${name}`)
    .filter((path) => !isOwnInstructionFile(path));
  return [...single, ...cursor];
}

/** The agents a project is opened with: those it names, or every agent seen working in it. */
export function projectAgents(
  manifest: ProjectManifest,
  hosts: readonly SessionHost[],
): string[] {
  return manifest.agents.length > 0 ? manifest.agents : agentsSeen(hosts);
}

export function agentsSeen(hosts: readonly SessionHost[]): string[] {
  return [...new Set(hosts.map((host) => host.agent))].sort();
}

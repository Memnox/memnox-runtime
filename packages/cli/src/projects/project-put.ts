import {
  manifestProblems,
  MEMORY_SCOPE,
  writeProjectManifest,
  type MemoryScope,
  type ProjectManifest,
} from '@memnox/core';
import { rootOf } from './project-places';

/**
 * A project's manifest written from a form into `.memnox/project.toml`, for the team to commit.
 * Writing it hands nobody anything; applying the project is a separate step.
 */

const MEMORY_SCOPES: readonly string[] = Object.values(MEMORY_SCOPE);

export async function putProject(
  path: string,
  draft: unknown,
): Promise<{ root: string } | { refused: string }> {
  const root = rootOf(path);
  if (root === null)
    return { refused: `${path} is not inside a repository on this computer.` };
  const manifest = manifestFromDraft(draft);
  if (manifest === null)
    return {
      refused:
        'Send the project as a name, with its instructions, servers, skills and agents as lists of text.',
    };
  const problems = manifestProblems(manifest);
  if (problems.length > 0) return { refused: problems.join(' ') };
  await writeProjectManifest(root, manifest);
  return { root };
}

/** The project as a screen sent it, which is untrusted JSON until every field is checked. */
function manifestFromDraft(value: unknown): ProjectManifest | null {
  if (typeof value !== 'object' || value === null) return null;
  // Cast is safe: every field is checked below before it is kept.
  const raw = value as Record<string, unknown>;
  const name = raw['name'];
  if (typeof name !== 'string' || name.trim() === '') return null;
  const instructions = listOf(raw['instructions']);
  const servers = listOf(raw['servers']);
  const skills = listOf(raw['skills']);
  const agents = listOf(raw['agents']);
  if (instructions === null || servers === null || skills === null || agents === null)
    return null;
  const memory = raw['memory'] ?? MEMORY_SCOPE.PROJECT;
  if (typeof memory !== 'string' || !MEMORY_SCOPES.includes(memory)) return null;
  const policy = raw['policy'];
  if (policy !== undefined && typeof policy !== 'string') return null;
  return {
    name: name.trim(),
    instructions,
    servers,
    skills,
    agents,
    ...(policy === undefined || policy === '' ? {} : { policy }),
    // Cast is safe: checked against every scope just above.
    memory: memory as MemoryScope,
  };
}

function listOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((each) => typeof each === 'string')
    ? [...new Set(value)]
    : null;
}

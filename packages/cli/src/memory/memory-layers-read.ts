import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  CURSOR_LAYERS_FILE,
  departmentsRouted,
  DISCOVERED_AGENT_KIND,
  INSTRUCTION_FILES,
  instructionTargetFor,
  isLiveDataSkill,
  keptLines,
  MEMORY_FILES_DIR,
  MEMORY_INDEX_FILE,
  MEMORY_ROUTER_MARKERS,
  unlinkedLines,
  type Department,
  type MemoryRouterLayerView,
  type MemorySkillLayerView,
  type NativeBlockMarkers,
  type ProjectLayersView,
  type ProjectView,
} from '@memnox/core';

/**
 * Each project's memory layers read off its repository: MEMORY.md, every agent's router file, the
 * folders that keep their own instructions, and the SKILL.md files there. Reads only; the plan
 * and its writes are in memory-layers-plan, after the person confirms.
 */

/** A router file an agent reads: a block inside a file a person writes in, or a whole file of ours. */
export interface RouterTarget {
  agent: string;
  path: string;
  whole: boolean;
}

/** Folders never searched for departments, being built, fetched or another tool's own. */
const SKIPPED = new Set([
  'node_modules',
  'dist',
  'build',
  'vendor',
  'Pods',
  'target',
  'out',
]);
/** How deep departments are looked for, so a monorepo's packages are found and its sources are not walked. */
const DEPARTMENT_DEPTH = 2;
/** Where agents keep a repository's skills, one folder per skill holding a SKILL.md. */
const SKILL_FOLDERS = [
  '.claude/skills',
  '.codex/skills',
  '.agents/skills',
  '.memnox/skills',
];
const SKILL_FILE = 'SKILL.md';

export async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(
    // Not there is what most of these files are before the first plan.
    (): string | null => null,
  );
}

/** What sits between the fence, or null where the file has none of ours. */
export function blockOf(text: string, markers: NativeBlockMarkers): string | null {
  const start = text.indexOf(markers.begin);
  if (start < 0) return null;
  const stop = text.indexOf(markers.end, start);
  if (stop < 0) return null;
  return text.slice(start + markers.begin.length, stop).trim();
}

/** Every agent's router once, however many agents read the same file. */
export function routerTargets(agents: readonly string[]): RouterTarget[] {
  const targets = new Map<string, RouterTarget>();
  for (const agent of agents) {
    const target =
      agent === DISCOVERED_AGENT_KIND.CURSOR
        ? { agent, path: CURSOR_LAYERS_FILE, whole: true }
        : instructionTargetFor(agent);
    if (target !== undefined && !targets.has(target.path))
      targets.set(target.path, { agent, path: target.path, whole: target.whole });
  }
  return [...targets.values()];
}

async function foldersOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

/** Folders below the top that keep an instruction file of their own, with the one each agent reads first. */
export async function departmentsOf(
  root: string,
  prefer?: string,
): Promise<Department[]> {
  const found: Department[] = [];
  async function walk(relative: string, depth: number): Promise<void> {
    if (depth > DEPARTMENT_DEPTH) return;
    for (const name of await foldersOf(join(root, relative))) {
      const folder = relative === '' ? name : `${relative}/${name}`;
      const names = await readdir(join(root, folder)).catch((): string[] => []);
      const own = [prefer, ...INSTRUCTION_FILES].find(
        (file) => file !== undefined && names.includes(file),
      );
      if (own !== undefined) found.push({ name: folder, file: `${folder}/${own}` });
      await walk(folder, depth + 1);
    }
  }
  await walk('', 1);
  return found;
}

/** The SKILL.md files the repository keeps, and whether each says where live data is. */
export async function skillsOf(root: string): Promise<MemorySkillLayerView[]> {
  const listed = await Promise.all(
    SKILL_FOLDERS.map(async (folder) => {
      const names = await foldersOf(join(root, folder));
      return Promise.all(
        names.map(async (name) => {
          const path = `${folder}/${name}/${SKILL_FILE}`;
          const text = await readText(join(root, path));
          return text === null ? null : { name, path, liveData: isLiveDataSkill(text) };
        }),
      );
    }),
  );
  return listed.flat().filter((skill): skill is MemorySkillLayerView => skill !== null);
}

async function routerView(
  root: string,
  target: RouterTarget,
  departments: readonly Department[],
): Promise<MemoryRouterLayerView> {
  const text = (await readText(join(root, target.path))) ?? '';
  const present = text !== '';
  return {
    agent: target.agent,
    path: target.path,
    present,
    lines: present ? text.split('\n').length : 0,
    chars: text.length,
    departments: departments.map((each) => each.name),
    routed: departmentsRouted(text, departments),
  };
}

/** One project's three layers as its files stand now. */
export async function projectLayers(project: ProjectView): Promise<ProjectLayersView> {
  const root = project.path;
  const targets = routerTargets(project.agents);
  const [index, departments, skills] = await Promise.all([
    readText(join(root, MEMORY_INDEX_FILE)),
    departmentsOf(root),
    skillsOf(root),
  ]);
  const routers = await Promise.all(
    targets.map((target) => routerView(root, target, departments)),
  );
  const first =
    targets[0] === undefined ? null : await readText(join(root, targets[0].path));
  const block = first === null ? null : blockOf(first, MEMORY_ROUTER_MARKERS);
  return {
    name: project.name,
    path: root,
    agents: [...project.agents],
    index: {
      path: MEMORY_INDEX_FILE,
      present: index !== null,
      lines: index === null ? 0 : index.split('\n').length,
      unlinked: index === null ? 0 : unlinkedLines(index),
    },
    routers,
    skills,
    keep: block === null ? [] : keptLines(block),
  };
}

/** Memory files a person already keeps beside the index, each with its title and first line. */
export async function memoryFilesOf(
  root: string,
): Promise<{ title: string; file: string; summary: string }[]> {
  const names = await readdir(join(root, MEMORY_FILES_DIR)).catch((): string[] => []);
  const read = await Promise.all(
    names
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map(async (name) => {
        const text = (await readText(join(root, MEMORY_FILES_DIR, name))) ?? '';
        const lines = text.split('\n').map((line) => line.trim());
        const heading = lines.find((line) => line.startsWith('# '));
        const summary = lines.find(
          (line) => line !== '' && !line.startsWith('#') && !line.startsWith('<!--'),
        );
        return {
          title: heading === undefined ? basename(name, '.md') : heading.slice(2),
          file: `${MEMORY_FILES_DIR}/${name}`,
          summary: summary ?? '',
        };
      }),
  );
  return read;
}

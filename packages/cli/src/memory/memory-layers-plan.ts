import { join } from 'node:path';

import {
  indexLines,
  layersPlanDigest,
  markdownMarked,
  MEMORY_FILES_DIR,
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MARKERS,
  MEMORY_LAYER,
  MEMORY_ROUTER_MARKERS,
  MEMORY_SCOPE,
  MEMORY_STATUS,
  memoryFileText,
  memorySlug,
  NATIVE_PLACED,
  placeNativeBlock,
  placeNativeFile,
  routerLines,
  TOOL_CLASS,
  type IndexedMemory,
  type MemoryLayerFilePlan,
  type MemoryLayersApplied,
  type MemoryLayersPlan,
  type ProjectView,
  type SqliteMemoryStore,
} from '@memnox/core';
import {
  blockOf,
  departmentsOf,
  memoryFilesOf,
  readText,
  routerTargets,
  skillsOf,
  type RouterTarget,
} from './memory-layers-read';
import { CONFIG_RULE, recordConfigChanges } from '../keeper/config-events';

/**
 * The proposed map of a project's memory, built by rule from what it already holds: the index with
 * one line per memory linked to its own file, and each agent's router with one line per department.
 * The plan writes nothing; apply writes it only when its digest is the one the person confirmed.
 */

export interface LayersAsk {
  project: ProjectView;
  /** One agent's router; absent is every agent of the project. */
  agent?: string;
  keep: readonly string[];
}

const OPERATION = 'project.memory-layers.written';

function linesOf(text: string | null): string[] {
  return text === null || text.trim() === '' ? [] : text.trim().split('\n');
}

function filePlan(
  at: Omit<MemoryLayerFilePlan, 'changed' | 'before' | 'after'>,
  before: string[],
  after: string[],
): MemoryLayerFilePlan {
  return { ...at, before, after, changed: before.join('\n') !== after.join('\n') };
}

/** Each verified memory of the project as a file of its own, and the line the index gives it. */
function itemMemories(
  store: SqliteMemoryStore,
  project: ProjectView,
): { memory: IndexedMemory; text: string }[] {
  const items = store
    .items({ statuses: [MEMORY_STATUS.VERIFIED], scope: MEMORY_SCOPE.PROJECT })
    .filter((item) => item.project === project.path || item.project === project.id);
  const taken = new Set<string>();
  return items.map((item) => {
    let slug = memorySlug(item.subject, item.id);
    if (taken.has(slug)) slug = `${slug}-${memorySlug('', item.id)}`;
    taken.add(slug);
    const file = `${MEMORY_FILES_DIR}/${slug}.md`;
    return {
      memory: { title: item.subject, file, summary: item.statement },
      text: memoryFileText({ title: item.subject, statement: item.statement }),
    };
  });
}

async function memoryPlans(
  root: string,
  store: SqliteMemoryStore,
  project: ProjectView,
): Promise<{ files: MemoryLayerFilePlan[]; index: IndexedMemory[] }> {
  const own = itemMemories(store, project);
  const ours = new Set(own.map((each) => each.memory.file));
  const theirs = (await memoryFilesOf(root)).filter((each) => !ours.has(each.file));
  const files = await Promise.all(
    own.map(async (each) =>
      filePlan(
        { path: each.memory.file, layer: MEMORY_LAYER.MEMORY, whole: true },
        linesOf(await readText(join(root, each.memory.file))),
        linesOf(each.text),
      ),
    ),
  );
  return { files, index: [...own.map((each) => each.memory), ...theirs] };
}

function cursorRouterText(body: string): string {
  return markdownMarked(
    `---\ndescription: The project's memory router\nalwaysApply: true\n---\n\n${body}`,
  );
}

async function routerPlan(
  root: string,
  target: RouterTarget,
  body: string[],
): Promise<MemoryLayerFilePlan> {
  const text = await readText(join(root, target.path));
  const before = target.whole
    ? linesOf(text)
    : linesOf(text === null ? null : blockOf(text, MEMORY_ROUTER_MARKERS));
  const after = target.whole ? linesOf(cursorRouterText(body.join('\n'))) : body;
  const at = {
    path: target.path,
    layer: MEMORY_LAYER.ROUTER,
    agent: target.agent,
    whole: target.whole,
  };
  return filePlan(at, before, after);
}

/** The preview: every file the map would write, what it holds now and what it would hold. */
export async function planLayers(
  store: SqliteMemoryStore,
  ask: LayersAsk,
): Promise<MemoryLayersPlan> {
  const root = ask.project.path;
  const agents = ask.agent === undefined ? ask.project.agents : [ask.agent];
  const memories = await memoryPlans(root, store, ask.project);
  const indexText = await readText(join(root, MEMORY_INDEX_FILE));
  const index = filePlan(
    { path: MEMORY_INDEX_FILE, layer: MEMORY_LAYER.INDEX, whole: false },
    linesOf(indexText === null ? null : blockOf(indexText, MEMORY_INDEX_MARKERS)),
    indexLines(memories.index),
  );
  const [departments, skills] = await Promise.all([departmentsOf(root), skillsOf(root)]);
  const body = routerLines({
    departments,
    skills: skills.filter((skill) => skill.liveData),
    keep: ask.keep,
  });
  const routers = await Promise.all(
    routerTargets(agents).map((target) => routerPlan(root, target, body)),
  );
  const files = [index, ...memories.files, ...routers];
  return { project: root, digest: layersPlanDigest(files), files };
}

async function place(root: string, file: MemoryLayerFilePlan): Promise<boolean> {
  const path = join(root, file.path);
  const body = file.after.join('\n');
  if (file.whole)
    return (
      (await placeNativeFile({ path, content: `${body}\n` })) === NATIVE_PLACED.WRITTEN
    );
  const markers =
    file.layer === MEMORY_LAYER.INDEX ? MEMORY_INDEX_MARKERS : MEMORY_ROUTER_MARKERS;
  return (await placeNativeBlock(path, body, markers)) === NATIVE_PLACED.WRITTEN;
}

/** The confirmed plan written, refused when any file changed since the person saw it. */
export async function applyLayers(
  home: string,
  store: SqliteMemoryStore,
  { ask, digest, now }: { ask: LayersAsk; digest: string; now: Date },
): Promise<{ refused: string } | { applied: MemoryLayersApplied }> {
  const plan = await planLayers(store, ask);
  if (plan.digest !== digest)
    return {
      refused: 'These files changed since the plan was shown, so preview it again.',
    };
  const applied: MemoryLayersApplied = { written: [], unchanged: [] };
  for (const file of plan.files) {
    const wrote = file.changed && (await place(plan.project, file));
    (wrote ? applied.written : applied.unchanged).push(file.path);
  }
  const records = applied.written.map((path) => ({
    operation: OPERATION,
    file: join(plan.project, path),
    summary: `the memory layers written into ${path}`,
    class: TOOL_CLASS.WRITE,
    rule: CONFIG_RULE.PROJECTS,
  }));
  await recordConfigChanges(home, records, now);
  return { applied };
}

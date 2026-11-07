import {
  MEMORY_LAYERS_METHOD,
  sessionCostOf,
  type DaemonRequest,
  type DaemonResponse,
  type MemoryLayersView,
  type ProjectView,
  type SqliteMemoryStore,
} from '@memnox/core';
import { projectLayers } from '../memory/memory-layers-read';
import { applyLayers, planLayers, type LayersAsk } from '../memory/memory-layers-plan';
import { readMemoryValue } from '../memory/search-times';
import { readProjectsView } from '../projects/projects-view';
import { recentTranscriptUsage } from './transcript-usage';

/**
 * The memory layers methods: a read of each project's layers, a plan that previews the map, an
 * apply that writes only the plan the person confirmed, and the cold cache count over recent chats.
 */

const LAYERS_METHODS: readonly string[] = Object.values(MEMORY_LAYERS_METHOD);
/** Lines a keep on compact list holds at most, each one line. */
const MOST_KEPT_LINES = 40;
const MOST_KEPT_CHARS = 300;

type Answered = Omit<DaemonResponse, 'id'>;

export function isMemoryLayersMethod(method: string): boolean {
  return LAYERS_METHODS.includes(method);
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

async function layersView(
  home: string,
  now: Date,
  only?: string,
): Promise<MemoryLayersView> {
  const { projects } = await readProjectsView(home, now);
  const shown = projects.filter((project) => only === undefined || project.path === only);
  const [views, value] = await Promise.all([
    Promise.all(shown.map((project) => projectLayers(project))),
    readMemoryValue(home),
  ]);
  return { projects: views, value };
}

/** The keep list as one plain line each, or null where it is not a list of words. */
function keepOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MOST_KEPT_LINES) return null;
  const lines = value.flatMap((each) =>
    typeof each === 'string'
      ? [each.replace(/\s+/g, ' ').trim().slice(0, MOST_KEPT_CHARS)]
      : [],
  );
  return lines.length === value.length ? lines.filter((line) => line !== '') : null;
}

async function askOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<{ refused: string } | LayersAsk> {
  const keep = keepOf(request.memoryKeep);
  if (keep === null) return { refused: 'Send what to keep as a list of lines.' };
  const path = request.memoryLayersProject;
  if (typeof path !== 'string' || path === '') return { refused: 'Name the project.' };
  const { projects } = await readProjectsView(home, now);
  const project: ProjectView | undefined = projects.find((each) => each.path === path);
  if (project === undefined)
    return { refused: `${path} is not a project on this machine.` };
  const agent = request.memoryLayersAgent;
  if (agent !== undefined && !project.agents.includes(agent))
    return { refused: `${agent} does not work in ${project.name}.` };
  return { project, keep, ...(agent === undefined ? {} : { agent }) };
}

export async function memoryLayersAnswer(
  home: string,
  store: SqliteMemoryStore,
  { request, now }: { request: DaemonRequest; now: Date },
): Promise<Answered> {
  switch (request.method) {
    case MEMORY_LAYERS_METHOD.MEMORY_LAYERS:
      return {
        ok: true,
        memoryLayers: await layersView(home, now, request.memoryLayersProject),
      };
    case MEMORY_LAYERS_METHOD.SESSION_COST:
      return {
        ok: true,
        sessionCost: sessionCostOf((await recentTranscriptUsage(home, now)).turns),
      };
    default:
      return changeAnswer(home, store, { request, now });
  }
}

async function changeAnswer(
  home: string,
  store: SqliteMemoryStore,
  { request, now }: { request: DaemonRequest; now: Date },
): Promise<Answered> {
  const ask = await askOf(home, request, now);
  if ('refused' in ask) return refused(ask.refused);
  if (request.method === MEMORY_LAYERS_METHOD.MEMORY_LAYERS_PLAN)
    return { ok: true, memoryLayersPlan: await planLayers(store, ask) };
  const digest = request.memoryLayersDigest;
  if (typeof digest !== 'string' || digest === '')
    return refused('Send the digest of the plan that was confirmed.');
  const done = await applyLayers(home, store, { ask, digest, now });
  if ('refused' in done) return refused(done.refused);
  return {
    ok: true,
    memoryLayersApplied: done.applied,
    memoryLayers: await layersView(home, now, ask.project.path),
  };
}

import { PROJECTS_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import {
  applyProject,
  openProject,
  type ProjectChanged,
} from '../projects/project-changes';
import { putProject } from '../projects/project-put';
import { readProjectsView } from '../projects/projects-view';

/**
 * The projects methods. A project's instructions go to its agents at once; its servers, skills and
 * rule file reach further, so they are proposed and hold once the person signs them.
 */

const PROJECTS_METHODS: readonly string[] = Object.values(PROJECTS_METHOD);

export function isProjectsMethod(method: string): boolean {
  return PROJECTS_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every answer carries the projects as they now stand, so a screen redraws from one answer. */
export async function projectsAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return { id: request.id, ...answered, projects: await readProjectsView(home, now) };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  switch (request.method) {
    case PROJECTS_METHOD.PROJECT_OPEN:
      if (request.projectPath === undefined) return refused('Name the folder to open.');
      return changedAnswer(await openProject(home, request.projectPath, now));
    case PROJECTS_METHOD.PROJECT_PUT: {
      if (request.projectPath === undefined) return refused('Name the repository.');
      const put = await putProject(request.projectPath, request.projectDraft);
      return 'refused' in put ? refused(put.refused) : { ok: true };
    }
    case PROJECTS_METHOD.PROJECT_APPLY:
      if (request.projectId === undefined) return refused('Name the project.');
      return changedAnswer(await applyProject(home, request.projectId, now));
    default:
      return { ok: true };
  }
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

function changedAnswer(changed: ProjectChanged): Answered {
  if ('refused' in changed) return refused(changed.refused);
  return {
    ok: true,
    projectApplied: changed.applied,
    ...(changed.proposed === undefined ? {} : { proposed: changed.proposed }),
  };
}

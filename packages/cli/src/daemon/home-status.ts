import type { DaemonRequest, DaemonResponse } from '@memnox/core';
import { readStatus } from '../commands/status.command';
import { activityAnswer, isActivityMethod } from './activity-answer';
import { agentsAnswer, isAgentsMethod } from './agents-answer';
import { homeAnswer, isHomeMethod } from './home-answer';
import { isMcpHubMethod, mcpHubAnswer } from './mcp-hub-answer';
import { isPolicyMethod, policiesAnswer } from './policies-answer';
import { isSkillsMethod, skillsHubAnswer } from './skills-hub-answer';
import { isProjectsMethod, projectsAnswer } from './projects-answer';
import { backupAnswer, isBackupMethod } from './backup-answer';
import { isMemoryMethod, memoryAnswer } from './memory-answer';
import { isLanMethod, lanAnswer } from './lan-answer';
import { isProfilesMethod, profilesAnswer } from './profiles-answer';
import { communityIndexAnswer, isIndexMethod } from './community-index-answer';
import {
  changesSyncedItems,
  isPersonalSyncMethod,
  noteLocalChange,
  personalSyncAnswer,
  syncDepsFor,
} from './personal-sync-answer';
import type { SessionViews } from './session-view';

/**
 * The daemon's door to the home, the MCP Hub and the studio screens, wired to the status screen here so the home reader
 * never imports a command and the status command can read the home without a loop between the two.
 */

/** The home and the hub, the two screens a window opens on before any session is chosen. */
export function isScreenMethod(method: string): boolean {
  return (
    isHomeMethod(method) ||
    isMcpHubMethod(method) ||
    isSkillsMethod(method) ||
    isProjectsMethod(method) ||
    isBackupMethod(method) ||
    isMemoryMethod(method) ||
    isLanMethod(method) ||
    isPersonalSyncMethod(method) ||
    isProfilesMethod(method) ||
    isIndexMethod(method) ||
    isStudioMethod(method)
  );
}

/** The Policy Studio, the activity screen and the agent manager. */
function isStudioMethod(method: string): boolean {
  return isPolicyMethod(method) || isActivityMethod(method) || isAgentsMethod(method);
}

/** `remote` is a paired phone, which may read the hub and propose but never hand over a secret. */
export async function answerHome(
  home: string,
  request: DaemonRequest,
  views: SessionViews,
  remote = false,
): Promise<DaemonResponse> {
  const answered = await answerScreen(home, request, views, remote);
  // What this machine carries changed, so the person's other machines hear of it on its next sync.
  if (answered.ok && changesSyncedItems(request.method)) noteLocalChange(home);
  return answered;
}

function answerScreen(
  home: string,
  request: DaemonRequest,
  views: SessionViews,
  remote: boolean,
): Promise<DaemonResponse> {
  if (isMcpHubMethod(request.method))
    return mcpHubAnswer(home, request, { now: new Date(), remote });
  if (isSkillsMethod(request.method)) return skillsHubAnswer(home, request, new Date());
  if (isProjectsMethod(request.method)) return projectsAnswer(home, request, new Date());
  if (isBackupMethod(request.method)) return backupAnswer(home, request, new Date());
  if (isMemoryMethod(request.method))
    return memoryAnswer(home, request, { now: new Date() });
  if (isLanMethod(request.method)) return lanAnswer(home, request, new Date());
  if (isPersonalSyncMethod(request.method))
    return personalSyncAnswer(request, syncDepsFor(home));
  if (isProfilesMethod(request.method)) return profilesAnswer(home, request, new Date());
  if (isIndexMethod(request.method))
    return communityIndexAnswer(home, request, { now: new Date(), remote });
  if (isStudioMethod(request.method)) return studioAnswer(home, request, views);
  return homeAnswer(home, request, {
    views,
    now: new Date(),
    status: (where) => readStatus(where, where),
  });
}

function studioAnswer(
  home: string,
  request: DaemonRequest,
  views: SessionViews,
): Promise<DaemonResponse> {
  const now = new Date();
  if (isPolicyMethod(request.method))
    return policiesAnswer(home, request, { now, env: process.env });
  if (isActivityMethod(request.method)) return activityAnswer(home, request, now);
  return agentsAnswer(home, request, {
    now,
    cards: () => views.list(),
    sessionDeps: () => views.deps(),
  });
}

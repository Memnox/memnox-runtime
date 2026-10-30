import { PROFILES_METHOD, type DaemonRequest, type DaemonResponse } from '@memnox/core';
import { applyProfile, readProfileViews } from '../profiles/profile-apply';
import { profileFrom, removeProfile, writeProfile } from '../profiles/profile-store';

/**
 * The profile methods. Keeping, replacing or forgetting a profile grants nothing, so each is done
 * at once; applying one raises the signed proposal each of its servers, skills and rules raises.
 */

const PROFILES_METHODS: readonly string[] = Object.values(PROFILES_METHOD);

export function isProfilesMethod(method: string): boolean {
  return PROFILES_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

/** Every answer carries the profiles as they now stand, so a screen redraws from one answer. */
export async function profilesAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<DaemonResponse> {
  const answered = await answerOf(home, request, now).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return { id: request.id, ...answered, profiles: await readProfileViews(home) };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  switch (request.method) {
    case PROFILES_METHOD.PROFILE_PUT: {
      const read = profileFrom(request.profileDraft, now.toISOString());
      if ('problems' in read) return refused(read.problems.join(' '));
      await writeProfile(home, read.profile);
      return { ok: true };
    }
    case PROFILES_METHOD.PROFILE_REMOVE:
      if (request.profileName === undefined) return refused('Name the profile.');
      return (await removeProfile(home, request.profileName))
        ? { ok: true }
        : refused(`No profile is called ${request.profileName}.`);
    case PROFILES_METHOD.PROFILE_APPLY:
      return apply(home, request, now);
    default:
      return { ok: true };
  }
}

async function apply(home: string, request: DaemonRequest, now: Date): Promise<Answered> {
  const { profileName, profileAgent, profileProject } = request;
  if (profileName === undefined || profileAgent === undefined)
    return refused('Name the profile and the agent to apply it to.');
  const applied = await applyProfile(
    home,
    {
      profile: profileName,
      agent: profileAgent,
      ...(profileProject === undefined ? {} : { project: profileProject }),
    },
    now,
  );
  if ('refused' in applied) return refused(applied.refused);
  return { ok: true, profileApplied: applied };
}

function refused(reason: string): Answered {
  return { ok: false, error: reason, reason };
}

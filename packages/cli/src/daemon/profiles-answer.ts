import {
  draftFromTemplate,
  PROFILE_TEMPLATES,
  PROFILES_METHOD,
  templateNamed,
  type DaemonRequest,
  type DaemonResponse,
  type SessionCard,
} from '@memnox/core';
import { applyProfile } from '../profiles/profile-apply';
import {
  bindAgentProfile,
  unbindAgentProfile,
  unbindEveryAgentOf,
} from '../profiles/profile-bind';
import {
  readProfilesWithConnections,
  type ConnectionDeps,
} from '../profiles/profile-connections';
import {
  profileFrom,
  profileNamed,
  removeProfile,
  writeProfile,
} from '../profiles/profile-store';
import { responsiblePersonHere } from '../profiles/responsible-person';

/**
 * The profile methods. Keeping, replacing or forgetting a profile grants nothing, so each is done
 * at once; applying one raises the signed proposal each of its servers, skills and rules raises.
 */

const PROFILES_METHODS: readonly string[] = Object.values(PROFILES_METHOD);

export function isProfilesMethod(method: string): boolean {
  return PROFILES_METHODS.includes(method);
}

type Answered = Omit<DaemonResponse, 'id'>;

/** What the daemon hands a profile answer beyond the clock; a test leaves both out. */
interface ProfilesSeams {
  cards?: () => Promise<SessionCard[]>;
  /** A paired phone asked, rather than this computer. */
  remote?: boolean;
}

interface Answering extends ConnectionDeps {
  remote: boolean;
}

/** Every answer carries the profiles as they now stand, so a screen redraws from one answer. */
export async function profilesAnswer(
  home: string,
  request: DaemonRequest,
  now: Date,
  seams: ProfilesSeams = {},
): Promise<DaemonResponse> {
  const deps: Answering = {
    now,
    cards: seams.cards ?? (async (): Promise<SessionCard[]> => []),
    remote: seams.remote === true,
  };
  const answered = await answerOf(home, request, deps).catch((err: unknown): Answered =>
    refused(err instanceof Error ? err.message : String(err)),
  );
  if (!answered.ok) return { id: request.id, ...answered };
  return {
    id: request.id,
    ...answered,
    profiles: await readProfilesWithConnections(home, deps),
  };
}

async function answerOf(
  home: string,
  request: DaemonRequest,
  deps: Answering,
): Promise<Answered> {
  const now = deps.now;
  switch (request.method) {
    case PROFILES_METHOD.PROFILE_PUT:
      return put(home, request, now);
    case PROFILES_METHOD.PROFILE_REMOVE:
      return remove(home, request.profileName);
    case PROFILES_METHOD.PROFILE_APPLY:
      return apply(home, request, now);
    case PROFILES_METHOD.PROFILE_BIND:
      return outcomeOf(
        await bindAgentProfile(
          home,
          { profile: request.profileName, agent: request.agentId, remote: deps.remote },
          deps,
        ),
      );
    case PROFILES_METHOD.PROFILE_UNBIND:
      return outcomeOf(await unbindAgentProfile(home, request.agentId, deps));
    case PROFILES_METHOD.TEMPLATES:
      return { ok: true, templates: [...PROFILE_TEMPLATES] };
    case PROFILES_METHOD.PROFILE_FROM_TEMPLATE:
      return fromTemplate(home, request, now);
    default:
      return { ok: true };
  }
}

/** A copy of the job, never the template itself, so editing the profile leaves the catalog alone. */
async function fromTemplate(
  home: string,
  request: DaemonRequest,
  now: Date,
): Promise<Answered> {
  const template =
    request.templateId === undefined ? undefined : templateNamed(request.templateId);
  if (template === undefined) return refused('Name a template from the catalog.');
  const draft = draftFromTemplate(template, {
    ...(request.profileName === undefined ? {} : { name: request.profileName }),
    ...(request.templateSkills === undefined ? {} : { skills: request.templateSkills }),
  });
  if ((await profileNamed(home, draft.name)) !== undefined)
    return refused(`A profile is already called ${draft.name}. Name the copy.`);
  return put(home, { ...request, profileDraft: draft }, now);
}

async function put(home: string, request: DaemonRequest, now: Date): Promise<Answered> {
  const read = profileFrom(request.profileDraft, now.toISOString());
  if ('problems' in read) return refused(read.problems.join(' '));
  await writeProfile(home, {
    ...read.profile,
    responsiblePerson:
      read.profile.responsiblePerson ?? (await responsiblePersonHere(home)),
  });
  return { ok: true };
}

/** Forgetting a profile puts every agent bound to it back on its own default. */
async function remove(home: string, named: string | undefined): Promise<Answered> {
  if (named === undefined) return refused('Name the profile.');
  const profile = await profileNamed(home, named);
  if (profile === undefined || !(await removeProfile(home, named)))
    return refused(`No profile is called ${named}.`);
  await unbindEveryAgentOf(home, profile.id);
  return { ok: true };
}

function outcomeOf(outcome: { refused: string } | object): Answered {
  return 'refused' in outcome && typeof outcome.refused === 'string'
    ? refused(outcome.refused)
    : { ok: true };
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

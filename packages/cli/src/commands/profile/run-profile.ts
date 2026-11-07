/** `memnox profile` subcommands: each sends the daemon's own profile method and draws its answer. */
import {
  DAEMON_METHOD,
  type DaemonRequest,
  type DaemonResponse,
  type ProfileView,
} from '@memnox/core';
import type { CliContext } from '../../cli-context';
import { profilesAnswer } from '../../daemon/profiles-answer';

export interface ProfileDeps {
  context: CliContext;
  home: () => string;
  now?: () => Date;
}

export interface NewProfileOptions {
  purpose?: string;
  role?: string;
  responsible?: string;
  instructions?: string;
}

/** The same answer a screen gets, so the terminal and the desktop never disagree on a profile. */
function ask(
  deps: ProfileDeps,
  request: Partial<DaemonRequest>,
): Promise<DaemonResponse> {
  return profilesAnswer(
    deps.home(),
    // Cast is safe: the method is set here and every other field is optional.
    { id: 1, method: DAEMON_METHOD.PROFILES, ...request } as DaemonRequest,
    (deps.now ?? ((): Date => new Date()))(),
  );
}

/** Says a refusal and stops, so every runner draws the happy path only. */
function failed(deps: ProfileDeps, answer: DaemonResponse): boolean {
  if (answer.ok) return false;
  deps.context.flow.fail(answer.error ?? 'Memnox could not do that.');
  process.exitCode = 1;
  return true;
}

export async function runNewProfile(
  deps: ProfileDeps,
  name: string,
  options: NewProfileOptions,
): Promise<void> {
  deps.context.flow.open('memnox profile new');
  const answer = await ask(deps, {
    method: DAEMON_METHOD.PROFILE_PUT,
    profileDraft: {
      name,
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
      ...(options.role === undefined ? {} : { role: options.role }),
      ...(options.responsible === undefined
        ? {}
        : { responsiblePerson: options.responsible }),
      ...(options.instructions === undefined
        ? {}
        : { instructions: options.instructions }),
    },
  });
  if (failed(deps, answer)) return;
  const made = (answer.profiles ?? []).find((each) => each.name === name.trim());
  if (made !== undefined) renderProfile(deps, made);
  deps.context.flow.hint(`memnox profile bind ${made?.id ?? name} <agent>`);
}

export async function runShowProfile(
  deps: ProfileDeps,
  named: string | undefined,
): Promise<void> {
  const { flow } = deps.context;
  flow.open('memnox profile show');
  const answer = await ask(deps, { method: DAEMON_METHOD.PROFILES });
  if (failed(deps, answer)) return;
  const profiles = answer.profiles ?? [];
  const wanted = named === undefined ? undefined : named.trim().toLowerCase();
  const shown =
    wanted === undefined
      ? profiles
      : profiles.filter(
          (each) => each.id === wanted || each.name.toLowerCase() === wanted,
        );
  if (shown.length === 0) {
    flow.close(
      named === undefined ? 'No profile here yet.' : `No profile is called ${named}.`,
    );
    return;
  }
  for (const profile of shown) renderProfile(deps, profile);
  flow.close(`${shown.length} profile${shown.length === 1 ? '' : 's'}.`);
}

export async function runBindProfile(
  deps: ProfileDeps,
  profile: string,
  agent: string,
): Promise<void> {
  deps.context.flow.open('memnox profile bind');
  const answer = await ask(deps, {
    method: DAEMON_METHOD.PROFILE_BIND,
    profileName: profile,
    agentId: agent,
  });
  if (failed(deps, answer)) return;
  deps.context.flow.close(
    `${agent} now works as ${profile}. Its record and its rules keep the same agent id.`,
  );
}

export async function runUnbindProfile(deps: ProfileDeps, agent: string): Promise<void> {
  deps.context.flow.open('memnox profile unbind');
  const answer = await ask(deps, {
    method: DAEMON_METHOD.PROFILE_UNBIND,
    agentId: agent,
  });
  if (failed(deps, answer)) return;
  deps.context.flow.close(`${agent} works under its default profile again.`);
}

function renderProfile(deps: ProfileDeps, profile: ProfileView): void {
  const connected = profile.connections
    .map((each) => `${each.agentKind ?? each.id} (${each.mediation}, ${each.status})`)
    .join(', ');
  deps.context.flow.rows(
    profile.isDefault === true ? `${profile.name}, default` : profile.name,
    [
      { label: 'id', value: profile.id },
      profile.purpose === undefined
        ? undefined
        : { label: 'purpose', value: profile.purpose },
      profile.role === undefined ? undefined : { label: 'role', value: profile.role },
      profile.responsiblePerson === undefined
        ? undefined
        : { label: 'responsible', value: profile.responsiblePerson },
      {
        label: 'connected through',
        value: connected === '' ? 'No agent connected' : connected,
      },
    ],
  );
}

export interface FromTemplateOptions {
  name?: string;
  /** Comma separated suggested skills to take; none are taken unless named. */
  skills?: string;
}

export async function runTemplates(deps: ProfileDeps): Promise<void> {
  const { flow } = deps.context;
  flow.open('memnox profile templates');
  const answer = await ask(deps, { method: DAEMON_METHOD.TEMPLATES });
  if (failed(deps, answer)) return;
  flow.list(
    'No agent behind any of these yet',
    (answer.templates ?? []).map((each) => ({
      text: `${each.id}: ${each.purpose}`,
      detail: [
        `suggested rules, off until you write them: ${each.suggestedRules.join(' ')}`,
      ],
    })),
  );
  flow.close(
    'memnox profile from-template <template> copies one into a profile of yours.',
  );
}

export async function runFromTemplate(
  deps: ProfileDeps,
  template: string,
  options: FromTemplateOptions,
): Promise<void> {
  deps.context.flow.open('memnox profile from-template');
  const skills = (options.skills ?? '')
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');
  const answer = await ask(deps, {
    method: DAEMON_METHOD.PROFILE_FROM_TEMPLATE,
    templateId: template,
    ...(options.name === undefined ? {} : { profileName: options.name }),
    templateSkills: skills,
  });
  if (failed(deps, answer)) return;
  const made = (answer.profiles ?? []).find(
    (each) =>
      each.templateOf !== undefined &&
      (options.name === undefined || each.name === options.name.trim()),
  );
  if (made !== undefined) renderProfile(deps, made);
  deps.context.flow.close(
    'Copied. No agent is connected and no rule applies until you bind it and write them.',
  );
}

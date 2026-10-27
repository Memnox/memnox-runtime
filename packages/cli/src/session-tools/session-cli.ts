/**
 * `memnox-session`: the stdio MCP server each agent's config launches, so a person can ask
 * Memnox from inside the conversation. `--agent` names whose sessions it reads.
 */
import { closeSync, openSync } from 'node:fs';
import { homedir, hostname } from 'node:os';

import {
  AGENT_FLAG,
  DAEMON_METHOD,
  Milestones,
  NodeGit,
  NodeWorktree,
  type Milestone,
  type PersonStanding,
} from '@memnox/core';

import { readStatus } from '../commands/status.command';
import { fetchBrief, refreshMemory } from '../sync/memory';
import {
  readSource,
  personElsewhere,
  readPeople,
  readSources,
  readWorkspaceName,
} from '../sync/workspace-reads';
import { socketDial } from '../remote/daemon-dial';
import {
  connectionsOf,
  findPersonalTools,
  personalAccounts,
  runPersonalTool,
  signInLink,
  signInPersonal,
  signOutOf,
  readWorkspaceGithub,
  workspaceRepositories,
} from '../sync/personal-work';
import { findEveryTool, runLocal } from '../local-tools/local-tools';
import { isLocalSlug } from '../local-tools/local-run';
import type { SessionToolDeps } from './read-tools';
import type { RewindSeams } from './rewind-tool';
import { awaitSessionStart } from './await-start';
import { awaitDelivery } from './instruct-tools';
import { OPERATOR_CATALOGUE } from './operator-tools';
import { serveSession } from './session-server';

/** Whose sessions to read when the launch line names nobody. */
const UNNAMED_AGENT = 'unknown-agent';

/** Set by CI systems and headless agent runs, where nobody sees a prompt. */
const UNATTENDED_MARKERS: readonly string[] = [
  'CI',
  'GITHUB_ACTIONS',
  'BUILDKITE',
  'GITLAB_CI',
  'JENKINS_URL',
];

const CONTROLLING_TERMINAL = '/dev/tty';

export function agentFrom(argv: readonly string[]): string {
  const at = argv.indexOf(AGENT_FLAG);
  const named = at === -1 ? undefined : argv[at + 1];
  return named === undefined || named === '' ? UNNAMED_AGENT : named;
}

export function isUnattended(env: NodeJS.ProcessEnv): boolean {
  return UNATTENDED_MARKERS.some(
    (name) => (env[name] ?? '') !== '' && env[name] !== 'false',
  );
}

/** Whether this process shares a terminal with a person, as an agent run from a shell does. */
function hasTerminal(): boolean {
  try {
    closeSync(openSync(CONTROLLING_TERMINAL, 'r'));
    return true;
  } catch {
    // No controlling terminal: a GUI host or a detached run, which is an answer rather than a fault.
    return false;
  }
}

function milestonesIn(place: string): Milestones {
  return new Milestones(new NodeGit(place), new NodeWorktree(place));
}

async function milestonesAt(place: string): Promise<Milestone[]> {
  try {
    return await milestonesIn(place).list();
  } catch {
    // Not a repository: it simply kept no milestones.
    return [];
  }
}

function depsFor(argv: readonly string[], env: NodeJS.ProcessEnv): SessionToolDeps {
  return {
    home: homedir(),
    cwd: process.cwd(),
    agent: agentFrom(argv),
    env,
    now: () => new Date(),
    readStatus,
    milestonesAt,
    brief: (resources, repository) => fetchBrief(homedir(), resources, repository),
    refreshMemory: () => refreshMemory(homedir()),
    sources: (query) => readSources(homedir(), query),
    people: (name) => readPeople(homedir(), name),
    personElsewhere: () => personElsewhere(homedir()),
    source: (link) => readSource(homedir(), link),
    workspaceName: () => readWorkspaceName(homedir()),
    personalWork: {
      find: (what, toolkit) =>
        findEveryTool(homedir(), what, toolkit, (words, named) =>
          findPersonalTools(homedir(), words, named),
        ),
      // A read on this Mac itself runs here; nothing local that changes anything runs without Touch ID.
      run: (tool, argumentsText) =>
        isLocalSlug(tool)
          ? runLocal(homedir(), tool, argumentsText, false)
          : runPersonalTool(homedir(), tool, argumentsText),
      signIn: (toolkit) => signInPersonal(homedir(), toolkit),
      link: (toolkit) => signInLink(homedir(), toolkit),
      accounts: () => personalAccounts(homedir()),
      repositories: (all) => workspaceRepositories(homedir(), all),
      github: (read) => readWorkspaceGithub(homedir(), read),
      signOut: (toolkit) => signOutOf(homedir(), toolkit),
      connections: () => connectionsOf(homedir()),
    },
    memnoxSignIn: () => askPersonSignIn(homedir()),
    delivered: (requestId, waitMs) => awaitDelivery(homedir(), requestId, waitMs),
    startSeen: (repository, since) => awaitSessionStart(homedir(), repository, since),
  };
}

/** The daemon's own person sign in, the one the Mac's Account row starts, so one approval also connects this Mac. */
async function askPersonSignIn(home: string): Promise<PersonStanding | null> {
  const answer = await socketDial(home).ask({
    id: Date.now(),
    method: DAEMON_METHOD.PERSON_SIGN_IN,
    name: hostname().replace(/\.local$/, ''),
  });
  return answer?.ok === true ? (answer.person ?? null) : null;
}

function seamsFor(env: NodeJS.ProcessEnv): Omit<RewindSeams, 'confirm'> {
  return {
    build: milestonesIn,
    unattended: () => isUnattended(env),
    terminal: hasTerminal,
  };
}

/** Serves on this process's stdio until the host closes it. */
export function runSessionServer(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return serveSession({
    input: process.stdin,
    output: process.stdout,
    deps: depsFor(argv, env),
    seams: seamsFor(env),
  });
}

/**
 * `memnox-operator`: the same wire with the voice's tools, launched by the person's own
 * agent CLI as the only tools it has, and never registered into a working agent's session.
 */
export function runOperatorServer(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return serveSession({
    input: process.stdin,
    output: process.stdout,
    deps: depsFor(argv, env),
    seams: seamsFor(env),
    catalogue: OPERATOR_CATALOGUE,
  });
}

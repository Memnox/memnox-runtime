import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  agentShown,
  discover,
  interceptorDirFor,
  MEMNOX_HOME,
  NodeMachineReader,
  NodeSnapshotStore,
  type EnvironmentSnapshot,
} from '@memnox/core';
import { readNames } from '../agents/names';
import { folderUses, spokenName } from './folders';
import { readHeardWords } from './heard-words';

/**
 * The names this machine actually uses: its agents, the CLIs Memnox watches, its MCP servers
 * and the folders its sessions work in. The recognizer is hinted with them and the brain is
 * told them, so "clothes code on right away" is understood as Claude Code on Railway.
 */

/** How a CLI is said out loud, where that is not simply its name. */
const SPOKEN_CLI: Readonly<Record<string, string>> = {
  gh: 'GitHub CLI',
  kubectl: 'kubectl',
  psql: 'Postgres',
  mongosh: 'MongoDB',
  railway: 'Railway',
  vercel: 'Vercel',
  docker: 'Docker',
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  pip3: 'pip',
  git: 'git',
};

/** The folders taught to the recognizer, enough for where somebody works without crowding the agents' names. */
const MOST_FOLDER_WORDS = 20;

/** Shells and utilities an interceptor wraps that nobody names out loud. */
const UNSPOKEN: readonly string[] = ['curl', 'dd', 'rm', 'ssh', 'claude'];

interface Reach {
  agents: string[];
  /** Each MCP server, and which agents start it. */
  mcpServers: { name: string; agents: string[] }[];
  /** CLIs on this machine that Memnox watches, which any agent with a shell can run. */
  clis: string[];
  /** CLIs signed in here, so any agent with a shell that runs them acts as the person. */
  signedIn: { cli: string; can: string }[];
  /**
   * Whether each agent stops to ask before it acts, and where its program came from, as the
   * last kept scan read them. Left out for an agent that scan predates.
   */
  standing: AgentStanding[];
}

interface AgentStanding {
  agent: string;
  /** auto approves its own actions, asks stops for a person, unknown means nothing on disk says. */
  approval?: string;
  /** installed is where an installer puts programs; unusual is temp, Downloads or inside the work. */
  installedFrom?: string;
  signedBy?: string;
}

/** What the agents here can use, from the last scan and the CLIs Memnox watches. */
export async function readReach(home: string): Promise<Reach> {
  const snapshot = await new NodeSnapshotStore(join(home, MEMNOX_HOME))
    .latest()
    .catch(() => null);
  const names = await readNames(home);
  const agentName = (id: string, kind: string): string => names[id] ?? agentShown(kind);
  return {
    agents: (snapshot?.agents ?? []).map((agent) => agentName(agent.id, agent.kind)),
    mcpServers: (snapshot?.servers ?? []).map((server) => ({
      name: server.name,
      agents: server.agentIds.map((id) => agentName(id, kindOf(snapshot, id))),
    })),
    clis: (await watchedClis(home)).map((cli) => SPOKEN_CLI[cli] ?? cli),
    signedIn: await signedInOf(home),
    standing: (snapshot?.agents ?? [])
      .filter((agent) => agent.approval !== undefined || agent.host !== undefined)
      .map((agent) => ({
        agent: agentName(agent.id, agent.kind),
        ...(agent.approval === undefined ? {} : { approval: agent.approval }),
        ...(agent.host === undefined ? {} : { installedFrom: agent.host.location }),
        ...(agent.host?.signer === undefined ? {} : { signedBy: agent.host.signer }),
      })),
  };
}

/**
 * CLIs signed in on this machine, read live with the scan's own detectors and without
 * starting any MCP server, since the saved snapshot keeps only a few credential paths.
 */
async function signedInOf(home: string): Promise<{ cli: string; can: string }[]> {
  const report = await discover(new NodeMachineReader(home), {
    now: new Date().toISOString(),
  }).catch(() => null);
  return (report?.authenticated ?? []).map((each) => ({
    cli: SPOKEN_CLI[each.name] ?? each.name,
    can: each.headline,
  }));
}

/** Every name worth recognising, once each, for the recognizer and the brain alike. */
export async function readVocabulary(
  home: string,
  places: readonly string[] = [],
): Promise<string[]> {
  const [reach, heard, folders] = await Promise.all([
    readReach(home),
    readHeardWords(home).catch(() => []),
    folderUses(home).catch(() => []),
  ]);
  const words = [
    'Memnox',
    // What this person was misheard saying, so the recognizer expects the word they meant.
    ...heard.map((each) => each.meant),
    // The folders they work in most, so "open my memnox macos folder" is heard as said.
    ...folders.slice(0, MOST_FOLDER_WORDS).map((each) => spokenName(each.path)),
    ...reach.agents,
    ...reach.clis,
    ...reach.signedIn.map((each) => each.cli),
    ...reach.mcpServers.map((server) => server.name.replace(/[-_]/g, ' ')),
    ...places.map((place) => basename(place).replace(/[-_]/g, ' ')),
  ];
  return [...new Set(words.filter((word) => word.trim() !== ''))];
}

async function watchedClis(home: string): Promise<string[]> {
  const found = await readdir(interceptorDirFor(home)).catch(() => []);
  return found.filter((name) => !UNSPOKEN.includes(name)).sort();
}

function kindOf(snapshot: EnvironmentSnapshot | null, id: string): string {
  return snapshot?.agents.find((agent) => agent.id === id)?.kind ?? id;
}

/**
 * Every memnox command as said aloud, from this install's own help, so the recognizer hears
 * "memnox rewind" or "budget suggest" and a command added in an update is heard without one.
 */
export function commandWords(catalogue: string): string[] {
  const words = catalogue
    .split('\n')
    .map((line) => line.split(/[:<[]/)[0]?.trim() ?? '')
    .filter((name) => /^[a-z][a-z -]*$/.test(name))
    .flatMap((name) => [name.replace(/-/g, ' '), `memnox ${name.replace(/-/g, ' ')}`]);
  return [...new Set(words)];
}

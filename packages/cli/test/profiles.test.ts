import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  emptyHub,
  PROPOSAL_ANSWER,
  HUB_TRANSPORT,
  PROPOSAL_KIND,
  Proposals,
  RULE_SCOPE,
  SKILL_SCOPE,
  withAssignment,
  withServer,
  writeHub,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { agentsAnswer } from '../src/daemon/agents-answer';
import { profilesAnswer } from '../src/daemon/profiles-answer';
import { skillsHubAnswer } from '../src/daemon/skills-hub-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { machinePolicyPath } from '../src/protect/machine-rules';
import { mergeRules } from '../src/protect/merge-rules';
import { fileForScope, scopeAnswered, scopedRules } from '../src/protect/rule-scope';

/**
 * A profile bundles servers, skills and a rule pack under one name, and applying it to an agent in
 * a project raises the same signed proposals each piece raises alone, never granting anything itself.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const PACK = join(__dirname, '..', '..', '..', 'assets', 'packs', 'safe-defaults.toml');

const LINEAR = {
  name: 'linear',
  transport: HUB_TRANSPORT.STDIO,
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: {},
  secrets: {},
};

interface Machine {
  home: string;
  project: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
}

async function machine(): Promise<Machine> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-profiles-'));
  const project = await mkdtemp(join(tmpdir(), 'memnox-profiles-repo-'));
  await writeHub(home, withServer(emptyHub(), LINEAR));
  await skillsHubAnswer(
    home,
    {
      id: 1,
      method: DAEMON_METHOD.SKILL_PUT,
      skillScope: SKILL_SCOPE.PERSONAL,
      skillDraft: {
        name: 'review',
        version: '1.0.0',
        description: 'Review a change before it is pushed',
        instructions: '# Review\n\nRead the diff, then say what is risky.\n',
      },
    } as DaemonRequest,
    NOW,
  );
  return {
    home,
    project,
    ask: (request) =>
      profilesAnswer(
        home,
        { id: 2, method: DAEMON_METHOD.PROFILES, ...request } as DaemonRequest,
        NOW,
      ),
  };
}

async function backend(at: Machine): Promise<DaemonResponse> {
  return at.ask({
    method: DAEMON_METHOD.PROFILE_PUT,
    profileDraft: {
      name: 'Backend Engineering',
      description: 'What a backend change needs',
      skills: ['review', 'missing-skill'],
      mcpServers: ['linear'],
      rulePack: { name: 'Safe defaults', toml: await readFile(PACK, 'utf8') },
    },
  });
}

/** Where each rule card would put its rules: the file, the one place offered and the folders matched. */
async function rulePlaces(
  home: string,
): Promise<{ file: string; scopes: string[]; folders: string[] }[]> {
  return (await new Proposals(home).open(NOW.toISOString())).flatMap((each) => {
    const change = each.change;
    if (change.kind !== PROPOSAL_KIND.RULES) return [];
    return [
      {
        file: change.file,
        scopes: (change.scopes ?? []).map((scope) => scope.kind),
        folders: change.rules.flatMap((rule) => rule.match.workingDirectories ?? []),
      },
    ];
  });
}

async function kindsProposed(home: string): Promise<string[]> {
  return (await new Proposals(home).open(NOW.toISOString())).map(
    (each) => each.change.kind,
  );
}

describe('profiles', () => {
  it('are methods a screen asks', () => {
    expect(isVoiceMethod(DAEMON_METHOD.PROFILE_APPLY)).toBe(true);
  });

  it('keep a bundle under its name, saying what the hubs no longer hold', async () => {
    const at = await machine();
    const put = await backend(at);
    expect(put.ok).toBe(true);
    const [profile] = put.profiles ?? [];
    expect(profile?.id).toBe('backend-engineering');
    expect(profile?.mcpServers).toEqual(['linear']);
    expect(profile?.rulePack?.name).toBe('Safe defaults');
    expect(profile?.rulePack?.rules).toBeGreaterThan(0);
    expect(profile?.missing).toEqual(['missing-skill is not in the Skills Hub.']);
    expect(await kindsProposed(at.home)).toEqual([]);
  });

  it('raises a signed proposal for each server, skill and rule when applied to an agent in a project', async () => {
    const at = await machine();
    await backend(at);
    const applied = await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'Backend Engineering',
      profileAgent: 'claude-code',
      profileProject: at.project,
    });
    expect(applied.ok).toBe(true);
    const done = applied.profileApplied;
    expect(done?.project).toBe(at.project);
    expect(done?.skipped).toEqual(['missing-skill is not in the Skills Hub.']);
    const kinds = await kindsProposed(at.home);
    expect(kinds.filter((kind) => kind === PROPOSAL_KIND.MCP_HUB)).toHaveLength(1);
    expect(kinds.filter((kind) => kind === PROPOSAL_KIND.SKILLS_HUB)).toHaveLength(1);
    expect(kinds.filter((kind) => kind === PROPOSAL_KIND.RULES).length).toBeGreaterThan(
      0,
    );
    expect(done?.proposed).toHaveLength(kinds.length);
  });

  it("holds the pack's rules only in the repository it was applied to", async () => {
    const at = await machine();
    await backend(at);
    await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'Backend Engineering',
      profileAgent: 'claude-code',
      profileProject: at.project,
    });
    const places = await rulePlaces(at.home);
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      // This Mac's own file, narrowed by folder, so the repository is never dirtied.
      expect(place.file).toBe(machinePolicyPath(at.home));
      expect(place.scopes).toEqual([RULE_SCOPE.MACHINE]);
      expect(place.folders).toContain(at.project);
    }
  });

  it("writes a confirmed pack rule into this Mac's file, held to the folder, and leaves the repository's own file alone", async () => {
    const at = await machine();
    await backend(at);
    const theirs = join(at.project, 'memnox.policies.toml');
    const before = '# OURS: written by Memnox earlier\n';
    await writeFile(theirs, before);
    await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'Backend Engineering',
      profileAgent: 'claude-code',
      profileProject: at.project,
    });
    const [proposal] = (await new Proposals(at.home).open(NOW.toISOString())).filter(
      (each) => each.change.kind === PROPOSAL_KIND.RULES,
    );
    if (proposal === undefined || proposal.change.kind !== PROPOSAL_KIND.RULES)
      throw new Error('no rule was proposed');

    // The same resolution the daemon's confirm makes of a plain yes.
    const scope = scopeAnswered(proposal.change.scopes ?? [], PROPOSAL_ANSWER.CONFIRMED);
    if (scope === undefined) throw new Error('no scope was offered');
    const file = fileForScope(at.home, scope);
    await mergeRules(file, scopedRules(proposal.change.rules, scope), at.home);

    expect(file).toBe(machinePolicyPath(at.home));
    expect(await readFile(file, 'utf8')).toContain(at.project);
    expect(await readFile(theirs, 'utf8')).toBe(before);
  });

  it("keeps the pack's rules the person's own when no repository is named", async () => {
    const at = await machine();
    await backend(at);
    await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'Backend Engineering',
      profileAgent: 'claude-code',
    });
    const places = await rulePlaces(at.home);
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.scopes).toEqual([RULE_SCOPE.MACHINE]);
      expect(place.folders).toEqual([]);
    }
  });

  it('raises nothing for a server the agent already has', async () => {
    const at = await machine();
    await writeHub(
      at.home,
      withAssignment(
        withServer(emptyHub(), LINEAR),
        { server: 'linear', agent: 'claude-code' },
        true,
      ),
    );
    await at.ask({
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Tickets', mcpServers: ['linear'] },
    });
    const applied = await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'tickets',
      profileAgent: 'claude-code',
    });
    expect(applied.profileApplied?.already).toEqual(['linear']);
    expect(await kindsProposed(at.home)).toEqual([]);
  });

  it('refuses an agent it does not know and a profile nobody made', async () => {
    const at = await machine();
    await backend(at);
    const unknown = await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'backend-engineering',
      profileAgent: 'nobody',
    });
    expect(unknown.ok).toBe(false);
    const absent = await at.ask({
      method: DAEMON_METHOD.PROFILE_APPLY,
      profileName: 'Frontend',
      profileAgent: 'claude-code',
    });
    expect(absent.reason).toContain('No profile is called Frontend');
  });

  it('forgets a profile and leaves what it handed out', async () => {
    const at = await machine();
    await backend(at);
    const removed = await at.ask({
      method: DAEMON_METHOD.PROFILE_REMOVE,
      profileName: 'Backend Engineering',
    });
    expect(removed.ok).toBe(true);
    expect(removed.profiles).toEqual([]);
  });

  it('is applied to the agent in its folder before a launch opens it', async () => {
    const at = await machine();
    await backend(at);
    const launched = await agentsAnswer(
      at.home,
      {
        id: 3,
        method: DAEMON_METHOD.AGENT_LAUNCH,
        agentKind: 'claude-code',
        workingDirectory: at.project,
        profileName: 'Backend Engineering',
      } as DaemonRequest,
      { now: NOW, cards: async () => [], resolveCommand: () => '/usr/local/bin/claude' },
    );
    expect(launched.ok).toBe(true);
    expect(launched.agentLaunched?.workingDirectory).toBe(at.project);
    expect(launched.profileApplied?.agent).toBe('claude-code');
    expect(launched.proposed).toBe(launched.profileApplied?.proposed[0]);
    expect(await kindsProposed(at.home)).toContain(PROPOSAL_KIND.MCP_HUB);
    for (const place of await rulePlaces(at.home)) {
      expect(place.scopes).toEqual([RULE_SCOPE.MACHINE]);
      expect(place.folders).toContain(at.project);
    }
  });

  it('raises nothing for a launch that is refused, so no card is left to expire', async () => {
    const at = await machine();
    await backend(at);
    const launch = (fields: Partial<DaemonRequest>, installed: boolean) =>
      agentsAnswer(
        at.home,
        {
          id: 4,
          method: DAEMON_METHOD.AGENT_LAUNCH,
          agentKind: 'claude-code',
          workingDirectory: at.project,
          profileName: 'Backend Engineering',
          ...fields,
        } as DaemonRequest,
        {
          now: NOW,
          cards: async () => [],
          resolveCommand: () => (installed ? '/usr/local/bin/claude' : null),
        },
      );
    const notInstalled = await launch({}, false);
    expect(notInstalled.ok).toBe(false);
    expect(notInstalled.reason).toContain('not installed');
    const noFolder = await launch(
      { workingDirectory: join(at.project, 'nowhere') },
      true,
    );
    expect(noFolder.ok).toBe(false);
    expect(await kindsProposed(at.home)).toEqual([]);
  });
});

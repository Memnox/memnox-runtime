import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentsOf,
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  emptyHub,
  HUB_TRANSPORT,
  INSTRUCTION_MARKERS,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  proposalCapability,
  readHub,
  readPolicyRegistry,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SessionHosts,
  withServer,
  writeHub,
  type DaemonRequest,
  type DaemonResponse,
  type ProjectView,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { isProjectsMethod, projectsAnswer } from '../src/daemon/projects-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { policyRegistryPath } from '../src/policy-registry';

/**
 * Projects on the daemon: a repository found from its sessions, its instructions carried from
 * Claude Code's file into Codex's beside the person's own words, and its server and rule file
 * handed to its agents only once the person signs.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const RULES = `version = 1

[[policies]]
name = "no-force-push"

[policies.match]
actions = [ "git.push-force" ]

[policies.decision]
effect = "deny"
reason = "it rewrites history"
`;

interface Fixture {
  home: string;
  root: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  confirm(subject: string | undefined): Promise<string>;
}

async function fixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-projects-'));
  const root = join(home, 'Documents', 'acme');
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'CLAUDE.md'), '# Acme\n\nRun the tests with pnpm.\n');
  await writeFile(join(root, 'AGENTS.md'), 'My own notes for Codex.\n');
  await writeFile(join(root, 'memnox.policies.toml'), RULES);
  for (const [sessionId, agent] of [
    ['ses_1', 'claude-code'],
    ['ses_2', 'codex-cli'],
  ] as const)
    await new SessionHosts(home).note({
      sessionId,
      agent,
      pid: 1,
      cwd: join(root, 'src'),
      seenAt: NOW.toISOString(),
    });
  await writeHub(
    home,
    withServer(emptyHub(), {
      name: 'github',
      transport: HUB_TRANSPORT.HTTP,
      url: 'https://api.githubcopilot.com/mcp/',
      env: {},
      secrets: {},
    }),
  );
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  let id = 0;
  return {
    home,
    root,
    ask: (request) => {
      id += 1;
      return projectsAnswer(
        home,
        { id, method: DAEMON_METHOD.PROJECTS, ...request } as DaemonRequest,
        NOW,
      );
    },
    confirm: async (subject) => {
      if (subject === undefined) throw new Error('nothing was proposed');
      const message = confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED);
      const result = await confirmAnswer(home, {
        subject,
        answer: PROPOSAL_ANSWER.CONFIRMED,
        signature: sign('sha256', Buffer.from(message), privateKey).toString('base64'),
        at: NOW.toISOString(),
      });
      expect(result).toMatchObject({ ok: true });
      return 'outcome' in result ? String(result.outcome) : '';
    },
  };
}

function projectAt(response: DaemonResponse, root: string): ProjectView | undefined {
  return response.projects?.projects.find((each) => each.path === root);
}

describe('the projects methods', () => {
  it('are screen methods a phone reads and proposes through, signed as rules are', () => {
    expect(isProjectsMethod('projects')).toBe(true);
    expect(isVoiceMethod('project-apply')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.PROJECTS)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.PROJECT_APPLY)).toBe(REMOTE_CAPABILITY.ASK);
    expect(
      proposalCapability({
        kind: PROPOSAL_KIND.PROJECT,
        project: { projectId: 'prj_000000000000', root: '/r', servers: [], skills: [] },
      }),
    ).toBe(REMOTE_CAPABILITY.RULES);
  });

  it('finds a repository from its sessions, with its agents, sessions and instruction files', async () => {
    const at = await fixture();
    const project = projectAt(await at.ask({}), at.root);
    expect(project).toMatchObject({
      name: 'acme',
      declared: false,
      opened: false,
      agentsSeen: ['claude-code', 'codex-cli'],
      agents: ['claude-code', 'codex-cli'],
      sessions: { total: 2, ended: 0 },
      rules: { file: 'memnox.policies.toml', count: 1, inForce: false },
      memoryScope: 'project',
      lastActive: NOW.toISOString(),
    });
    expect(
      project?.instructions.filter((each) => each.source).map((each) => each.path),
    ).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('writes the manifest a team commits, and refuses one that reaches outside the repository', async () => {
    const at = await fixture();
    const put = await at.ask({
      method: DAEMON_METHOD.PROJECT_PUT,
      projectPath: at.root,
      projectDraft: {
        name: 'Acme',
        instructions: ['CLAUDE.md', 'AGENTS.md'],
        servers: ['github'],
        policy: 'memnox.policies.toml',
      },
    });
    expect(put.ok).toBe(true);
    expect(await readFile(join(at.root, '.memnox', 'project.toml'), 'utf8')).toContain(
      'servers = [ "github" ]',
    );
    expect(projectAt(put, at.root)).toMatchObject({ name: 'Acme', declared: true });

    const outside = await at.ask({
      method: DAEMON_METHOD.PROJECT_PUT,
      projectPath: at.root,
      projectDraft: { name: 'Acme', instructions: ['../../.ssh/config'] },
    });
    expect(outside.ok).toBe(false);
    const nowhere = await at.ask({
      method: DAEMON_METHOD.PROJECT_OPEN,
      projectPath: at.home,
    });
    expect(nowhere.ok).toBe(false);
  });

  it('opens with instructions carried between agents at once, and the server and rules only once signed', async () => {
    const at = await fixture();
    await at.ask({
      method: DAEMON_METHOD.PROJECT_PUT,
      projectPath: at.root,
      projectDraft: {
        name: 'Acme',
        instructions: ['CLAUDE.md', 'AGENTS.md'],
        servers: ['github'],
        policy: 'memnox.policies.toml',
      },
    });
    const opened = await at.ask({
      method: DAEMON_METHOD.PROJECT_OPEN,
      projectPath: at.root,
    });
    expect(opened.projectApplied?.written.sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    const agents = await readFile(join(at.root, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('My own notes for Codex.\n\n')).toBe(true);
    expect(agents).toContain('Run the tests with pnpm.');
    expect(await readFile(join(at.root, 'CLAUDE.md'), 'utf8')).toContain(
      'My own notes for Codex.',
    );

    // Nothing that widens holds before the person signs it.
    expect(opened.proposed).toMatch(/^prp_/);
    expect(agentsOf(await readHub(at.home), 'github')).toEqual([]);
    expect(await at.confirm(opened.proposed)).toContain('2 server grants');
    expect(agentsOf(await readHub(at.home), 'github').sort()).toEqual([
      'claude-code',
      'codex-cli',
    ]);
    expect(await readPolicyRegistry(policyRegistryPath(at.home))).toEqual([
      join(at.root, 'memnox.policies.toml'),
    ]);

    // Applied again, nothing is left to sign and no file changes.
    const id = projectAt(opened, at.root)?.id;
    const again = await at.ask({ method: DAEMON_METHOD.PROJECT_APPLY, projectId: id });
    expect(again.proposed).toBeUndefined();
    expect(again.projectApplied?.written).toEqual([]);
    expect(projectAt(again, at.root)).toMatchObject({
      opened: true,
      rules: { inForce: true },
      servers: [{ name: 'github', inHub: true, agents: ['claude-code', 'codex-cli'] }],
    });
  });

  it('takes its block back out of a file when the project no longer names that agent, leaving the person words', async () => {
    const at = await fixture();
    const opened = await at.ask({
      method: DAEMON_METHOD.PROJECT_OPEN,
      projectPath: at.root,
    });
    expect(await readFile(join(at.root, 'AGENTS.md'), 'utf8')).toContain(
      INSTRUCTION_MARKERS.begin,
    );
    await at.ask({
      method: DAEMON_METHOD.PROJECT_PUT,
      projectPath: at.root,
      projectDraft: {
        name: 'acme',
        instructions: ['CLAUDE.md'],
        agents: ['claude-code'],
      },
    });
    const applied = await at.ask({
      method: DAEMON_METHOD.PROJECT_APPLY,
      projectId: projectAt(opened, at.root)?.id,
    });
    expect(applied.projectApplied?.removed.sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(await readFile(join(at.root, 'AGENTS.md'), 'utf8')).toBe(
      'My own notes for Codex.\n',
    );
    expect(await readFile(join(at.root, 'CLAUDE.md'), 'utf8')).toBe(
      '# Acme\n\nRun the tests with pnpm.\n',
    );
  });

  it('refuses a project id that is not one', async () => {
    const at = await fixture();
    const answer = await at.ask({
      method: DAEMON_METHOD.PROJECT_APPLY,
      projectId: '../x',
    });
    expect(answer.ok).toBe(false);
  });
});

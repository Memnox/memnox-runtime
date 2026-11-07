import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  DAEMON_METHOD,
  ENV_AGENT_ROLE,
  MEMNOX_HOME,
  NodeSnapshotStore,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerRunCommand } from '../src/commands/run.command';
import { profilesAnswer } from '../src/daemon/profiles-answer';
import { plainStyle } from '../src/style';
import { boundProfileOf } from '../src/profiles/profile-bind';

/**
 * Every agent found here answers to a default profile nobody wrote down, and a person binds a kept
 * profile to it by hand. The agent keeps its ledger key, and nothing is written until they do.
 */

const NOW = new Date('2026-11-07T12:00:00.000Z');

async function machine(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-profile-bind-'));
  await new NodeSnapshotStore(join(home, MEMNOX_HOME)).save({
    takenAt: '2026-11-07T10:00:00.000Z',
    agents: [
      { id: 'agt_claude-code', kind: 'claude-code', surfaces: [] },
      { id: 'agt_cursor', kind: 'cursor', surfaces: [] },
    ],
    servers: [],
    resources: [],
  });
  return home;
}

function ask(
  home: string,
  request: Partial<DaemonRequest>,
  remote = false,
): Promise<DaemonResponse> {
  return profilesAnswer(
    home,
    { id: 1, method: DAEMON_METHOD.PROFILES, ...request } as DaemonRequest,
    NOW,
    { remote },
  );
}

describe('binding a profile to an agent', () => {
  it('gives every agent found a default profile without writing a file', async () => {
    const home = await machine();
    const read = await ask(home, {});
    const defaults = (read.profiles ?? []).filter((each) => each.isDefault === true);
    expect(defaults.map((each) => [each.id, each.name])).toEqual([
      ['default-claude-code', 'Claude Code'],
      ['default-cursor', 'Cursor'],
    ]);
    expect(defaults[0]?.connections[0]?.agentId).toBe('agt_claude-code');
    await expect(
      readFile(join(home, MEMNOX_HOME, 'agents', 'connections.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('binds a kept profile to an agent by name and takes it off again', async () => {
    const home = await machine();
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Reviewer', role: 'reviewer' },
    });
    const bound = await ask(home, {
      method: DAEMON_METHOD.PROFILE_BIND,
      profileName: 'reviewer',
      agentId: 'Cursor',
    });
    expect(bound.ok).toBe(true);
    const reviewer = (bound.profiles ?? []).find((each) => each.id === 'reviewer');
    expect(reviewer?.connections.map((each) => each.agentId)).toEqual(['agt_cursor']);
    expect((bound.profiles ?? []).some((each) => each.id === 'default-cursor')).toBe(
      false,
    );
    expect((await boundProfileOf(home, 'agt_cursor'))?.role).toBe('reviewer');

    const unbound = await ask(home, {
      method: DAEMON_METHOD.PROFILE_UNBIND,
      agentId: 'cursor',
    });
    expect(unbound.ok).toBe(true);
    expect(await boundProfileOf(home, 'agt_cursor')).toBeUndefined();
  });

  it('refuses a phone binding a profile that carries a role, and an agent nobody found', async () => {
    const home = await machine();
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Deployer', role: 'deployer' },
    });
    const fromPhone = await ask(
      home,
      { method: DAEMON_METHOD.PROFILE_BIND, profileName: 'deployer', agentId: 'cursor' },
      true,
    );
    expect(fromPhone.ok).toBe(false);
    const nobody = await ask(home, {
      method: DAEMON_METHOD.PROFILE_BIND,
      profileName: 'deployer',
      agentId: 'windsurf',
    });
    expect(nobody.error).toBe('No agent here goes by "windsurf".');
  });

  it('puts every agent back on its default when its profile is forgotten', async () => {
    const home = await machine();
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Coder' },
    });
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_BIND,
      profileName: 'coder',
      agentId: 'claude-code',
    });
    await ask(home, { method: DAEMON_METHOD.PROFILE_REMOVE, profileName: 'coder' });
    expect(await boundProfileOf(home, 'agt_claude-code')).toBeUndefined();
  });
});

describe('a session started under a bound profile', () => {
  async function roleOfRun(home: string, extra: string[]): Promise<string | undefined> {
    const start = vi.fn(async () => 0);
    const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
    registerRunCommand(program, new CliContext(new RecordedOutput(), plainStyle), {
      rootOf: () => null,
      egress: {
        daemonPort: async () => 4321,
        relay: async () => ({ port: 4322, close: async () => undefined }),
      },
      guard: { exists: () => false },
      start: start as never,
      home: () => home,
      newId: () => 'ses_role',
      onPath: () => true,
      milestones: (() => ({
        take: async () => ({ id: 'mst_1' }),
        forget: async () => [],
      })) as never,
    });
    await program.parseAsync(['run', ...extra, '--', 'claude'], { from: 'user' });
    const env = (
      start.mock.calls[0] as unknown as [string, string[], NodeJS.ProcessEnv]
    )[2];
    return env[ENV_AGENT_ROLE];
  }

  it('is matched under the profile role, unless --role names another', async () => {
    const home = await machine();
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_PUT,
      profileDraft: { name: 'Coder', role: 'coder' },
    });
    await ask(home, {
      method: DAEMON_METHOD.PROFILE_BIND,
      profileName: 'coder',
      agentId: 'claude-code',
    });
    expect(await roleOfRun(home, [])).toBe('coder');
    expect(await roleOfRun(home, ['--role', 'deployer'])).toBe('deployer');
  });
});

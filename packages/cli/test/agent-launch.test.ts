import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  DISPLAY,
  DisplayRequests,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  type DaemonResponse,
} from '@memnox/core';
import { agentsAnswer } from '../src/daemon/agents-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/** An agent opened in a terminal from a screen: only one with a known command, only in a real folder. */

const NOW = new Date('2026-10-30T12:00:00.000Z');

async function launch(
  home: string,
  agentKind: string,
  workingDirectory: string,
  installed = true,
): Promise<DaemonResponse> {
  return agentsAnswer(
    home,
    { id: 1, method: DAEMON_METHOD.AGENT_LAUNCH, agentKind, workingDirectory },
    {
      now: NOW,
      cards: async () => [],
      resolveCommand: () => (installed ? 'claude' : null),
    },
  );
}

describe('agent-launch', () => {
  it('asks the Mac to type the agent under memnox run in a new terminal in the folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-launch-'));
    const folder = await mkdtemp(join(tmpdir(), 'memnox-launch-repo-'));

    const answer = await launch(home, 'claude-code', folder);

    expect(answer.ok).toBe(true);
    expect(answer.agentLaunched).toEqual({
      agent: 'claude-code',
      workingDirectory: folder,
      line: `cd '${folder}' && memnox run -- claude`,
    });
    const [shown] = await new DisplayRequests(home).open(NOW.toISOString());
    expect(shown?.display).toBe(DISPLAY.LAUNCH);
    expect(shown?.cwd).toBe(folder);
    expect(shown?.text).toBe(answer.agentLaunched?.line);
  });

  it('reads Codex by the kind discovery gives it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-launch-'));
    const answer = await launch(home, 'codex-cli', home);
    expect(answer.agentLaunched?.agent).toBe('codex');
  });

  it('refuses an agent with no launch command, a missing folder, and one not installed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-launch-'));

    expect((await launch(home, 'windsurf', home)).reason).toMatch(/cannot be opened/);
    expect((await launch(home, 'claude-code', join(home, 'nowhere'))).reason).toMatch(
      /Name a folder/,
    );
    expect((await launch(home, 'claude-code', home, false)).reason).toMatch(
      /not installed/,
    );
    expect(await new DisplayRequests(home).open(NOW.toISOString())).toEqual([]);
  });

  it('is a screen method, and from a phone needs what only the Mac does', () => {
    expect(isVoiceMethod(DAEMON_METHOD.AGENT_LAUNCH)).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.AGENT_LAUNCH)).toBe(REMOTE_CAPABILITY.MAC);
  });
});

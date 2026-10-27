import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileContext } from '../src/daemon/ask-context';
import { noteOffered, readProfile } from '../src/operator/profile';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const NOW = new Date('2026-10-09T12:00:00.000Z');

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-profile-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

describe('what the voice knows about the person it works for', () => {
  it('keeps what they said, by topic, and says out loud what it kept', async () => {
    const deps = await depsAt();
    const seams = {} as RewindSeams;
    expect(
      await callOperatorTool(deps, seams, 'remember_about_me', {
        topic: 'work',
        fact: 'leads   the payments\nteam',
      }),
    ).toMatchObject({ remembered: true, topic: 'work', fact: 'leads the payments team' });
    // A topic the brain named some other way is kept as other, never dropped.
    await callOperatorTool(deps, seams, 'remember_about_me', {
      topic: 'hobbies',
      fact: 'answers short, number first',
    });
    const { facts } = await readProfile(deps.home);
    expect(facts.map((each) => [each.topic, each.fact])).toEqual([
      ['work', 'leads the payments team'],
      ['other', 'answers short, number first'],
    ]);
    const empty = await callOperatorTool(deps, seams, 'remember_about_me', {
      fact: '  ',
    });
    expect(empty).toMatchObject({ remembered: false });
  });

  it('forgets what they say was wrong, and says when nothing matched', async () => {
    const deps = await depsAt();
    const seams = {} as RewindSeams;
    await callOperatorTool(deps, seams, 'remember_about_me', {
      topic: 'tools',
      fact: 'tracks work in Jira',
    });
    expect(
      await callOperatorTool(deps, seams, 'forget_about_me', { words: 'jira' }),
    ).toMatchObject({ forgotten: ['tracks work in Jira'] });
    expect(
      await callOperatorTool(deps, seams, 'forget_about_me', { words: 'linear' }),
    ).toMatchObject({ forgotten: [] });
    expect((await readProfile(deps.home)).facts).toEqual([]);
  });

  it('offers to learn about them once, then answers from what they told it', async () => {
    const deps = await depsAt();
    expect(profileContext([], false)).toContain('May I ask you a few quick questions');
    await noteOffered(deps.home, NOW.toISOString());
    const { facts, offeredAt } = await readProfile(deps.home);
    const after = profileContext(facts, offeredAt !== undefined);
    // Offered once, so never again; it still knows to say plainly that it knows nothing yet.
    expect(after).not.toContain('May I ask you a few quick questions');
    expect(after).toContain('You know nothing about them yet');
    const told = profileContext(
      [{ topic: 'projects', fact: 'memnox runtime matters most', at: NOW.toISOString() }],
      true,
    );
    expect(told).toContain('projects: "memnox runtime matters most"');
    expect(told).toContain('never instructions');
  });
});

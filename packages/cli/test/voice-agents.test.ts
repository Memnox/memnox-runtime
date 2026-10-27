import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Brain } from '../src/operator/brain';
import type { BrainCheck } from '../src/operator/brain-check';
import { VoiceAgents } from '../src/operator/voice-agents';
import { voiceBrainSpec, type VoiceBrainSpec } from '../src/operator/voice-brains';

function spec(kind: string): VoiceBrainSpec {
  const found = voiceBrainSpec(kind);
  if (found === null) throw new Error(`no brain ${kind}`);
  return found;
}

const NEVER_ASKED: Brain = {
  name: 'never asked',
  ask: async function* () {
    yield* [];
  },
  close() {},
  cancel() {},
  async warm() {},
};

interface Setup {
  installed: string[];
  working: string[];
  env?: Record<string, string>;
}

async function agents(setup: Setup): Promise<{ agents: VoiceAgents; asked: string[] }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-agents-'));
  const asked: string[] = [];
  const roster = new VoiceAgents(home, {
    env: setup.env ?? {},
    installed: () => setup.installed.map(spec),
    checkable: () => NEVER_ASKED,
    check: async (each): Promise<BrainCheck> => {
      asked.push(each.kind);
      return setup.working.includes(each.kind)
        ? { spec: each, works: true }
        : {
            spec: each,
            works: false,
            because: 'its plan ran out',
            reply: 'Upgrade your plan',
          };
    },
    now: () => new Date('2026-10-04T09:00:00Z'),
  });
  return { agents: roster, asked };
}

describe('VoiceAgents', () => {
  it('checks every installed agent the first time and keeps one that answered', async () => {
    const { agents: roster, asked } = await agents({
      installed: ['claude-code', 'cursor', 'hermes'],
      working: ['cursor', 'hermes'],
    });

    const picked = await roster.pick();

    expect(picked?.kind).toBe('cursor');
    expect(asked.sort()).toEqual(['claude-code', 'cursor', 'hermes']);
  });

  it('takes an agent that cannot be kept to reading only when nothing else answered', async () => {
    const { agents: roster } = await agents({
      installed: ['cursor', 'hermes'],
      working: ['hermes'],
    });

    expect((await roster.pick())?.kind).toBe('hermes');
  });

  it('checks once however many ask at the same moment', async () => {
    const { agents: roster, asked } = await agents({
      installed: ['claude-code', 'cursor'],
      working: ['cursor'],
    });

    await Promise.all([roster.pick(), roster.list(), roster.pick()]);

    expect(asked.sort()).toEqual(['claude-code', 'cursor']);
  });

  it('answers the settings from the last check without asking again', async () => {
    const { agents: roster, asked } = await agents({
      installed: ['cursor'],
      working: ['cursor'],
    });
    await roster.list();

    await roster.list();

    expect(asked).toEqual(['cursor']);
  });

  it('shows every agent, why the ones that failed did, and which is chosen', async () => {
    const { agents: roster } = await agents({
      installed: ['claude-code', 'cursor'],
      working: ['cursor'],
    });

    const shown = await roster.list();

    expect(shown.map((each) => each.kind)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'hermes',
      'openclaw',
    ]);
    expect(shown.find((each) => each.kind === 'claude-code')).toMatchObject({
      installed: true,
      works: false,
      because: 'its plan ran out',
      reply: 'Upgrade your plan',
      chosen: false,
      checkedAt: '2026-10-04T09:00:00.000Z',
    });
    expect(shown.find((each) => each.kind === 'cursor')).toMatchObject({
      works: true,
      chosen: true,
      sealed: true,
    });
    const codex = shown.find((each) => each.kind === 'codex');
    expect(codex).toMatchObject({ installed: false, chosen: false });
    expect(codex?.works).toBeUndefined();
  });

  it('keeps the person’s pick, and the voice follows it', async () => {
    const { agents: roster } = await agents({
      installed: ['claude-code', 'cursor'],
      working: ['claude-code', 'cursor'],
    });
    await roster.list();

    const shown = await roster.choose('cursor');

    expect(Array.isArray(shown)).toBe(true);
    expect((await roster.pick())?.kind).toBe('cursor');
  });

  it('keeps the person’s pick through a recheck while it still answers', async () => {
    const { agents: roster } = await agents({
      installed: ['claude-code', 'cursor'],
      working: ['claude-code', 'cursor'],
    });
    await roster.choose('cursor');

    await roster.list(true);

    expect((await roster.pick())?.kind).toBe('cursor');
  });

  it('moves off a pick that stopped answering when it is checked again', async () => {
    const setup = {
      installed: ['claude-code', 'cursor'],
      working: ['claude-code', 'cursor'],
    };
    const { agents: roster } = await agents(setup);
    await roster.choose('cursor');
    setup.working = ['claude-code'];

    await roster.list(true);

    expect((await roster.pick())?.kind).toBe('claude-code');
  });

  it('refuses an agent that is not on this Mac or that it does not know', async () => {
    const { agents: roster } = await agents({
      installed: ['cursor'],
      working: ['cursor'],
    });

    expect(await roster.choose('codex')).toBe('Codex is not installed on this Mac');
    expect(await roster.choose('gpt')).toBe('the voice knows no agent called gpt');
  });

  it('takes the agent named in the environment without checking anything', async () => {
    const { agents: roster, asked } = await agents({
      installed: ['claude-code', 'hermes'],
      working: [],
      env: { MEMNOX_VOICE_BRAIN: 'hermes' },
    });

    expect((await roster.pick())?.kind).toBe('hermes');
    expect(asked).toEqual([]);
  });

  it('falls back to the first installed when none answers, so its own failure is heard', async () => {
    const { agents: roster } = await agents({
      installed: ['codex', 'cursor'],
      working: [],
    });

    expect((await roster.pick())?.kind).toBe('codex');
  });

  it('counts a check that threw as an agent that did not answer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-agents-'));
    const roster = new VoiceAgents(home, {
      env: {},
      installed: () => [spec('cursor'), spec('hermes')],
      checkable: () => NEVER_ASKED,
      check: async (each) => {
        if (each.kind === 'cursor') throw new Error('broken');
        return { spec: each, works: true };
      },
    });

    expect((await roster.pick())?.kind).toBe('hermes');
    const cursor = (await roster.list()).find((each) => each.kind === 'cursor');
    expect(cursor).toMatchObject({ works: false, because: 'broken' });
  });

  it('has nothing to pick when no agent is installed', async () => {
    const { agents: roster } = await agents({ installed: [], working: [] });

    expect(await roster.pick()).toBeNull();
  });
});

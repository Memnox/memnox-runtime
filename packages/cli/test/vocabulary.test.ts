import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeJsonFile } from '@memnox/core';
import { commandWords, readReach, readVocabulary } from '../src/operator/vocabulary';
import { voicePrompt } from '../src/operator/voice-prompts';

async function machine(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-vocabulary-'));
  const bin = join(home, '.memnox', 'bin');
  await mkdir(bin, { recursive: true });
  for (const cli of ['railway', 'vercel', 'gh', 'rm', 'curl']) {
    await writeFile(join(bin, cli), '');
  }
  await writeJsonFile(
    join(home, '.memnox', 'snapshots', '2026-09-30T10-00-00.000Z.json'),
    {
      takenAt: '2026-09-30T10:00:00.000Z',
      agents: [
        { id: 'agt_claude-code', kind: 'claude-code', surfaces: [] },
        { id: 'agt_hermes', kind: 'hermes', surfaces: [] },
      ],
      servers: [
        {
          name: 'next-devtools',
          grantedBy: 'x',
          agentIds: ['agt_claude-code'],
          tools: [],
        },
      ],
      resources: [],
    },
  );
  return home;
}

describe('the names this machine uses', () => {
  it('names the agents, the CLIs Memnox watches and the servers, the way a person says them', async () => {
    const reach = await readReach(await machine());
    expect(reach.agents).toEqual(['Claude Code', 'Hermes']);
    expect(reach.clis).toEqual(['GitHub CLI', 'Railway', 'Vercel']);
    expect(reach.mcpServers).toEqual([
      { name: 'next-devtools', agents: ['Claude Code'] },
    ]);
  });

  it('gives the recognizer each name once, and nothing nobody says out loud', async () => {
    const words = await readVocabulary(await machine(), ['/Users/me/work/memnox-macos']);
    expect(words).toEqual(
      expect.arrayContaining([
        'Memnox',
        'Claude Code',
        'Railway',
        'Vercel',
        'next devtools',
        'memnox macos',
      ]),
    );
    expect(words).not.toContain('rm');
    expect(new Set(words).size).toBe(words.length);
  });

  it('tells the brain its words came through speech recognition, and the names to map them to', () => {
    const prompt = voicePrompt(['Claude Code', 'Railway']);
    expect(prompt).toContain('speech recognition, which mishears names');
    expect(prompt).toContain('Names on this machine: Claude Code, Railway.');
    expect(prompt).toContain('never ask them to spell');
  });
});

describe('the memnox commands taught to the recognizer', () => {
  it('names each command as said aloud, with and without memnox before it', () => {
    const words = commandWords(
      [
        'scan [unrecognized]: What can act on this machine',
        'task set <statement>: Declare it',
        'forget-key: Clear the confirmation key',
        '  --yes: not a command',
      ].join('\n'),
    );
    expect(words).toEqual(
      expect.arrayContaining([
        'scan',
        'memnox scan',
        'task set',
        'forget key',
        'memnox forget key',
      ]),
    );
    expect(words.some((each) => each.includes('--'))).toBe(false);
  });
});

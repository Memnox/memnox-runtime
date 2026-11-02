import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  MEMNOX_HOME,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { skillsHubAnswer } from '../src/daemon/skills-hub-answer';
import { transcriptUsageIn } from '../src/daemon/transcript-usage';

/**
 * Skills that improve with use, on the daemon: counts read from the transcripts Claude Code keeps,
 * a note kept outside the skill's folder so nothing accepted changes, and a calibration that
 * suggests a new version through SKILL_PUT and writes nothing itself.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const REVIEW = `---
name: review
description: Review a change before it is pushed
allowed-tools: Read, Grep
---

# Review

Read the diff with git, then say what is risky.
`;

function line(entry: object): string {
  return JSON.stringify(entry);
}

const TRANSCRIPT = [
  line({
    type: 'user',
    timestamp: '2026-10-29T10:00:00Z',
    message: { content: 'review it' },
  }),
  line({
    type: 'assistant',
    timestamp: '2026-10-29T10:00:05Z',
    message: {
      id: 'msg_1',
      model: 'claude-opus-5-5',
      usage: { cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 },
      content: [
        { type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'tools:review' } },
      ],
    },
  }),
  line({
    type: 'assistant',
    timestamp: '2026-10-29T10:00:06Z',
    message: { id: 'msg_1', usage: { cache_creation_input_tokens: 2000 }, content: [] },
  }),
  line({
    type: 'user',
    timestamp: '2026-10-29T10:00:10Z',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: 'exit 1\nmore',
        },
        {
          type: 'tool_result',
          tool_use_id: 't3',
          is_error: true,
          content: [{ type: 'text', text: 'Permission to use Bash has been denied.' }],
        },
      ],
    },
  }),
  line({
    type: 'user',
    timestamp: '2026-10-29T10:01:00Z',
    message: { content: 'thanks' },
  }),
  line({
    type: 'user',
    timestamp: '2026-10-29T10:01:10Z',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 't4', is_error: true, content: 'outside' },
      ],
    },
  }),
  '{"torn',
].join('\n');

async function fixture(): Promise<{
  home: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
}> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-skill-care-'));
  await mkdir(join(home, '.claude', 'skills', 'review'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'review', 'SKILL.md'), REVIEW);
  const projects = join(home, '.claude', 'projects', '-repo');
  await mkdir(projects, { recursive: true });
  await writeFile(join(projects, 'ses-1.jsonl'), TRANSCRIPT);
  let id = 0;
  const ask = (request: Partial<DaemonRequest>): Promise<DaemonResponse> => {
    id += 1;
    return skillsHubAnswer(
      home,
      { id, method: DAEMON_METHOD.SKILLS_HUB, ...request } as DaemonRequest,
      NOW,
    );
  };
  const view = await ask({});
  const found = view.skillsHub?.found.find((each) => each.name === 'review');
  expect(
    (await ask({ method: DAEMON_METHOD.SKILL_IMPORT, skillFoundId: found?.id })).ok,
  ).toBe(true);
  return { home, ask };
}

describe('reading a transcript for skills and cost', () => {
  it('counts each message once, and what failed or was refused inside the skill turn only', () => {
    const usage = transcriptUsageIn(TRANSCRIPT, 'ses-1');
    expect(usage.turns).toEqual([
      expect.objectContaining({
        session: 'ses-1',
        model: 'claude-opus-5-5',
        cacheWrite: 2000,
      }),
    ]);
    expect(
      usage.skills.map((event) => `${event.skill}:${event.outcome}:${event.said ?? ''}`),
    ).toEqual([
      'review:use:',
      'review:failure:exit 1',
      'review:refusal:Permission to use Bash has been denied.',
    ]);
  });
});

describe('the skill care methods', () => {
  it('counts a skill from the chats, keeps a note outside its folder, and suggests a fix', async () => {
    const at = await fixture();
    const stats = await at.ask({ method: DAEMON_METHOD.SKILL_STATS });
    expect(stats.skillStats).toEqual([
      expect.objectContaining({
        name: 'review',
        uses: 1,
        failures: 1,
        refusals: 1,
        notes: [],
      }),
    ]);
    const noted = await at.ask({
      method: DAEMON_METHOD.SKILL_NOTE,
      skillName: 'review',
      skillNote: 'Read the staged diff,\n not the whole tree',
    });
    expect(noted.skillStats?.[0]?.notes).toEqual([
      'Read the staged diff, not the whole tree',
    ]);
    expect(
      await readFile(join(at.home, MEMNOX_HOME, 'skill-notes', 'review.md'), 'utf8'),
    ).toBe('- Read the staged diff, not the whole tree\n');
    const before = (await at.ask({})).skillsHub?.skills[0];
    const calibrated = await at.ask({
      method: DAEMON_METHOD.SKILL_CALIBRATE,
      skillName: 'review',
    });
    expect(calibrated.skillCalibration?.section).toContain('Read the staged diff');
    expect(calibrated.skillCalibration?.draft.version).not.toBe(before?.version);
    expect(calibrated.skillsHub?.skills[0]?.digest).toBe(before?.digest);
    expect(calibrated.skillsHub?.skills[0]?.held).toBeUndefined();
    const accepted = await at.ask({
      method: DAEMON_METHOD.SKILL_PUT,
      skillDraft: calibrated.skillCalibration?.draft,
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.skillsHub?.skills[0]?.instructions).toContain('Known issues / fixes');
  });

  it('refuses a note for a skill the hub does not hold, or one with no words', async () => {
    const at = await fixture();
    expect(
      (
        await at.ask({
          method: DAEMON_METHOD.SKILL_NOTE,
          skillName: 'ghost',
          skillNote: 'x',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await at.ask({
          method: DAEMON_METHOD.SKILL_NOTE,
          skillName: 'review',
          skillNote: '  ',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await at.ask({
          method: DAEMON_METHOD.SKILL_NOTE,
          skillName: '../x',
          skillNote: 'y',
        })
      ).ok,
    ).toBe(false);
  });
});

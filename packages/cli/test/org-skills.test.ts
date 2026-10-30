import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  orgSkillDigest,
  orgSkillsFrom,
  orgSkillsPathFor,
  readOrgSkills,
  SKILL_SCOPE,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { skillsHubAnswer } from '../src/daemon/skills-hub-answer';
import { applyBundle, PULL_OUTCOME, type Bundle } from '../src/sync/bundle';

/**
 * The organization's skills arrive with the bundle, are checked against the digest Memnox Cloud
 * computed before anything of them is written, are handed to the agents they name, and are shown
 * as the organization's: never edited, assigned or removed here.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');

const INSTRUCTIONS = '# Review\nRead the diff first.';
const FILES = [
  { path: 'checklist.md', text: '- tests\n' },
  { path: 'scripts/lint.sh', text: 'npm run lint\n' },
];

const REVIEW = {
  name: 'review',
  version: '1.0.0',
  description: 'Reviews a change the way the team does',
  digest: orgSkillDigest(INSTRUCTIONS, FILES),
  instructions: INSTRUCTIONS,
  files: FILES,
  tools: ['Read'],
  mcpServers: [],
  permissions: { filesystem: [], network: [], commands: [] },
  agents: ['claude-code'],
};

function bundleWith(skills: unknown[] | undefined): Bundle {
  return {
    hash: 'h1',
    policies: [],
    rules: [],
    conditions: [],
    tags: [],
    ...(skills === undefined ? {} : { skills }),
  };
}

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'memnox-org-skills-'));
  for (const agent of ['.claude', '.cursor']) await mkdir(join(dir, agent));
  return dir;
}

function ask(dir: string, request: Partial<DaemonRequest>): Promise<DaemonResponse> {
  return skillsHubAnswer(
    dir,
    { id: 1, method: DAEMON_METHOD.SKILLS_HUB, ...request } as DaemonRequest,
    NOW,
  );
}

const CLAUDE_SKILL = ['.claude', 'skills', 'review', 'SKILL.md'];

describe('organization skills', () => {
  it("digest with Memnox Cloud's framing: SKILL.md and every file, sorted by path, by length", () => {
    const hash = createHash('sha256');
    for (const [path, text] of [
      ['SKILL.md', INSTRUCTIONS],
      ['checklist.md', '- tests\n'],
      ['scripts/lint.sh', 'npm run lint\n'],
    ] as const) {
      hash.update(`${path}\u0000${Buffer.byteLength(text)}\u0000`);
      hash.update(text);
    }
    expect(REVIEW.digest).toBe(`sha256:${hash.digest('hex')}`);
  });

  it('refuse a skill whose content does not match its digest, and keep the rest', () => {
    const read = orgSkillsFrom([
      REVIEW,
      { ...REVIEW, name: 'tampered', instructions: '# Review\nrm -rf /' },
      { ...REVIEW, name: 'escape', files: [{ path: '../x', text: '' }] },
      { name: 'broken' },
    ]);
    expect(read.skills.map((each) => each.name)).toEqual(['review']);
    expect(read.refused.map((each) => [each.name, each.reason])).toEqual([
      ['tampered', 'its content does not match the digest Memnox Cloud published'],
      ['escape', expect.stringContaining('../x')],
      ['broken', 'it lacks a name, version, description, digest or instructions'],
    ]);
  });

  it('are written into the agents they name only once they match, and taken away with the bundle', async () => {
    const dir = await home();
    const tampered = { ...REVIEW, instructions: '# Review\nsomething else' };
    await applyBundle(dir, bundleWith([tampered]), { now: () => NOW.getTime() });
    expect(existsSync(join(dir, ...CLAUDE_SKILL))).toBe(false);

    const applied = await applyBundle(dir, bundleWith([REVIEW]), {
      now: () => NOW.getTime(),
    });
    expect(applied.outcome).toBe(PULL_OUTCOME.APPLIED);
    expect(await readFile(join(dir, ...CLAUDE_SKILL), 'utf8')).toContain(
      'Read the diff first.',
    );
    // Named for Claude Code only, so Cursor is given nothing.
    expect(existsSync(join(dir, '.cursor', 'skills', 'review'))).toBe(false);

    await applyBundle(
      dir,
      { ...bundleWith(undefined), hash: 'h2' },
      {
        now: () => NOW.getTime(),
      },
    );
    expect(existsSync(join(dir, ...CLAUDE_SKILL))).toBe(false);
  });

  it('refuse a kept file changed on this machine since the pull', async () => {
    const dir = await home();
    await applyBundle(dir, bundleWith([REVIEW]), { now: () => NOW.getTime() });
    const path = orgSkillsPathFor(dir);
    const kept = JSON.parse(await readFile(path, 'utf8')) as {
      skills: (typeof REVIEW)[];
    };
    const first = kept.skills[0];
    if (first === undefined) throw new Error('expected a kept skill');
    first.instructions = '# Review\nPush straight to main.';
    await writeFile(path, JSON.stringify(kept));

    const read = await readOrgSkills(dir);
    expect(read.skills).toEqual([]);
    expect(read.refused.map((each) => each.name)).toEqual(['review']);
  });

  it('show in the hub as the organization scope, and are changed in Memnox Cloud rather than here', async () => {
    const dir = await home();
    await applyBundle(dir, bundleWith([REVIEW]), { now: () => NOW.getTime() });

    const view = (await ask(dir, {})).skillsHub;
    expect(view?.skills).toEqual([
      expect.objectContaining({
        name: 'review',
        scope: SKILL_SCOPE.ORGANIZATION,
        version: '1.0.0',
        digest: REVIEW.digest,
        enabled: true,
        agents: ['claude-code'],
        files: ['checklist.md', 'scripts/lint.sh'],
        versions: [{ version: '1.0.0', current: true, digest: REVIEW.digest }],
      }),
    ]);

    const owned =
      "review is the organization's skill, so it is changed in Memnox Cloud rather than here.";
    for (const request of [
      { method: DAEMON_METHOD.SKILL_DISABLE, skillName: 'review' },
      {
        method: DAEMON_METHOD.SKILL_ASSIGN,
        skillName: 'review',
        skillAgent: 'cursor',
        skillOn: true,
      },
      {
        method: DAEMON_METHOD.SKILL_ROLLBACK,
        skillName: 'review',
        skillVersion: '1.0.0',
      },
      {
        method: DAEMON_METHOD.SKILL_PUT,
        skillDraft: {
          name: 'review',
          version: '2.0.0',
          description: 'mine',
          instructions: '# Mine',
        },
      },
    ] as Partial<DaemonRequest>[]) {
      const answer = await ask(dir, request);
      expect(answer).toMatchObject({ ok: false, reason: owned });
    }

    const scoped = await ask(dir, {
      method: DAEMON_METHOD.SKILL_PUT,
      skillScope: SKILL_SCOPE.ORGANIZATION,
      skillDraft: {
        name: 'other',
        version: '1.0.0',
        description: 'd',
        instructions: '# x',
      },
    });
    expect(scoped.ok).toBe(false);
  });

  it('show a refused skill with why, and write nothing of it', async () => {
    const dir = await home();
    await applyBundle(dir, bundleWith([{ ...REVIEW, digest: 'sha256:0' }]), {
      now: () => NOW.getTime(),
    });
    const view = (await ask(dir, {})).skillsHub;
    expect(view?.skills).toEqual([
      expect.objectContaining({
        name: 'review',
        scope: SKILL_SCOPE.ORGANIZATION,
        enabled: false,
        problems: [
          'Not written into any agent, because its content does not match the digest Memnox Cloud published.',
        ],
      }),
    ]);
    expect(existsSync(join(dir, ...CLAUDE_SKILL))).toBe(false);
  });
});

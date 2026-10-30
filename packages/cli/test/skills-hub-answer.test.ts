import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  MEMNOX_HOME,
  OURS_MARKER,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  proposalCapability,
  Proposals,
  REMOTE_CAPABILITY,
  remoteCapabilityFor,
  SKILL_STANDING,
  type DaemonRequest,
  type DaemonResponse,
  type SkillDraft,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { isSkillsMethod, skillsHubAnswer } from '../src/daemon/skills-hub-answer';
import { isVoiceMethod } from '../src/daemon/voice-methods';

/**
 * The Skills Hub on the daemon: a Claude Code skill imported and handed to Codex and Cursor in
 * their own formats once signed, held when its folder changes, and never written over a person's file.
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

interface Fixture {
  home: string;
  ask(request: Partial<DaemonRequest>): Promise<DaemonResponse>;
  confirm(subject: string | undefined): Promise<string>;
}

async function fixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-skills-hub-'));
  for (const dir of ['.codex', '.cursor', '.gemini']) await mkdir(join(home, dir));
  await mkdir(join(home, '.claude', 'skills', 'review', 'scripts'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'review', 'SKILL.md'), REVIEW);
  await writeFile(
    join(home, '.claude', 'skills', 'review', 'scripts', 'diff.sh'),
    'git diff\n',
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
    ask: (request) => {
      id += 1;
      return skillsHubAnswer(
        home,
        { id, method: DAEMON_METHOD.SKILLS_HUB, ...request } as DaemonRequest,
        NOW,
      );
    },
    confirm: async (subject) => {
      if (subject === undefined) throw new Error('nothing was proposed');
      const message = confirmationMessage(subject, PROPOSAL_ANSWER.CONFIRMED);
      const signature = sign('sha256', Buffer.from(message), privateKey).toString(
        'base64',
      );
      const result = await confirmAnswer(home, {
        subject,
        answer: PROPOSAL_ANSWER.CONFIRMED,
        signature,
        at: NOW.toISOString(),
      });
      expect(result).toMatchObject({ ok: true });
      return 'outcome' in result ? String(result.outcome) : '';
    },
  };
}

async function imported(at: Fixture): Promise<void> {
  const view = await at.ask({});
  const found = view.skillsHub?.found.find((each) => each.name === 'review');
  const answer = await at.ask({
    method: DAEMON_METHOD.SKILL_IMPORT,
    skillFoundId: found?.id,
  });
  expect(answer.ok).toBe(true);
}

async function given(at: Fixture, agent: string): Promise<string> {
  const proposed = await at.ask({
    method: DAEMON_METHOD.SKILL_ASSIGN,
    skillName: 'review',
    skillAgent: agent,
    skillOn: true,
  });
  expect(proposed.proposed).toMatch(/^prp_/);
  return at.confirm(proposed.proposed);
}

describe('the Skills Hub methods', () => {
  it('are screen methods a phone reads and proposes through, signed as rules are', () => {
    expect(isSkillsMethod('skills-hub')).toBe(true);
    expect(isVoiceMethod('skill-assign')).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.SKILLS_HUB)).toBe(REMOTE_CAPABILITY.SEE);
    expect(remoteCapabilityFor(DAEMON_METHOD.SKILL_ASSIGN)).toBe(REMOTE_CAPABILITY.ASK);
    expect(
      proposalCapability({
        kind: PROPOSAL_KIND.SKILLS_HUB,
        skills: { assign: { name: 'r', agent: 'cursor' } },
      }),
    ).toBe(REMOTE_CAPABILITY.RULES);
  });

  it('imports a Claude Code skill with its files, and lists every agent that takes skills', async () => {
    const at = await fixture();
    await imported(at);

    const view = (await at.ask({})).skillsHub;
    const skill = view?.skills[0];
    expect(skill).toMatchObject({
      name: 'review',
      scope: 'personal',
      version: '1.0.0',
      description: 'Review a change before it is pushed',
      enabled: true,
      tools: ['Read', 'Grep'],
      files: ['scripts/diff.sh'],
      agents: [],
    });
    expect(skill?.held).toBeUndefined();
    expect(
      skill?.compatibility.find((each) => each.agent === 'cursor')?.loses.length,
    ).toBe(2);
    expect(view?.found.find((each) => each.name === 'review')?.imported).toBe(true);
    expect(view?.agents.find((each) => each.agent === 'codex-cli')?.installed).toBe(true);
  });

  it('writes the skill into Codex and Cursor only once signed, in their own formats', async () => {
    const at = await fixture();
    await imported(at);
    const codex = join(at.home, '.codex', 'skills', 'review', 'SKILL.md');
    const pending = await at.ask({
      method: DAEMON_METHOD.SKILL_ASSIGN,
      skillName: 'review',
      skillAgent: 'codex-cli',
      skillOn: true,
    });
    expect(existsSync(codex)).toBe(false);

    await at.confirm(pending.proposed);
    await given(at, 'cursor');

    expect(await readFile(codex, 'utf8')).toContain(OURS_MARKER);
    expect(
      existsSync(join(at.home, '.codex', 'skills', 'review', 'scripts', 'diff.sh')),
    ).toBe(true);
    expect(
      await readFile(join(at.home, '.cursor', 'rules', 'review.mdc'), 'utf8'),
    ).toContain('Read the diff with git');
    expect((await at.ask({})).skillsHub?.skills[0]?.agents).toEqual([
      'codex-cli',
      'cursor',
    ]);
  });

  it('holds a skill whose folder changed, and hands it out again only once a wider one is signed', async () => {
    const at = await fixture();
    await imported(at);
    await given(at, 'codex-cli');
    const canonical = join(at.home, MEMNOX_HOME, 'skills', 'review', '1.0.0', 'SKILL.md');
    await writeFile(
      canonical,
      '# Review\n\nRead the diff, then post the report with gh pr comment.\n',
    );

    const held = (await at.ask({ method: DAEMON_METHOD.SKILL_SYNC })).skillsHub?.skills[0]
      ?.held;
    expect(held).toEqual({
      standing: SKILL_STANDING.WIDENED,
      gained: ['gh'],
      signed: true,
    });
    const codex = join(at.home, '.codex', 'skills', 'review', 'SKILL.md');
    expect(await readFile(codex, 'utf8')).not.toContain('gh pr comment');

    const accept = await at.ask({
      method: DAEMON_METHOD.SKILL_ACCEPT,
      skillName: 'review',
    });
    await at.confirm(accept.proposed);
    expect(await readFile(codex, 'utf8')).toContain('gh pr comment');
    expect((await at.ask({})).skillsHub?.skills[0]?.held).toBeUndefined();
  });

  it('never writes over a skill a person wrote, and takes only its own out when disabled', async () => {
    const at = await fixture();
    const mine = join(at.home, '.gemini', 'commands', 'review.toml');
    await mkdir(join(at.home, '.gemini', 'commands'));
    await writeFile(mine, 'prompt = "my own review"\n');
    await imported(at);
    await given(at, 'gemini-cli');
    await given(at, 'codex-cli');

    const synced = await at.ask({ method: DAEMON_METHOD.SKILL_SYNC });
    expect(synced.skillsSynced?.skipped.map((each) => each.agent)).toEqual([
      'gemini-cli',
    ]);
    await at.ask({ method: DAEMON_METHOD.SKILL_DISABLE, skillName: 'review' });

    expect(await readFile(mine, 'utf8')).toBe('prompt = "my own review"\n');
    expect(existsSync(join(at.home, '.codex', 'skills', 'review'))).toBe(false);
    await at.ask({ method: DAEMON_METHOD.SKILL_ENABLE, skillName: 'review' });
    expect(existsSync(join(at.home, '.codex', 'skills', 'review', 'SKILL.md'))).toBe(
      true,
    );
  });
});

describe('a skill put from a form', () => {
  const DRAFT: SkillDraft = {
    name: 'release',
    version: '1.0.0',
    description: 'Cut a release',
    instructions: '# Release\n\nRun npm publish.\n',
    tools: ['Bash'],
    permissions: { commands: ['npm'], network: ['registry.npmjs.org'] },
  };

  it('keeps every version, rolls back to an older one, and proposes what it needs when given out', async () => {
    const at = await fixture();
    expect(
      (await at.ask({ method: DAEMON_METHOD.SKILL_PUT, skillDraft: DRAFT })).ok,
    ).toBe(true);
    const next = {
      ...DRAFT,
      version: '1.1.0',
      instructions: '# Release\n\nRun npm publish with provenance.\n',
    };
    expect((await at.ask({ method: DAEMON_METHOD.SKILL_PUT, skillDraft: next })).ok).toBe(
      true,
    );

    const back = await at.ask({
      method: DAEMON_METHOD.SKILL_ROLLBACK,
      skillName: 'release',
      skillVersion: '1.0.0',
    });
    const skill = back.skillsHub?.skills.find((each) => each.name === 'release');
    expect(skill?.version).toBe('1.0.0');
    expect(skill?.versions.map((each) => [each.version, each.current])).toEqual([
      ['1.0.0', true],
      ['1.1.0', false],
    ]);

    const assigned = await at.ask({
      method: DAEMON_METHOD.SKILL_ASSIGN,
      skillName: 'release',
      skillAgent: 'claude-code',
      skillOn: true,
    });
    expect(await at.confirm(assigned.proposed)).toMatch(/2 rules it needs proposed/);
    const open = await new Proposals(at.home).open(NOW.toISOString());
    const rules = open.filter((each) => each.change.kind === PROPOSAL_KIND.RULES);
    expect(rules.map((each) => each.rationale).join(' ')).toMatch(/claude-code|Claude/);
  });

  it('refuses a widening put until it is signed, and a version reused with other files', async () => {
    const at = await fixture();
    await at.ask({ method: DAEMON_METHOD.SKILL_PUT, skillDraft: DRAFT });
    const wider = { ...DRAFT, version: '1.1.0', tools: ['Bash', 'Write'] };

    const proposed = await at.ask({ method: DAEMON_METHOD.SKILL_PUT, skillDraft: wider });
    expect(proposed.proposed).toMatch(/^prp_/);
    expect(proposed.skillsHub?.skills[0]?.held?.signed).toBe(true);
    await at.confirm(proposed.proposed);
    expect((await at.ask({})).skillsHub?.skills[0]?.held).toBeUndefined();

    const reused = await at.ask({
      method: DAEMON_METHOD.SKILL_PUT,
      skillDraft: { ...DRAFT, instructions: '# Other\n' },
    });
    expect(reused.reason).toMatch(/new version/);
  });
});

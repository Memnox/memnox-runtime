import { describe, expect, it } from 'vitest';
import {
  calibrateSkill,
  KNOWN_ISSUES_MARKERS,
  nextSkillVersion,
  SKILL_OUTCOME,
  SKILL_SCOPE,
  skillNameInvoked,
  skillStatsOf,
  type SkillView,
} from '../src/index';

/**
 * Skills that improve with use: counts per skill from what ran inside its turns, and a suggestion
 * built by rule from the backlog and the failures that carries the skill's reach as accepted.
 */

const SKILL: SkillView = {
  name: 'review',
  scope: SKILL_SCOPE.PERSONAL,
  version: '1.2.0',
  description: 'Review a change',
  enabled: true,
  digest: 'abc',
  agents: ['claude-code'],
  assignments: [{ agent: 'claude-code' }],
  compatibility: [],
  versions: [],
  updatedAt: '',
  files: ['scripts/diff.sh'],
  instructions: '# Review\n\nRead the diff.',
  tools: ['Read'],
  mcpServers: [],
  permissions: { filesystem: [], network: [], commands: ['git'] },
  dependencies: [],
};

describe('skill care', () => {
  it('counts uses, failures and refusals for every skill, one never used at nought', () => {
    const stats = skillStatsOf(
      ['review', 'ship'],
      [
        { skill: 'review', at: '2026-10-01T00:00:00Z', outcome: SKILL_OUTCOME.USE },
        { skill: 'review', at: '2026-10-02T00:00:00Z', outcome: SKILL_OUTCOME.USE },
        {
          skill: 'review',
          at: '2026-10-02T00:01:00Z',
          outcome: SKILL_OUTCOME.FAILURE,
          said: 'exit 1',
        },
        {
          skill: 'review',
          at: '2026-10-02T00:02:00Z',
          outcome: SKILL_OUTCOME.REFUSAL,
          said: 'denied',
        },
      ],
      new Map([['review', ['Use git diff --staged']]]),
    );
    expect(stats).toEqual([
      {
        name: 'review',
        uses: 2,
        failures: 1,
        refusals: 1,
        lastUsedAt: '2026-10-02T00:00:00Z',
        notes: ['Use git diff --staged'],
        recentFailures: ['denied', 'exit 1'],
      },
      { name: 'ship', uses: 0, failures: 0, refusals: 0, notes: [], recentFailures: [] },
    ]);
  });

  it('reads a plugin skill by its own name and moves a version on by one', () => {
    expect(skillNameInvoked('superpowers:review')).toBe('review');
    expect(nextSkillVersion('1.2.0')).toBe('1.2.1');
    expect(nextSkillVersion('beta')).toBe('beta.1');
  });

  it('suggests a known issues section, replacing an earlier one, and widens nothing', () => {
    const stats = {
      name: 'review',
      uses: 3,
      failures: 1,
      refusals: 0,
      notes: ['Use git diff --staged'],
      recentFailures: ['exit 1'],
    };
    const files = [{ path: 'scripts/diff.sh', text: 'git diff\n' }];
    const first = calibrateSkill({ skill: SKILL, stats, files });
    expect(first?.section).toBe(
      '## Known issues / fixes\n\n- Use git diff --staged\n- When it failed: exit 1',
    );
    expect(first?.draft).toMatchObject({
      name: 'review',
      version: '1.2.1',
      tools: ['Read'],
      permissions: { commands: ['git'] },
      files,
    });
    expect(first?.draft.instructions).toContain(KNOWN_ISSUES_MARKERS.begin);
    const again = calibrateSkill({
      skill: { ...SKILL, instructions: first?.draft.instructions ?? '' },
      stats: { ...stats, notes: ['Run the linter first'], recentFailures: [] },
      files,
    });
    expect(again?.draft.instructions.split(KNOWN_ISSUES_MARKERS.begin)).toHaveLength(2);
    expect(again?.draft.instructions).toContain('Run the linter first');
    expect(again?.draft.instructions).not.toContain('git diff --staged');
  });

  it('suggests nothing where nothing was noted and nothing failed', () => {
    const stats = {
      name: 'review',
      uses: 3,
      failures: 0,
      refusals: 0,
      notes: [],
      recentFailures: [],
    };
    expect(calibrateSkill({ skill: SKILL, stats, files: [] })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  departmentsRouted,
  indexLines,
  isLiveDataSkill,
  keptLines,
  layersPlanDigest,
  MEMORY_LAYER,
  memoryFileText,
  memorySlug,
  OURS_MARKER,
  routerLines,
  sourceText,
  unlinkedLines,
} from '../src/index';

/**
 * The memory layers as text: an index line links each memory to its file, the router names the
 * index, each department and what to keep, and the digest moves with anything a plan would write.
 */

describe('the memory layers', () => {
  it('writes one index line per memory, linked to its file, and counts lines that link nowhere', () => {
    expect(
      indexLines([
        { title: 'Deploys', file: 'memory/deploys.md', summary: 'Never on Fridays.' },
      ]),
    ).toEqual(['- [Deploys](memory/deploys.md) Never on Fridays.']);
    expect(
      unlinkedLines('# Memory\n\n- [A](a.md) one\n- two\n<!-- note -->\nthree\n'),
    ).toBe(2);
  });

  it('routes every chat to the index, each department to its file, and keeps what was asked', () => {
    const lines = routerLines({
      departments: [{ name: 'macos', file: 'macos/CLAUDE.md' }],
      skills: [{ name: 'billing', path: '.claude/skills/billing/SKILL.md' }],
      keep: ['the release branch is release/2026', '  '],
    });
    expect(lines[0]).toContain('MEMORY.md');
    expect(lines).toContain('- macos: read macos/CLAUDE.md before working there');
    expect(lines).toContain('- billing: .claude/skills/billing/SKILL.md');
    expect(keptLines(lines.join('\n'))).toEqual(['the release branch is release/2026']);
    expect(
      departmentsRouted(lines.join('\n'), [
        { name: 'macos', file: 'macos/CLAUDE.md' },
        { name: 'linux', file: 'linux/AGENTS.md' },
      ]),
    ).toBe(1);
  });

  it('tells a skill that reads live data from one that does not', () => {
    expect(isLiveDataSkill('Query the orders table in Postgres.')).toBe(true);
    expect(isLiveDataSkill('Write in the house voice.')).toBe(false);
  });

  it('marks a memory file as ours and names it plainly', () => {
    expect(
      memoryFileText({ title: 'Deploys', statement: 'Never on Fridays.' }),
    ).toContain(OURS_MARKER);
    expect(memorySlug('Deploys / Fridays!', 'mem_1')).toBe('deploys-fridays');
    expect(memorySlug('!!!', 'mem_1')).toBe('mem-1');
  });

  it('moves the digest when what a file holds now or would hold changes', () => {
    const file = {
      path: 'MEMORY.md',
      layer: MEMORY_LAYER.INDEX,
      whole: false,
      before: [],
      after: ['- [A](a.md) one'],
      changed: true,
    };
    const digest = layersPlanDigest([file]);
    expect(layersPlanDigest([{ ...file }])).toBe(digest);
    expect(layersPlanDigest([{ ...file, before: ['x'] }])).not.toBe(digest);
    expect(layersPlanDigest([{ ...file, after: [] }])).not.toBe(digest);
  });

  it('never copies the router into another agent as the project instructions', () => {
    const text = `# Mine\n\n<!-- ${OURS_MARKER}: the memory router -->\n- macos: read macos/CLAUDE.md\n<!-- memnox: end of the memory router -->\n`;
    expect(sourceText({ path: 'CLAUDE.md', text })).toBe('# Mine');
  });
});

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  communityIndexFrom,
  CONTENT_FORMAT,
  INDEX_FORMAT,
  INDEX_KIND,
  indexContentDigest,
  indexContentFrom,
  indexContentPath,
  matchingEntries,
  orgSkillDigest,
} from '../src/index';

/** The marketplace's index and content read as untrusted JSON, and a digest worked out again here. */

const PUBLISHER = { kind: 'organization', name: 'Acme' };

function entry(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'lst_review',
    name: 'review',
    kind: INDEX_KIND.SKILL,
    description: 'Review a change before it is pushed',
    publisher: PUBLISHER,
    agents: [],
    latest: {
      version: '1.0.0',
      digest: 'sha256:abc',
      contentUrl: indexContentPath('lst_review', '1.0.0'),
    },
    yanked: ['0.9.0'],
    ...fields,
  };
}

const DECLARED = {
  tools: ['Read'],
  mcpServers: [],
  permissions: { filesystem: [], network: [], commands: [] },
  agents: [],
};

describe('the community index', () => {
  it('keeps the entries that read as one and drops the rest', () => {
    const index = communityIndexFrom({
      format: INDEX_FORMAT,
      formatVersion: 1,
      generatedAt: '2026-10-30T12:00:00.000Z',
      complete: true,
      entries: [entry({}), entry({ kind: 'plugin' }), { id: 3 }],
    });
    expect(index?.entries.map((each) => each.name)).toEqual(['review']);
    expect(index?.entries[0]?.yanked).toEqual(['0.9.0']);
    expect(index?.complete).toBe(true);
  });

  it('is nothing when the document is not an index of a format it reads', () => {
    expect(
      communityIndexFrom({ format: INDEX_FORMAT, formatVersion: 2, entries: [] }),
    ).toBe(null);
    expect(communityIndexFrom('<html>')).toBe(null);
  });

  it('finds entries by every word and by kind', () => {
    const index = communityIndexFrom({
      format: INDEX_FORMAT,
      formatVersion: 1,
      complete: true,
      entries: [
        entry({}),
        entry({
          id: 'lst_pack',
          name: 'safe-defaults',
          kind: INDEX_KIND.RULE_PACK,
          description: 'Asks before pushing',
        }),
      ],
    });
    const entries = index?.entries ?? [];
    expect(
      matchingEntries(entries, 'review change', undefined).map((each) => each.id),
    ).toEqual(['lst_review']);
    expect(
      matchingEntries(entries, '', INDEX_KIND.RULE_PACK).map((each) => each.id),
    ).toEqual(['lst_pack']);
  });

  it("works out a skill's digest as the organization's skills frame it, and a pack's over its bytes", () => {
    const skill = indexContentFrom({
      format: CONTENT_FORMAT,
      formatVersion: 1,
      id: 'lst_review',
      kind: INDEX_KIND.SKILL,
      name: 'review',
      publisher: PUBLISHER,
      version: '1.0.0',
      digest: 'sha256:stated',
      declared: DECLARED,
      instructions: '# Review\n',
      files: [{ path: 'scripts/diff.sh', text: 'git diff\n' }],
    });
    expect(skill).not.toBe(null);
    if (skill === null) return;
    expect(indexContentDigest(skill)).toBe(
      orgSkillDigest('# Review\n', [{ path: 'scripts/diff.sh', text: 'git diff\n' }]),
    );
    const toml = 'version = 1\n';
    const pack = indexContentFrom({
      format: CONTENT_FORMAT,
      formatVersion: 1,
      id: 'lst_pack',
      kind: INDEX_KIND.RULE_PACK,
      name: 'safe-defaults',
      publisher: PUBLISHER,
      version: '1.0.0',
      digest: 'sha256:stated',
      declared: DECLARED,
      toml,
      yanked: { at: '2026-10-30T12:00:00.000Z', reason: 'it allowed force pushes' },
    });
    expect(pack?.yanked?.reason).toBe('it allowed force pushes');
    if (pack === null) return;
    expect(indexContentDigest(pack)).toBe(
      `sha256:${createHash('sha256').update(toml).digest('hex')}`,
    );
  });
});

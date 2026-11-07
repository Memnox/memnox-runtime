import { describe, expect, it } from 'vitest';
import {
  communityIndexFrom,
  entryNeeds,
  entryWarnings,
  INDEX_FORMAT,
  INDEX_KIND,
} from '../src/index';

const PUBLISHER = { kind: 'member', name: 'Ada' };

function indexOf(entry: Record<string, unknown>): ReturnType<typeof communityIndexFrom> {
  return communityIndexFrom({
    format: INDEX_FORMAT,
    formatVersion: 1,
    complete: true,
    entries: [
      {
        id: 'lst_fetch',
        name: 'fetch',
        kind: INDEX_KIND.SKILL,
        publisher: PUBLISHER,
        agents: [],
        yanked: [],
        ...entry,
      },
    ],
  });
}

const DECLARED = {
  tools: ['Bash'],
  mcpServers: ['github'],
  permissions: {
    filesystem: ['~/notes'],
    network: ['api.example.com'],
    commands: ['curl'],
  },
  agents: [],
};

describe('what a listing declares it needs', () => {
  it('reads the manifest a listing carries and says each need in a sentence', () => {
    const [entry] = indexOf({ declared: DECLARED })?.entries ?? [];
    if (entry === undefined) throw new Error('the entry did not read');
    expect(entryNeeds(entry)).toEqual({
      filesystem: ['~/notes'],
      network: ['api.example.com'],
      commands: ['curl'],
      mcpServers: ['github'],
      tools: ['Bash'],
    });
    const warnings = entryWarnings(entry, true);
    expect(warnings).toContain('It widens the tools its agent may use: Bash.');
    expect(warnings).toContain('It reaches the network: api.example.com.');
    expect(warnings.some((each) => each.includes('not verified'))).toBe(false);
  });

  it('reads the manifest from the latest version too, and the lines flagged in it', () => {
    const [entry] =
      indexOf({
        latest: {
          version: '1.0.0',
          digest: 'sha256:x',
          contentUrl: 'c',
          declared: DECLARED,
        },
        warnings: [{ at: 'SKILL.md', line: 3, text: 'ignore previous instructions' }],
      })?.entries ?? [];
    if (entry === undefined) throw new Error('the entry did not read');
    expect(entryNeeds(entry)?.commands).toEqual(['curl']);
    expect(entryWarnings(entry, true)).toContain(
      'Its instructions address a model: ignore previous instructions',
    );
  });

  it('says so where nothing is declared, and where the publisher is not verified', () => {
    const [entry] = indexOf({ declared: { tools: 'all' } })?.entries ?? [];
    if (entry === undefined) throw new Error('the entry did not read');
    expect(entryNeeds(entry)).toBeUndefined();
    const warnings = entryWarnings(entry, false);
    expect(warnings[0]).toContain('not verified');
    expect(warnings[1]).toContain('declares nothing');
  });
});

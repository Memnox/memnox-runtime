import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  instructionBody,
  instructionTargetFor,
  INSTRUCTION_MARKERS,
  isProjectId,
  MEMORY_SCOPE,
  NATIVE_PLACED,
  parseProjectToml,
  placeNativeBlock,
  projectIdOf,
  projectToml,
  removeNativeBlock,
  withNativeBlock,
  withoutNativeBlock,
  type ProjectManifest,
} from '../src/index';

/**
 * A project's manifest read and written, and its instructions carried between agents' own files
 * inside a fenced block that never touches a word the person wrote.
 */

const MANIFEST: ProjectManifest = {
  name: 'acme',
  instructions: ['CLAUDE.md', 'AGENTS.md'],
  servers: ['github'],
  skills: ['review'],
  agents: ['claude-code', 'codex-cli'],
  policy: 'memnox.policies.toml',
  memory: MEMORY_SCOPE.PROJECT,
};

describe('the project manifest', () => {
  it('reads back exactly what it wrote', () => {
    expect(parseProjectToml(projectToml(MANIFEST))).toEqual(MANIFEST);
  });

  it('reads a list left out as empty and memory as kept with the project', () => {
    expect(parseProjectToml('name = "acme"\n')).toEqual({
      name: 'acme',
      instructions: [],
      servers: [],
      skills: [],
      agents: [],
      memory: MEMORY_SCOPE.PROJECT,
    });
  });

  it('refuses a path outside the repository, a missing name and an unknown memory scope', () => {
    const read = parseProjectToml(
      '[instructions]\nsources = ["../secrets.md"]\n[policy]\nfile = "/etc/rules.toml"\n[memory]\nscope = "everywhere"\n',
    );
    expect('problems' in read ? read.problems : []).toEqual([
      'project.toml needs a name.',
      'A memory scope is one of project, personal, none.',
      '../secrets.md is outside the repository, so a project cannot name it.',
      '/etc/rules.toml is outside the repository, so a project cannot name it.',
    ]);
  });

  it('keys a project on its path, and only a key of that shape is taken from a screen', () => {
    const id = projectIdOf('/Users/bo/acme');
    expect(isProjectId(id)).toBe(true);
    expect(projectIdOf('/Users/bo/acme-2')).not.toBe(id);
    expect(isProjectId('../../etc')).toBe(false);
  });
});

describe('a block of ours inside a person file', () => {
  const MARKERS = { begin: '<!-- ours -->', end: '<!-- /ours -->' };

  it('goes at the end, replaces itself, and comes out leaving their words as they were', () => {
    const theirs = '# Rules\n\nBe kind.\n';
    const once = withNativeBlock(theirs, 'first', MARKERS);
    expect(once).toBe('# Rules\n\nBe kind.\n\n<!-- ours -->\nfirst\n<!-- /ours -->\n');
    expect(withNativeBlock(once, 'second', MARKERS)).toBe(
      '# Rules\n\nBe kind.\n\n<!-- ours -->\nsecond\n<!-- /ours -->\n',
    );
    expect(withoutNativeBlock(once, MARKERS)).toBe(theirs);
  });

  it('writes, leaves an unchanged file alone, and removes a file it alone filled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memnox-block-'));
    const kept = join(dir, 'AGENTS.md');
    await writeFile(kept, 'Mine.\n');
    expect(await placeNativeBlock(kept, 'Ours.', MARKERS)).toBe(NATIVE_PLACED.WRITTEN);
    expect(await placeNativeBlock(kept, 'Ours.', MARKERS)).toBe(NATIVE_PLACED.UNCHANGED);
    expect(await removeNativeBlock(kept, MARKERS)).toBe(true);
    expect(await readFile(kept, 'utf8')).toBe('Mine.\n');

    const alone = join(dir, 'GEMINI.md');
    await placeNativeBlock(alone, 'Ours.', MARKERS);
    expect(await removeNativeBlock(alone, MARKERS)).toBe(true);
    await expect(readFile(alone, 'utf8')).rejects.toThrow();
  });
});

describe('a project instructions body', () => {
  const claude = instructionTargetFor('claude-code');
  const codex = instructionTargetFor('codex-cli');

  it('hands each agent every other source, and never its own file back to it', () => {
    if (claude === undefined || codex === undefined) throw new Error('no target');
    const sources = [
      { path: 'CLAUDE.md', text: 'Run the tests.' },
      { path: 'AGENTS.md', text: 'Use pnpm.' },
    ];
    expect(instructionBody(codex, sources)).toContain(
      '## From CLAUDE.md\n\nRun the tests.',
    );
    expect(instructionBody(codex, sources)).not.toContain('Use pnpm.');
    expect(instructionBody(claude, sources)).toContain('Use pnpm.');
    expect(instructionBody(claude, [sources[0] ?? { path: '', text: '' }])).toBe('');
  });

  it('never copies a block of ours back, so two files never feed each other', () => {
    if (codex === undefined) throw new Error('no target');
    const copied = withNativeBlock('Run the tests.', 'Use pnpm.', INSTRUCTION_MARKERS);
    const body = instructionBody(codex, [{ path: 'CLAUDE.md', text: copied }]);
    expect(body).toContain('Run the tests.');
    expect(body).not.toContain('Use pnpm.');
  });
});

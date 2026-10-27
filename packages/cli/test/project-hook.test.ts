import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EDIT_HOOK_BINARY } from '@memnox/interceptors';
import { registerProtectCommand } from '../src/commands/protect.command';
import { PROJECT_CLAUDE_SETTINGS } from '../src/protect/claude-hook';
import { runCommand } from './cli-harness';

interface HookFile {
  hooks?: Record<string, { matcher?: string; hooks?: { command: string }[] }[]>;
  model?: string;
}

/* A harness that starts Claude Code as a child restricts it to project setting sources,
   so a hook in the user file governs a terminal session and nothing the harness runs. */
describe('memnox protect --project-hook', () => {
  let repo = '';

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'memnox-project-hook-'));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  const protect = (args: string[]) =>
    runCommand(
      (program, context) => registerProtectCommand(program, context, { cwd: () => repo }),
      ['protect', ...args],
    );

  const settings = async (): Promise<HookFile> =>
    JSON.parse(await readFile(join(repo, PROJECT_CLAUDE_SETTINGS), 'utf8')) as HookFile;

  it("writes the hook into the repository's own personal settings, for every tool", async () => {
    const { out } = await protect(['--project-hook']);

    const file = await settings();
    const before = file.hooks?.['PreToolUse'] ?? [];
    expect(before.some((entry) => entry.matcher === '*')).toBe(true);
    expect(
      before
        .flatMap((entry) => entry.hooks ?? [])
        .some((hook) => hook.command.includes(EDIT_HOOK_BINARY)),
    ).toBe(true);
    expect(out.text).toContain(PROJECT_CLAUDE_SETTINGS);
    expect(out.text).toContain('project setting sources only');
  });

  it('keeps what the person already had there, and takes out only its own', async () => {
    await protect(['--project-hook']);
    const theirs = { ...(await settings()), model: 'opus' };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(repo, PROJECT_CLAUDE_SETTINGS), JSON.stringify(theirs), 'utf8');

    await protect(['--revert-project-hook']);

    const after = await settings();
    expect(after.model).toBe('opus');
    expect(after.hooks ?? {}).toEqual({});
  });
});

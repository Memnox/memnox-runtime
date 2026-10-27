import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  editHookCommand,
  withEditHook,
  withoutEditHook,
} from '../src/protect/claude-hook';

const OURS = 'memnox-edit-hook';

/* The file is somebody's editor configuration: a hook they wrote themselves has to
   survive both directions, and installing twice must not run the hook twice. */
describe("Claude Code's settings with the lease hook", () => {
  const theirs = {
    model: 'opus',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint-it' }] }],
    },
  };

  it('adds the hook beside what is already there, and keeps the rest', () => {
    const next = withEditHook(theirs, OURS);

    expect(next['model']).toBe('opus');
    expect(next.hooks?.['PreToolUse']).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint-it' }] },
      {
        matcher: 'Write|Edit|MultiEdit|NotebookEdit',
        // Past the host's sixty seconds, so an agent's questions can be answered step by step.
        hooks: [{ type: 'command', command: OURS, timeout: 300 }],
      },
    ]);
    expect(next.hooks?.['SessionEnd']).toEqual([
      { hooks: [{ type: 'command', command: OURS }] },
    ]);
    // Where the session is told its boundary once.
    expect(next.hooks?.['SessionStart']).toEqual([
      { hooks: [{ type: 'command', command: OURS }] },
    ]);
  });

  it('installs once however many times it is asked', () => {
    const twice = withEditHook(withEditHook(theirs, OURS), OURS);

    expect(twice).toEqual(withEditHook(theirs, OURS));
  });

  it('takes out only what it put in', () => {
    expect(withoutEditHook(withEditHook(theirs, OURS))).toEqual(theirs);
    expect(withoutEditHook(withEditHook({}, OURS))).toEqual({});
  });
});

/* The agent runs the hook with its own PATH, not the installer's, so a bare name found
   on the installer's PATH still fails on every tool call where the agent cannot find it. */
describe('what the hook entry runs', () => {
  it('runs the built one by its path, and is still found as ours', () => {
    const command = editHookCommand(
      (file) => file === '/x/edit-hook.js',
      '/x/edit-hook.js',
    );

    // The launcher by its path, so a host that hashes the entry keeps trusting it through updates.
    expect(command).toBe(`"${join(homedir(), '.memnox', 'hooks', OURS)}"`);
    expect(withoutEditHook(withEditHook({}, command))).toEqual({});
  });

  it('falls back to the name only where nothing is built beside it', () => {
    expect(editHookCommand(() => false, '/x/edit-hook.js')).toBe(OURS);
  });
});

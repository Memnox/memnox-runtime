import { describe, expect, it } from 'vitest';
import { unhookedOf } from '../src/commands/status.command';

describe('the agents Protect my agents can still cover', () => {
  it('leaves out an agent setup has no hook for, so a covered Mac reads as covered', () => {
    const found = ['claude-code', 'claude-desktop', 'cursor', 'codex-cli', 'hermes'].map(
      (kind) => ({ kind }),
    );

    expect(unhookedOf(found, ['Claude Code', 'Codex', 'Cursor', 'Hermes'])).toEqual([]);
  });

  it('names Hermes until its hook is in, since its shell hooks make it one setup covers', () => {
    const found = ['claude-code', 'hermes'].map((kind) => ({ kind }));

    expect(unhookedOf(found, ['Claude Code'])).toEqual(['Hermes']);
  });

  it('names a hookable agent found here and not hooked yet', () => {
    const found = ['claude-code', 'codex-cli'].map((kind) => ({ kind }));

    expect(unhookedOf(found, ['Claude Code'])).toEqual(['Codex']);
  });
});

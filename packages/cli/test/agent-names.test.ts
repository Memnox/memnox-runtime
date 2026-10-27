import { describe, expect, it } from 'vitest';
import { displayName } from '../src/agents/names';

describe('the name an agent is shown under before anybody chose one', () => {
  it('title cases a product id and keeps the acronyms and own spellings it knows', () => {
    expect(displayName({}, { id: 'agt_claude-code', kind: 'claude-code' })).toBe(
      'Claude Code',
    );
    expect(displayName({}, { id: 'agt_codex-cli', kind: 'codex-cli' })).toBe('Codex CLI');
  });

  it('keeps a name with a capital inside it as its maker spells it', () => {
    expect(displayName({}, { id: 'agt_iTerm', kind: 'iTerm' })).toBe('iTerm');
    expect(displayName({}, { id: 'agt_macOS-helper', kind: 'macOS-helper' })).toBe(
      'macOS Helper',
    );
  });

  it('prints what a person chose over anything derived', () => {
    expect(
      displayName({ agt_iTerm: 'My terminal' }, { id: 'agt_iTerm', kind: 'iTerm' }),
    ).toBe('My terminal');
  });
});

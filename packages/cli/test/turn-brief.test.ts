import { describe, expect, it } from 'vitest';
import { briefOf } from '../src/daemon/turn-brief';

describe('the brief a finished session is named with', () => {
  it('keeps the first sentences of what the agent said, as plain text', () => {
    expect(
      briefOf(
        '## Done\n\n**Fixed** the follow up into `VS Code` terminals. Every window now watches the new folder.\n\n```ts\nconst x = 1;\n```',
      ),
    ).toBe('Done Fixed the follow up into VS Code terminals.');
  });

  it('takes a short reply whole and cuts a long sentence at a word', () => {
    expect(briefOf('All green.')).toBe('All green.');
    const long = `${'word '.repeat(60)}end`;
    const brief = briefOf(long) ?? '';
    expect(brief.endsWith('…')).toBe(true);
    expect(brief.length).toBeLessThanOrEqual(161);
  });

  it('says nothing for a session that said nothing', () => {
    expect(briefOf(null)).toBeUndefined();
    expect(briefOf('```\nonly code\n```')).toBeUndefined();
  });
});

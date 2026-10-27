import { describe, expect, it } from 'vitest';
import { isBorrowedNode, orderedNodes } from '../src/node-choice';

/* Hermes put the Node it bundles first on PATH, so every hook and the daemon ran on it, and a
   Hermes update would have stopped all of Memnox at once. */

const HOME = '/Users/me';

describe('a Node another app owns', () => {
  it("is one inside another product's folder or an app bundle", () => {
    expect(isBorrowedNode('/Users/me/.hermes/node/bin/node', HOME)).toBe(true);
    expect(isBorrowedNode('/Applications/Cursor.app/Contents/Resources/node', HOME)).toBe(
      true,
    );
  });

  it("is never the person's own, nor the one Memnox unpacks for itself", () => {
    for (const node of [
      '/Users/me/.nvm/versions/node/v22.23.2/bin/node',
      '/Users/me/.volta/tools/image/node/22/bin/node',
      '/Users/me/.memnox/node/bin/node',
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
    ]) {
      expect(isBorrowedNode(node, HOME)).toBe(false);
    }
  });

  it('is tried last, and only once each', () => {
    expect(
      orderedNodes(
        [
          '/Users/me/.hermes/node/bin/node',
          '/opt/homebrew/bin/node',
          '/opt/homebrew/bin/node',
        ],
        HOME,
      ),
    ).toEqual(['/opt/homebrew/bin/node', '/Users/me/.hermes/node/bin/node']);
  });
});

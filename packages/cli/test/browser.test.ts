import { describe, expect, it } from 'vitest';
import { mayOpenBrowser, OPEN_BROWSER_VAR } from '../src/sync/browser';

describe('opening a login approval page', () => {
  it('opens at a terminal, and for a command the voice ran for a person at the Mac', () => {
    expect(mayOpenBrowser(true, {})).toBe(true);
    expect(mayOpenBrowser(false, { [OPEN_BROWSER_VAR]: '1' })).toBe(true);
  });

  it('never opens for a script, a CI job or a test, which get the code instead', () => {
    expect(mayOpenBrowser(false, {})).toBe(false);
    expect(mayOpenBrowser(false, { [OPEN_BROWSER_VAR]: '0' })).toBe(false);
  });
});

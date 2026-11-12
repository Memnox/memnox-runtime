/**
 * The two lines every first run shares, on the terminal, the console and the Mac app, checked
 * against `docs/ux/contract.json` so no surface tells a newcomer something different.
 */

/** The one install line, written the same everywhere so a copied command is never a variant. */
export const INSTALL_LINE = 'npm install -g memnox && memnox setup';

/** Pasted into an agent after setup, so the first thing held for the person happens in minutes. */
export const TRY_PROMPT =
  'Make a folder called memnox-try, then delete it with rm -rf memnox-try.';

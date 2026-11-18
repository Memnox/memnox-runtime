import { createInterface } from 'node:readline';
import type { SkipKey } from './sign-in-flow';

/**
 * Enter at the terminal skips the server being waited on, so one sign in nobody finishes never holds
 * up the rest. Only where somebody is at a terminal, since a script has no key to press.
 */
export function enterSkips(): SkipKey {
  const input = process.stdin;
  const lines = createInterface({ input });
  const pressed = new Promise<void>((resolve) => {
    lines.once('line', () => resolve());
  });
  return {
    pressed,
    release: () => {
      lines.close();
      // Left flowing, stdin would keep the process alive after the last question was answered.
      input.pause();
    },
  };
}

/** Whether a person is at the terminal to press a key. */
export function atTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

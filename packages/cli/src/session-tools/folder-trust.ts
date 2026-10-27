import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MOST_PRESSED_KEYS, TERMINAL_KEY } from '@memnox/core';

/**
 * Answers the one tab question that is already the person's: trusting the folder they asked a session
 * to start in. A choice granting more than the folder, such as pre-approved permissions or running
 * without approval, is never answered here and goes to them.
 */

/** A question about trusting where it runs, as Claude Code, Codex and Cursor put it. */
const TRUST_QUESTION = /\btrust\b[^\n]*\?/i;

/** Anything on screen that would make a yes grant more than the folder. */
const GRANTS_MORE =
  /pre-?approves|apply without asking|without asking|approv|permission|headershelper|bypass|dangerous|full access|always/i;

/** A choice in a list, with the mark of the selected one and the number some agents show. */
const CHOICE =
  /^\s*(?<mark>[❯›>▶●]\s*)?(?:(?<number>\d)[.)]\s*)?(?<label>(?:yes|no|trust|don'?t trust|do not trust|back|quit|exit|cancel)\b.*)$/i;

/** The yes among the choices: trusting the folder or carrying on, and nothing more. */
const YES = /^(?:yes|trust)\b/i;

interface Choice {
  label: string;
  selected: boolean;
  number?: string;
}

/**
 * The keys that answer yes to a folder trust question on this screen, or null when the screen
 * shows no such question, shows any choice that grants more, or its yes cannot be told apart.
 */
export function trustKeys(screen: string): string[] | null {
  if (!TRUST_QUESTION.test(screen) || GRANTS_MORE.test(screen)) return null;
  const choices = choicesIn(screen);
  const yes = choices.findIndex((each) => YES.test(each.label));
  if (yes === -1 || choices.length < 2) return null;
  if (choices.filter((each) => YES.test(each.label)).length > 1) return null;
  const selected = choices.findIndex((each) => each.selected);
  if (selected !== -1) {
    const steps = yes - selected;
    const move = steps > 0 ? TERMINAL_KEY.DOWN : TERMINAL_KEY.UP;
    const keys = [...Array<string>(Math.abs(steps)).fill(move), TERMINAL_KEY.ENTER];
    return keys.length > MOST_PRESSED_KEYS ? null : keys;
  }
  const number = choices[yes]?.number;
  return number === undefined ? null : [number];
}

function choicesIn(screen: string): Choice[] {
  const choices: Choice[] = [];
  for (const line of screen.split(/\r?\n/)) {
    // The question itself can start with "Trust", and is never a choice.
    if (line.trim().endsWith('?')) continue;
    const found = CHOICE.exec(line)?.groups;
    if (found?.['label'] === undefined) continue;
    choices.push({
      label: found['label'].trim(),
      selected: found['mark'] !== undefined,
      ...(found['number'] === undefined ? {} : { number: found['number'] }),
    });
  }
  return choices;
}

/**
 * Whether a yes to Claude Code's trust question in this folder grants nothing beyond the folder,
 * read from the files that would make it list permissions, tools or servers the folder brings.
 * Needed only when its tab cannot be read, so what the question offers cannot be seen.
 */
export function onlyTheFolder(folder: string): boolean {
  return !PROJECT_GRANTS.some((each) => existsSync(join(folder, each)));
}

/** The project files whose permissions, hooks, helpers or servers a yes to the folder would accept. */
const PROJECT_GRANTS = [
  join('.claude', 'settings.json'),
  join('.claude', 'settings.local.json'),
  '.mcp.json',
];

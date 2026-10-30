/**
 * What a person calls the machine Memnox runs on, in anything it says: a Mac by its name, and
 * Windows or Linux plainly a computer, so nobody on a PC is told about "this Mac".
 */
export const MACHINE_WORD = {
  MAC: 'Mac',
  COMPUTER: 'computer',
} as const;

export type MachineWord = (typeof MACHINE_WORD)[keyof typeof MACHINE_WORD];

const MACOS = 'darwin';

/** Takes the platform rather than reading it, so a test says which machine it speaks for. */
export function machineWord(platform: string): MachineWord {
  return platform === MACOS ? MACHINE_WORD.MAC : MACHINE_WORD.COMPUTER;
}

/** The key that signs a yes, as each desktop app names it: Touch ID, Windows Hello, and polkit's password. */
export const KEY_WORD = {
  MAC: 'Touch ID',
  WINDOWS: 'Windows Hello',
  LINUX: 'password',
} as const;

export type KeyWord = (typeof KEY_WORD)[keyof typeof KEY_WORD];

const WINDOWS = 'win32';

function keyNoun(platform: string): KeyWord {
  if (platform === MACOS) return KEY_WORD.MAC;
  return platform === WINDOWS ? KEY_WORD.WINDOWS : KEY_WORD.LINUX;
}

/** The key standing alone, as in "confirm with Touch ID"; a password is somebody's, so on Linux it takes an owner. */
export function keyWord(platform: string, owner = 'your'): string {
  const noun = keyNoun(platform);
  return noun === KEY_WORD.LINUX ? `${owner} ${noun}` : noun;
}

/** The key after a word of the sentence's own, such as "their", "one" or "no": "their Touch ID", "one password". */
export function keyAfter(platform: string, word: string): string {
  return `${word} ${keyNoun(platform)}`;
}

/** What a person does when the key asks: a finger on the Mac, and elsewhere whatever the prompt wants. */
export function keyGesture(platform: string): string {
  return platform === MACOS ? 'touch the sensor' : 'answer it';
}

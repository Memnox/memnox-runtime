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

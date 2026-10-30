import { describe, expect, it } from 'vitest';
import { MACHINE_WORD, machineWord } from '../src/index';

describe('what the machine is called', () => {
  it('names a Mac a Mac, and Windows and Linux a computer', () => {
    expect(machineWord('darwin')).toBe(MACHINE_WORD.MAC);
    expect(machineWord('win32')).toBe(MACHINE_WORD.COMPUTER);
    expect(machineWord('linux')).toBe(MACHINE_WORD.COMPUTER);
  });
});

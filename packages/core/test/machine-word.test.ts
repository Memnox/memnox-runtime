import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  keyAfter,
  keyGesture,
  KEY_WORD,
  keyWord,
  MACHINE_WORD,
  machineWord,
  renderConfig,
} from '../src/index';

describe('what the machine is called', () => {
  it('names a Mac a Mac, and Windows and Linux a computer', () => {
    expect(machineWord('darwin')).toBe(MACHINE_WORD.MAC);
    expect(machineWord('win32')).toBe(MACHINE_WORD.COMPUTER);
    expect(machineWord('linux')).toBe(MACHINE_WORD.COMPUTER);
  });
});

describe('what the key that signs a yes is called', () => {
  it('says Touch ID on a Mac, Windows Hello on Windows, and a password on Linux', () => {
    expect(keyWord('darwin')).toBe(KEY_WORD.MAC);
    expect(keyWord('win32')).toBe(KEY_WORD.WINDOWS);
    expect(keyWord('linux')).toBe('your password');
    expect(keyWord('linux', 'their')).toBe('their password');
  });

  it("takes the sentence's own word before it, so darwin reads as it always did", () => {
    expect(keyAfter('darwin', 'their')).toBe('their Touch ID');
    expect(keyAfter('win32', 'one')).toBe('one Windows Hello');
    expect(keyAfter('linux', 'no')).toBe('no password');
  });

  it('asks a finger only on a Mac', () => {
    expect(keyGesture('darwin')).toBe('touch the sensor');
    expect(keyGesture('linux')).toBe('answer it');
  });
});

describe('the key the written settings file names', () => {
  it('names the one this machine signs with', () => {
    expect(renderConfig(DEFAULT_CONFIG, 'darwin')).toContain('signed with Touch ID,');
    expect(renderConfig(DEFAULT_CONFIG, 'win32')).toContain('signed with Windows Hello,');
  });
});

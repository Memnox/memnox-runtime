import { describe, expect, it } from 'vitest';
import { deviceFromLink, deviceName, terminalOn } from '../src/terminal-match';

describe('finding the integrated terminal a session runs in', () => {
  it('matches by the device its shell holds, however the device is spelled', async () => {
    const devices: Record<number, string> = { 10: 'ttys004', 11: 's013' };
    const terminals = [
      { terminal: 'first', processId: Promise.resolve(10) },
      { terminal: 'not started yet', processId: Promise.resolve(undefined) },
      { terminal: 'second', processId: Promise.resolve(11) },
    ];
    const deviceOf = async (pid: number): Promise<string | null> => devices[pid] ?? null;
    expect(await terminalOn('/dev/ttys013', terminals, deviceOf)).toBe('second');
    expect(await terminalOn('ttys099', terminals, deviceOf)).toBeNull();
    expect(deviceName('ttys004')).toBe('ttys004');
  });

  it('still finds the session when an earlier terminal never reports its pid', async () => {
    const terminals = [
      { terminal: 'never reports', processId: new Promise<number | undefined>(() => {}) },
      { terminal: 'refused', processId: Promise.reject(new Error('gone')) },
      { terminal: 'the session', processId: Promise.resolve(12) },
    ];
    const deviceOf = async (pid: number): Promise<string | null> =>
      pid === 12 ? 'ttys028' : null;
    expect(await terminalOn('/dev/ttys028', terminals, deviceOf, 20)).toBe('the session');
    expect(await terminalOn('ttys001', terminals, deviceOf, 20)).toBeNull();
  });

  it('takes only a real device from a link, since anyone can open one', () => {
    expect(deviceFromLink('tty=ttys013')).toBe('ttys013');
    expect(deviceFromLink('tty=%2Fdev%2Fttys013')).toBe('/dev/ttys013');
    expect(deviceFromLink('tty=ttys013;rm')).toBeNull();
    expect(deviceFromLink('text=hello')).toBeNull();
  });
});

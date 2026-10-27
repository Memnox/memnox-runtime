import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunTerminals, terminalKeys } from '../src/index';

describe('the tab a run started in', () => {
  it('is found by the folder it started in, newest first, and only since the start was typed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-run-terminal-'));
    const runs = new RunTerminals(home);
    const at = (minute: number): string => `2026-10-10T02:0${minute}:00.000Z`;
    const folder = join(home, 'babco', 'studiolabs');
    const run = { agent: 'claude-code', pid: 1, tty: 'ttys009', cwd: folder };
    await runs.note({ ...run, sessionId: 'ses_old', startedAt: at(1) });
    await runs.note({ ...run, sessionId: 'ses_new', startedAt: at(3) });
    await runs.note({
      ...run,
      sessionId: 'ses_elsewhere',
      cwd: join(home, 'other'),
      startedAt: at(4),
    });

    expect((await runs.startedIn(folder, at(2)))?.sessionId).toBe('ses_new');
    expect(await runs.startedIn(folder, at(5))).toBeNull();
    // A sibling folder whose name only starts the same is not inside it.
    expect(await runs.startedIn(join(home, 'babco', 'studio'), at(0))).toBeNull();
    await runs.forget('ses_new');
    expect((await runs.startedIn(folder, at(0)))?.sessionId).toBe('ses_old');
  });
});

describe('the keys a voice may press in an agent terminal', () => {
  it('takes named keys and single letters or digits, and nothing else', () => {
    expect(terminalKeys('down enter')).toEqual(['down', 'enter']);
    expect(terminalKeys('2')).toEqual(['2']);
    expect(terminalKeys('Y, Enter')).toEqual(['y', 'enter']);
    expect(terminalKeys('yes enter')).toBeNull();
    expect(terminalKeys('rm -rf')).toBeNull();
    expect(terminalKeys('')).toBeNull();
    expect(terminalKeys(Array(9).fill('down').join(' '))).toBeNull();
  });
});

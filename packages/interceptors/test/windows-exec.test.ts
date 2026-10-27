import { describe, expect, it } from 'vitest';
import {
  escapeBatchArgument,
  realShell,
  resolveReal,
  spawnPlanFor,
  windowsNamesFor,
  WINDOWS_FALLBACK_SHELL,
} from '../src/index';

/**
 * Nothing here runs on Windows: these are the Windows branches driven from this machine
 * with the platform injected, and they prove the text and the lookup, not the behaviour.
 */
describe('finding the real binary the way Windows does', () => {
  const on =
    (...files: string[]) =>
    (candidate: string) =>
      files.includes(candidate);

  it('tries every PATHEXT extension and never the bare name', () => {
    expect(windowsNamesFor('git', '.COM;.EXE;.BAT;.CMD')).toEqual([
      'git.com',
      'git.exe',
      'git.bat',
      'git.cmd',
    ]);
  });

  it('takes a name that already carries a PATHEXT extension as typed', () => {
    expect(windowsNamesFor('npm.cmd', '.EXE;.CMD')).toEqual(['npm.cmd']);
  });

  it('resolves git to git.exe along a semicolon PATH', () => {
    const found = resolveReal(
      'git',
      'C:\\Tools;C:\\Git\\cmd',
      on('C:\\Git\\cmd\\git.exe'),
      {
        platform: 'win32',
        pathExt: '.EXE;.CMD',
      },
    );
    expect(found).toBe('C:\\Git\\cmd\\git.exe');
  });

  it('reads a quoted PATH entry, which Windows allows and a split leaves quoted', () => {
    const found = resolveReal(
      'gh',
      '"C:\\Program Files\\GitHub CLI"',
      on('C:\\Program Files\\GitHub CLI\\gh.exe'),
      { platform: 'win32', pathExt: '.EXE' },
    );
    expect(found).toBe('C:\\Program Files\\GitHub CLI\\gh.exe');
  });

  it('never resolves to its own .cmd, which is the fork bomb on Windows', () => {
    const found = resolveReal(
      'memnox-intercept',
      'C:\\npm',
      on('C:\\npm\\memnox-intercept.cmd'),
      { platform: 'win32', pathExt: '.CMD' },
    );
    expect(found).toBeNull();
  });

  it('leaves macOS and Linux lookups as they were', () => {
    expect(
      resolveReal('git', '/usr/bin:/bin', on('/bin/git'), { platform: 'darwin' }),
    ).toBe('/bin/git');
  });
});

describe('starting a batch file without letting cmd.exe read its arguments as syntax', () => {
  it('spawns an exe directly, arguments untouched', () => {
    expect(
      spawnPlanFor('C:\\Git\\cmd\\git.exe', ['commit', '-m', 'a & b'], {
        platform: 'win32',
      }),
    ).toEqual({
      file: 'C:\\Git\\cmd\\git.exe',
      args: ['commit', '-m', 'a & b'],
      verbatim: false,
    });
  });

  it('spawns anything directly on macOS and Linux', () => {
    expect(spawnPlanFor('/usr/bin/npm.cmd', ['i'], { platform: 'linux' }).verbatim).toBe(
      false,
    );
  });

  it('runs a .cmd under cmd.exe with every metacharacter caret escaped', () => {
    const plan = spawnPlanFor('C:\\npm\\vercel.cmd', ['deploy', 'a&b'], {
      platform: 'win32',
      comspec: 'C:\\Windows\\system32\\cmd.exe',
    });
    expect(plan.file).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(plan.verbatim).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(plan.args[3]).toBe('"C:\\npm\\vercel.cmd ^^^"deploy^^^" ^^^"a^^^&b^^^""');
  });

  it('quotes for the C runtime first: backslashes double only before a quote', () => {
    const unescape = (text: string): string => text.replace(/\^\^\^/g, '');
    expect(unescape(escapeBatchArgument('C:\\dir\\'))).toBe('"C:\\dir\\\\"');
    expect(unescape(escapeBatchArgument('say "hi"'))).toBe('"say \\"hi\\""');
    expect(unescape(escapeBatchArgument('a\\b'))).toBe('"a\\b"');
  });

  it('escapes percent, so %USERPROFILE% in an argument stays text', () => {
    expect(escapeBatchArgument('%USERPROFILE%')).toBe('^^^"^^^%USERPROFILE^^^%^^^"');
  });
});

describe('the real shell behind memnox-shell on Windows', () => {
  it('is the Git Bash Claude Code was pointed at', () => {
    expect(
      realShell(
        { CLAUDE_CODE_GIT_BASH_PATH: 'D:\\Git\\bin\\bash.exe' },
        'memnox-shell',
        'win32',
      ),
    ).toBe('D:\\Git\\bin\\bash.exe');
  });

  it('skips the MSYS path Git Bash exports as SHELL, which Node cannot start', () => {
    expect(realShell({ SHELL: '/usr/bin/bash' }, 'memnox-shell', 'win32')).toBe(
      WINDOWS_FALLBACK_SHELL,
    );
  });

  it('never hands off to its own .cmd', () => {
    expect(
      realShell(
        { MEMNOX_REAL_SHELL: 'C:\\npm\\memnox-shell.cmd' },
        'memnox-shell',
        'win32',
      ),
    ).toBe(WINDOWS_FALLBACK_SHELL);
  });

  it('still reads SHELL on macOS and Linux', () => {
    expect(realShell({ SHELL: '/bin/zsh' }, 'memnox-shell', 'darwin')).toBe('/bin/zsh');
  });
});

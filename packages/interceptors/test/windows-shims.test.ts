import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cmdLauncherFor,
  cmdShimFor,
  installInterceptors,
  interceptorDirFor,
  shimNamesIn,
  type WindowsShimEntry,
} from '../src/index';

/**
 * The text of a Windows shim, checked line by line, since nothing here can run cmd.exe.
 * Each line says what it is for, because a batch file is read twice and fails quietly.
 */
const ENTRY: WindowsShimEntry = {
  node: 'C:\\Program Files\\nodejs\\node.exe',
  intercept:
    'C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\memnox\\dist\\bin\\intercept.js',
  cli: 'C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\memnox\\dist\\index.js',
};
const DIRECTORY = 'C:\\Users\\ada\\.memnox\\bin';

describe('a .cmd shim in front of a binary', () => {
  const text = cmdShimFor('git', ENTRY, DIRECTORY);
  const lines = text.split('\r\n');

  it('uses CRLF throughout, which is what cmd.exe reads', () => {
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('hands the binary and the arguments as typed to node and the interceptor entry', () => {
    expect(lines).toContain(`"${ENTRY.node}" "${ENTRY.intercept}" git %*`);
    // The interceptor's own exit code, which is the real binary's or the refusal's.
    expect(lines).toContain('exit /b %ERRORLEVEL%');
  });

  it('steps aside to the real binary with its own directory off PATH once Memnox is gone', () => {
    expect(lines).toContain(`if not exist "${ENTRY.intercept}" goto real`);
    expect(lines).toContain(`set "PATH=%PATH:;${DIRECTORY};=;%"`);
    expect(lines).toContain(`set "PATH=%PATH:;${DIRECTORY}\\;=;%"`);
    expect(lines[lines.length - 2]).toBe('git %*');
  });

  it('doubles a percent in a path, so a directory named with one is not expanded', () => {
    const odd = cmdShimFor('git', { ...ENTRY, node: 'C:\\100%\\node.exe' }, DIRECTORY);
    expect(odd).toContain('"C:\\100%%\\node.exe"');
  });

  it('keeps setlocal, so the PATH it trims never leaks into the caller', () => {
    expect(lines.indexOf('setlocal')).toBeLessThan(lines.indexOf(':real'));
  });
});

describe('a .cmd launcher for an agent', () => {
  const text = cmdLauncherFor('claude', ENTRY, DIRECTORY, ['--version', 'mcp']);

  it('starts the agent under memnox run through the CLI entry', () => {
    expect(text).toContain(`"${ENTRY.node}" "${ENTRY.cli}" run -- claude %*`);
  });

  it('runs the real agent inside a session, when turned off, or for a subcommand', () => {
    expect(text).toContain('if defined MEMNOX_SESSION goto real');
    expect(text).toContain('if /i "%MEMNOX_LAUNCH%"=="off" goto real');
    expect(text).toContain('for %%a in (--version mcp) do if /i "%~1"=="%%a" goto real');
  });
});

describe('installing interceptors for Windows', () => {
  const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-win-'));
  const machine = (candidate: string): boolean =>
    candidate === 'C:\\Git\\cmd\\git.exe' || candidate === 'C:\\npm\\claude.cmd';

  it('writes the Git Bash script and a .cmd beside it for every binary this machine has', async () => {
    const dir = await home();
    const report = await installInterceptors(dir, 'memnox-intercept', {
      platform: 'win32',
      path: 'C:\\Git\\cmd;C:\\npm',
      exists: machine,
      windows: ENTRY,
    });
    expect(report.installed).toEqual(['git']);
    expect(report.launchers).toEqual(['claude']);
    const files = await readdir(interceptorDirFor(dir));
    expect(files.sort()).toEqual(['claude', 'claude.cmd', 'git', 'git.cmd']);
    expect(await readFile(join(interceptorDirFor(dir), 'git'), 'utf8')).toContain(
      '#!/bin/sh',
    );
    expect(await readFile(join(interceptorDirFor(dir), 'git.cmd'), 'utf8')).toContain(
      'git %*',
    );
  });

  it('writes no .ps1, which a restricted execution policy would refuse in place of the .cmd', async () => {
    const dir = await home();
    await installInterceptors(dir, 'memnox-intercept', {
      platform: 'win32',
      path: 'C:\\Git\\cmd',
      exists: machine,
      windows: ENTRY,
    });
    const files = await readdir(interceptorDirFor(dir));
    expect(files.some((file) => file.endsWith('.ps1'))).toBe(false);
  });

  it('prints the PowerShell line that puts the directory first', async () => {
    const dir = await home();
    const report = await installInterceptors(dir, 'memnox-intercept', {
      platform: 'win32',
      path: '',
      exists: machine,
      windows: ENTRY,
    });
    expect(report.pathLine).toBe(`$env:Path = "${report.directory};" + $env:Path`);
  });

  it('refuses rather than writing shims that name no node', async () => {
    await expect(
      installInterceptors(await home(), 'memnox-intercept', {
        platform: 'win32',
        path: '',
      }),
    ).rejects.toThrow(/node and entry paths/);
  });

  it('counts one wrapper per binary, though Windows keeps two files for each', () => {
    expect(shimNamesIn(['git', 'git.cmd', 'claude', 'claude.CMD'])).toEqual([
      'git',
      'claude',
    ]);
  });
});

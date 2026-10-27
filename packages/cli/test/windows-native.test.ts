import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interceptorDirFor } from '@memnox/interceptors';
import { environmentFor } from '../src/commands/run.command';
import { startPlanFor } from '../src/commands/run/start';
import {
  listenOptionsFor,
  prepareAddress,
  secureAddress,
} from '../src/daemon/daemon-endpoint';
import { installService, serviceState, uninstallService } from '../src/daemon/service';
import {
  createTaskArgs,
  deleteTaskArgs,
  endTaskArgs,
  runTaskArgs,
  taskLauncherFor,
  WINDOWS_TASK_NAME,
} from '../src/daemon/service-windows';
import { onPath } from '../src/on-path';

/**
 * The Windows branches, driven on this machine with the platform injected. These prove
 * the command lines and files Memnox would hand Windows, and nothing about Windows itself.
 */
const PIPE = '\\\\.\\pipe\\memnox-ada-0123abcd';

describe('the daemon address on Windows', () => {
  it('never opens the pipe or the socket to everybody', () => {
    expect(listenOptionsFor(PIPE)).toEqual({
      path: PIPE,
      readableAll: false,
      writableAll: false,
    });
    expect(listenOptionsFor('/h/.memnox/memnox.sock').readableAll).toBe(false);
  });

  it('makes no directory and sets no mode for a pipe, which has neither', async () => {
    await expect(prepareAddress(PIPE)).resolves.toBeUndefined();
    await expect(secureAddress(PIPE)).resolves.toBeUndefined();
  });
});

describe('the Scheduled Task that starts the daemon at logon', () => {
  const home = (): Promise<string> => mkdtemp(join(tmpdir(), 'memnox-task-'));

  it('registers per user at logon, without elevation, replacing its own earlier task', () => {
    expect(createTaskArgs('C:\\Users\\ada\\.memnox\\daemon-task.cmd')).toEqual([
      '/Create',
      '/TN',
      WINDOWS_TASK_NAME,
      '/TR',
      '"C:\\Users\\ada\\.memnox\\daemon-task.cmd"',
      '/SC',
      'ONLOGON',
      '/RL',
      'LIMITED',
      '/F',
    ]);
  });

  it('starts, ends and deletes the same task by name', () => {
    expect(runTaskArgs()).toEqual(['/Run', '/TN', WINDOWS_TASK_NAME]);
    expect(endTaskArgs()).toEqual(['/End', '/TN', WINDOWS_TASK_NAME]);
    expect(deleteTaskArgs()).toEqual(['/Delete', '/TN', WINDOWS_TASK_NAME, '/F']);
  });

  it('names node and the CLI by absolute path, with the PATH and the log it runs with', () => {
    const text = taskLauncherFor({
      node: 'C:\\Program Files\\nodejs\\node.exe',
      entry: 'C:\\npm\\node_modules\\memnox\\dist\\index.js',
      log: 'C:\\Users\\ada\\.memnox\\daemon.log',
      path: 'C:\\Windows;C:\\50%\\bin',
    });
    const lines = text.split('\r\n');
    expect(lines).toContain('set "PATH=C:\\Windows;C:\\50%%\\bin"');
    expect(lines).toContain(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\memnox\\dist\\index.js" daemon >> "C:\\Users\\ada\\.memnox\\daemon.log" 2>&1',
    );
  });

  it('writes the launcher, hands it to the task, and takes both back', async () => {
    const dir = await home();
    const loaded: string[] = [];
    const result = await installService(dir, {
      platform: 'win32',
      load: (path) => {
        loaded.push(path);
        return null;
      },
    });
    expect(result.state.manager).toBe('Task Scheduler');
    expect(result.state.onlyAtLogon).toBe(true);
    expect(loaded).toEqual([result.state.path]);
    expect(await readFile(result.state.path, 'utf8')).toContain(' daemon >> ');
    expect(serviceState(dir, 'win32').installed).toBe(true);

    const removed = await uninstallService(dir, {
      platform: 'win32',
      unload: () => null,
    });
    expect(removed.state.installed).toBe(false);
    expect(serviceState(dir, 'win32').installed).toBe(false);
  });

  it('passes on what Task Scheduler said when it refused', async () => {
    const result = await installService(await home(), {
      platform: 'win32',
      load: () => 'Task Scheduler refused the task: Access is denied.',
    });
    expect(result.warning).toContain('Access is denied');
  });
});

describe('starting an agent on Windows', () => {
  it('puts the interceptors first under the Path spelling Windows uses, once', () => {
    const env = environmentFor({ Path: 'C:\\Windows' }, '/h', 'ses_1', 'memnox-shell');
    expect(env['Path']?.startsWith(interceptorDirFor('/h'))).toBe(true);
    expect('PATH' in env).toBe(false);
  });

  it('runs an npm installed agent, which is a .cmd, under cmd.exe', () => {
    const plan = startPlanFor('C:\\npm\\claude.cmd', ['-p', 'fix it'], {}, 'win32');
    expect(plan.file).toBe('cmd.exe');
    expect(plan.verbatim).toBe(true);
    expect(plan.args[3]).toContain('C:\\npm\\claude.cmd');
  });

  it('starts by name, untouched, on macOS and Linux', () => {
    expect(startPlanFor('claude', ['-p', 'fix it'], {}, 'darwin')).toEqual({
      file: 'claude',
      args: ['-p', 'fix it'],
      verbatim: false,
    });
  });

  it('finds claude.exe on PATH, which a bare name lookup would miss', () => {
    const found = (candidate: string): boolean =>
      candidate.toLowerCase() === 'c:\\tools\\claude.exe';
    expect(onPath('claude', 'C:\\Windows;C:\\Tools', found, 'win32')).toBe(true);
    expect(onPath('claude', 'C:\\Windows', found, 'win32')).toBe(false);
  });
});

/**
 * The daemon started at logon on Windows: a per user Scheduled Task that runs a small `.cmd`
 * naming this node and this CLI, because `/TR` caps at 261 characters and quotes badly.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { MEMNOX_HOME } from '@memnox/core';
import { describeError } from '../cli-errors';

/** What Task Scheduler lists the task as, the same label launchd and systemd use. */
export const WINDOWS_TASK_NAME = 'com.memnox.daemon';

/** What the person reads for the service manager on Windows. */
export const WINDOWS_MANAGER = 'Task Scheduler';

const LAUNCHER_FILE = 'daemon-task.cmd';

/** The longest `/TR` schtasks accepts. */
const TASK_RUN_LIMIT = 261;

/** Hidden, so registering the task does not flash a console at somebody. */
const QUIET = { stdio: 'ignore', windowsHide: true } as const;

/** Where the task's launcher lives, inside the Memnox home the person already owns. */
export function taskLauncherPath(home: string): string {
  return join(home, MEMNOX_HOME, LAUNCHER_FILE);
}

/** What the launcher starts: this node and this CLI, by absolute path. */
interface TaskCommand {
  node: string;
  entry: string;
  /** Where the daemon writes, since a task has no terminal. */
  log: string;
  /** The installing shell's PATH, without the interceptors, as the plist and unit carry it. */
  path: string;
}

/** `%` doubled, because a batch line expands `%name%` before anything else reads it. */
function batchLiteral(text: string): string {
  return text.replaceAll('%', '%%');
}

export function taskLauncherFor(command: TaskCommand): string {
  return [
    '@echo off',
    'rem Started at logon by the Memnox Scheduled Task. "memnox daemon --uninstall" removes both.',
    `set "PATH=${batchLiteral(command.path)}"`,
    `"${batchLiteral(command.node)}" "${batchLiteral(command.entry)}" daemon >> "${batchLiteral(command.log)}" 2>&1`,
    '',
  ].join('\r\n');
}

/** At this user's logon, with no elevation, replacing a task of the same name. */
export function createTaskArgs(launcher: string): string[] {
  return [
    '/Create',
    '/TN',
    WINDOWS_TASK_NAME,
    '/TR',
    `"${launcher}"`,
    '/SC',
    'ONLOGON',
    '/RL',
    'LIMITED',
    '/F',
  ];
}

export function runTaskArgs(): string[] {
  return ['/Run', '/TN', WINDOWS_TASK_NAME];
}

export function endTaskArgs(): string[] {
  return ['/End', '/TN', WINDOWS_TASK_NAME];
}

export function deleteTaskArgs(): string[] {
  return ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'];
}

/** Null once registered and started, otherwise the sentence saying which step refused. */
export function registerTask(launcher: string): string | null {
  if (`"${launcher}"`.length > TASK_RUN_LIMIT) {
    return `the launcher path is longer than the ${TASK_RUN_LIMIT} characters schtasks accepts: ${launcher}`;
  }
  try {
    execFileSync('schtasks', createTaskArgs(launcher), QUIET);
  } catch (error) {
    return `Task Scheduler refused the task: ${describeError(error)}`;
  }
  try {
    execFileSync('schtasks', runTaskArgs(), QUIET);
    return null;
  } catch (error) {
    return `the task is registered and starts at the next logon, but did not start now: ${describeError(error)}`;
  }
}

/** Null once the task is gone, ended first so no daemon is left that nothing admits to. */
export function removeTask(): string | null {
  try {
    execFileSync('schtasks', endTaskArgs(), QUIET);
  } catch {
    // Not running is what we were about to make true.
  }
  try {
    execFileSync('schtasks', deleteTaskArgs(), QUIET);
    return null;
  } catch (error) {
    return isTaskRegistered() ? describeError(error) : null;
  }
}

function isTaskRegistered(): boolean {
  try {
    execFileSync('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME], QUIET);
    return true;
  } catch {
    return false;
  }
}

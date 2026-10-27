/**
 * How this copy of Memnox was installed, read off where it runs from, and the one command
 * that upgrades it. Where the path does not say, the command is printed and never guessed.
 */
import { execFile, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ownProcessEnv } from '@memnox/core';
import { updatesLogPath } from '../../memnox-paths';
import { installedFrom, judgeRelease, type Verdict } from './provenance';

/** The name this CLI is published under. */
const PACKAGE = 'memnox';
const LATEST = `${PACKAGE}@latest`;

/** Long enough for a slow registry, short enough that an offline laptop is not left waiting. */
const LOOKUP_TIMEOUT_MS = 10_000;

/** A whole install into a scratch directory and an audit of it, on a slow connection. */
const VERIFY_TIMEOUT_MS = 180_000;

export const INSTALL_METHOD = {
  NPM: 'npm global',
  PNPM: 'pnpm global',
  NPX: 'npx cache',
  UNKNOWN: 'not recognised',
} as const;

type InstallMethod = (typeof INSTALL_METHOD)[keyof typeof INSTALL_METHOD];

export interface Install {
  method: InstallMethod;
  /** The upgrade as a person would type it. */
  display: string;
  /** Run only after a yes; null where running it would be a guess. */
  command: readonly string[] | null;
}

const NPM_UPGRADE = ['npm', 'install', '-g', LATEST] as const;
const PNPM_UPGRADE = ['pnpm', 'add', '-g', LATEST] as const;

/** Read from the resolved path, because a global bin is a link into where it really lives. */
export function installOf(entry: string): Install {
  const path = entry.replace(/\\/g, '/');
  if (path.includes('/_npx/')) {
    // npx fetches what it is asked for, so the next run naming @latest is the upgrade.
    return { method: INSTALL_METHOD.NPX, display: `npx ${LATEST}`, command: null };
  }
  if (path.includes('/pnpm/') && path.includes(`/node_modules/${PACKAGE}/`)) {
    return {
      method: INSTALL_METHOD.PNPM,
      display: PNPM_UPGRADE.join(' '),
      command: PNPM_UPGRADE,
    };
  }
  if (/\/(lib|npm)\/node_modules\/memnox\//.test(path)) {
    return {
      method: INSTALL_METHOD.NPM,
      display: NPM_UPGRADE.join(' '),
      command: NPM_UPGRADE,
    };
  }
  return {
    method: INSTALL_METHOD.UNKNOWN,
    display: NPM_UPGRADE.join(' '),
    command: null,
  };
}

/** The script this process runs, resolved; empty where there is none to resolve. */
export function runningEntry(): string {
  const entry = process.argv[1];
  if (entry === undefined || entry === '') return '';
  try {
    return realpathSync(entry);
  } catch {
    // Gone from under the process, which leaves the method unknown and the command printed.
    return entry;
  }
}

/** The newest published version, asked of npm; null offline or wherever npm is missing. */
export function latestPublished(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['view', PACKAGE, 'version'],
      { env: ownProcessEnv(), timeout: LOOKUP_TIMEOUT_MS },
      (err, stdout) => {
        const version = String(stdout).trim();
        resolve(err === null && version !== '' ? version : null);
      },
    );
  });
}

/** The upgrade pinned to the version that was verified, so a release cut since cannot slip in. */
export function pinnedTo(command: readonly string[], version: string): string[] {
  return command.map((part) => (part === LATEST ? `${PACKAGE}@${version}` : part));
}

/**
 * Installs exactly the release into a scratch directory with no scripts run, then lets npm
 * check every signature and attestation in it; the verdict on who built ours is ours to give.
 */
export async function verifyRelease(version: string): Promise<Verdict> {
  const scratch = await mkdtemp(join(tmpdir(), 'memnox-verify-'));
  try {
    await writeFile(join(scratch, 'package.json'), '{"private":true}\n');
    const install = await npmIn(scratch, [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `${PACKAGE}@${version}`,
    ]);
    if (!install.ok)
      return {
        ok: false,
        reason: `npm could not fetch ${PACKAGE}@${version} to check it`,
      };
    // Exit code 1 is how npm reports a bad signature, so the JSON is read either way.
    const audit = await npmIn(scratch, [
      'audit',
      'signatures',
      '--json',
      '--include-attestations',
    ]);
    const lockfile = await readFile(join(scratch, 'package-lock.json'), 'utf8');
    return judgeRelease(audit.stdout, installedFrom(lockfile), version);
  } catch {
    return { ok: false, reason: 'npm could not be run to check the release' };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** What one upgrade was, kept whether or not it was verified. */
export interface UpdateRecord {
  at: string;
  from: string;
  to: string;
  verified: boolean;
}

/** Appended owner only, because an install somebody chose not to verify is worth finding later. */
export async function recordUpdate(home: string, record: UpdateRecord): Promise<void> {
  const path = updatesLogPath(home);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function npmIn(
  cwd: string,
  args: readonly string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      'npm',
      [...args],
      {
        cwd,
        env: ownProcessEnv(),
        timeout: VERIFY_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout) => resolve({ ok: err === null, stdout: String(stdout) }),
    );
  });
}

/** Runs one command with the terminal attached; true when it exited cleanly. */
export function runAttached(command: readonly string[]): Promise<boolean> {
  const [executable, ...args] = command;
  if (executable === undefined) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: 'inherit', env: ownProcessEnv() });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** The wiring again, through the entry just upgraded, so hooks and the service name it. */
export function rewireThroughNewInstall(): Promise<boolean> {
  const entry = process.argv[1];
  if (entry === undefined) return Promise.resolve(false);
  return runAttached([process.execPath, entry, 'update', '--rewire']);
}

/** Major, minor and patch compared as numbers; a prerelease tag is ignored rather than guessed. */
export function isNewer(candidate: string, installed: string): boolean {
  const left = partsOf(candidate);
  const right = partsOf(installed);
  for (let at = 0; at < left.length; at += 1) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function partsOf(version: string): number[] {
  return (version.split('-')[0] ?? '').split('.').map((part) => Number(part) || 0);
}

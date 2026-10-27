import { basename } from 'node:path';
import { unwrapLaunch } from './wrap';

/**
 * A launch line that fetches a package on every start, and whether it names an exact
 * version: unpinned, today's review covers nothing tomorrow. Read off the line, never a registry.
 */
export interface LaunchPin {
  /** The fetching runner as typed, e.g. `npx` or `pnpm dlx`. */
  runner: string;
  /** The package as the line names it, version included. */
  spec: string;
  /** True only for an exact version. A range, a tag or nothing at all floats. */
  pinned: boolean;
}

/** How one registry's runners spell a fetch, and which flags carry the package. */
interface Registry {
  /** Runner to the subcommand that makes it fetch, or null when the runner always does. */
  runners: Readonly<Record<string, string | null>>;
  /** Flags whose value is the package itself, ahead of whatever command follows. */
  packageFlags: readonly string[];
  /** Other flags that take the next word, so it is never read as the package. */
  valueFlags: readonly string[];
  pinned: (spec: string) => boolean;
}

const EXACT_SEMVER = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const NPM: Registry = {
  runners: { npx: null, bunx: null, pnpx: null, pnpm: 'dlx', yarn: 'dlx', bun: 'x' },
  packageFlags: ['-p', '--package'],
  valueFlags: ['--registry', '--cache', '--userconfig'],
  pinned: npmPinned,
};

const PYPI: Registry = {
  runners: { uvx: null, uv: 'tool', pipx: 'run' },
  packageFlags: ['--from', '--spec'],
  valueFlags: ['-p', '--python', '--with', '--index-url', '--index'],
  pinned: pypiPinned,
};

/** What the line fetches and whether it is pinned, or null for a line that fetches nothing. */
export function launchPinOf(launch: {
  command: string;
  args: readonly string[];
}): LaunchPin | null {
  const bare = { command: launch.command, args: [...launch.args] };
  const line = unwrapLaunch(bare) ?? bare;
  const program = basename(line.command);
  for (const registry of [NPM, PYPI]) {
    const found = runnerArgs(program, line.args, registry);
    if (found === null) continue;
    const spec = packageIn(found.args, registry);
    return spec === null
      ? null
      : { runner: found.runner, spec, pinned: registry.pinned(spec) };
  }
  return null;
}

/** Whether a review of this server is a review of what will run next time it starts. */
export function floats(pin: LaunchPin | null): boolean {
  return pin !== null && !pin.pinned;
}

interface RunnerArgs {
  runner: string;
  args: readonly string[];
}

function runnerArgs(
  program: string,
  args: readonly string[],
  registry: Registry,
): RunnerArgs | null {
  // Own keys only, so a program called `constructor` is not a runner.
  if (!Object.keys(registry.runners).includes(program)) return null;
  const subcommand = registry.runners[program] ?? null;
  if (subcommand === null) return { runner: program, args };
  if (args[0] !== subcommand) return null;
  // `uv tool run` and `uv tool uvx` fetch; `uv tool install` puts a fixed copy on disk.
  if (program === 'uv') {
    if (args[1] !== 'run' && args[1] !== 'uvx') return null;
    return { runner: 'uv tool run', args: args.slice(2) };
  }
  return { runner: `${program} ${subcommand}`, args: args.slice(1) };
}

/** The package a runner fetches: a package flag's value, or the first bare word. */
function packageIn(args: readonly string[], registry: Registry): string | null {
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] as string;
    const [flag, inline] = word.split('=', 2);
    if (flag !== undefined && registry.packageFlags.includes(flag)) {
      return inline ?? args[at + 1] ?? null;
    }
    if (registry.valueFlags.includes(word)) {
      at += 1;
      continue;
    }
    if (word.startsWith('-')) continue;
    return word;
  }
  return null;
}

/** `name@1.2.3` is pinned; `name`, `name@latest` and `name@^1` all float. */
function npmPinned(spec: string): boolean {
  // The version follows the last `@` after the first character, which a scope may hold.
  const at = spec.lastIndexOf('@');
  if (at <= 0) return false;
  return EXACT_SEMVER.test(spec.slice(at + 1));
}

/** `name==1.2.3` and `name@1.2.3` are pinned; anything looser floats. */
function pypiPinned(spec: string): boolean {
  const exact = spec.match(/^[^=<>~!@\s]+(?:==|@)([^,;\s]+)$/);
  return exact?.[1] !== undefined && !exact[1].includes('*') && exact[1] !== 'latest';
}

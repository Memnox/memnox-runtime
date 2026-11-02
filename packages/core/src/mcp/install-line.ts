import { basename } from 'node:path';

/**
 * A server's command typed as the package install a README shows, such as `pip install comfy-mcp`, turned into
 * the runner line that fetches the package and starts it, so the server installs itself the first time it is
 * started rather than an install standing where a start should be. Pure: read off the line, never a registry.
 */

/** The runner line an install command stands for, and the package it fetches. */
export interface RunnerLine {
  command: string;
  args: string[];
  /** The package as the install named it, version included. */
  installs: string;
}

/** The runner every Python install is started through, which fetches into a cache of its own. */
const PYTHON_RUNNER = 'uvx';
/** The runner every Node install is started through; `-y` answers its own question about fetching. */
const NODE_RUNNER = 'npx';
const NODE_RUNNER_YES = '-y';
const UVX_FROM = '--from';

/** Flags an install may carry that change nothing about which package runs, so they are dropped. */
const PLAIN_FLAGS: readonly string[] = [
  '-g',
  '--global',
  '-U',
  '--upgrade',
  '--user',
  '-q',
  '--quiet',
  '--save',
  '--save-dev',
  '-D',
  '--no-cache-dir',
];

/** Words that end one shell command and start another, so the line is more than one install. */
const SHELL_JOINS = /[;&|<>`$()]/;

/** A Python package spec split into the name it runs as and the rest: `comfy-mcp[all]>=1.0`. */
const PYTHON_SPEC = /^([A-Za-z0-9][A-Za-z0-9._-]*)(.*)$/;

type Ecosystem = 'python' | 'node';

/** The runner line for a typed install of exactly one package, or null for any other line. */
export function runnerForInstall(
  command: string,
  args: readonly string[],
): RunnerLine | null {
  const words = [basename(command), ...args];
  const install = installOf(words);
  if (install === null) return null;
  const packages: string[] = [];
  for (const word of install.rest) {
    if (SHELL_JOINS.test(word)) return null;
    if (word.startsWith('-')) {
      // A flag that takes a value, such as an index, changes what is fetched, so it is never guessed past.
      if (!PLAIN_FLAGS.includes(word)) return null;
      continue;
    }
    packages.push(word);
  }
  const [spec, ...more] = packages;
  if (spec === undefined || more.length > 0) return null;
  return install.ecosystem === 'node' ? nodeLine(spec) : pythonLine(spec);
}

/** Which ecosystem the line installs into and the words after its install verb, or null for no install. */
function installOf(
  words: readonly string[],
): { ecosystem: Ecosystem; rest: string[] } | null {
  const [program, ...rest] = words;
  const after = (verbs: readonly string[], at = 0): string[] | null => {
    const verb = rest[at];
    return verb !== undefined && verbs.includes(verb) ? rest.slice(at + 1) : null;
  };
  const python = (found: string[] | null) =>
    found === null ? null : { ecosystem: 'python' as const, rest: found };
  const node = (found: string[] | null) =>
    found === null ? null : { ecosystem: 'node' as const, rest: found };
  switch (program) {
    case 'pip':
    case 'pip3':
    case 'pipx':
      return python(after(['install']));
    case 'python':
    case 'python3':
      return rest[0] === '-m' && rest[1] === 'pip' ? python(after(['install'], 2)) : null;
    case 'uv':
      return rest[0] === 'pip' || rest[0] === 'tool'
        ? python(after(['install'], 1))
        : null;
    case 'npm':
      return node(after(['install', 'i', 'add']));
    case 'pnpm':
    case 'bun':
      return node(after(['add', 'install', 'i']));
    case 'yarn':
      return rest[0] === 'global' ? node(after(['add'], 1)) : node(after(['add']));
    default:
      return null;
  }
}

function nodeLine(spec: string): RunnerLine {
  return { command: NODE_RUNNER, args: [NODE_RUNNER_YES, spec], installs: spec };
}

/** A bare name runs as itself; a spec with a version or extras is fetched as written and run by its name. */
function pythonLine(spec: string): RunnerLine | null {
  const match = PYTHON_SPEC.exec(spec);
  const name = match?.[1];
  if (match === null || name === undefined) return null;
  const args = match[2] === '' ? [name] : [UVX_FROM, spec, name];
  return { command: PYTHON_RUNNER, args, installs: spec };
}

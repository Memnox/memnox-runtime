import { homedir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { MEMNOX_HOME } from '../config/config';

/**
 * The environment for a git call Memnox makes about itself. A seam that asked the git on
 * PATH met its own interceptor, which asked again: one `git` became hundreds of processes.
 */

/** Where the interceptors live under the Memnox home, every entry the one wrapper. */
export const INTERCEPTOR_DIR = 'bin';

export function interceptorDirFor(home: string): string {
  return join(home, MEMNOX_HOME, INTERCEPTOR_DIR);
}

/** Any home's wrappers, since a process given another HOME still inherits the person's PATH. */
const INTERCEPTOR_SUFFIX = `${sep}${MEMNOX_HOME}${sep}${INTERCEPTOR_DIR}`;

function isInterceptorDir(entry: string, ours: string): boolean {
  const trimmed = foldCase(entry.endsWith(sep) ? entry.slice(0, -1) : entry);
  return trimmed === foldCase(ours) || trimmed.endsWith(foldCase(INTERCEPTOR_SUFFIX));
}

/** Windows paths compare without case, so `C:\Users` and `c:\users` are one entry. */
function foldCase(path: string): string {
  return sep === '\\' ? path.toLowerCase() : path;
}

/** PATH without our directory, so what runs is the real binary rather than the gate. */
export function realPath(path: string, home: string): string {
  const ours = interceptorDirFor(home);
  return path
    .split(delimiter)
    .filter((entry) => entry !== '' && !isInterceptorDir(entry, ours))
    .join(delimiter);
}

/** Only for Memnox's own lookups: a command an agent ran keeps the PATH it was given. */
export function ownProcessEnv(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return withPathValue(env, realPath(pathValueOf(env), home));
}

/** The name this environment keeps PATH under, which on Windows is usually `Path`. */
export function pathKeyOf(env: NodeJS.ProcessEnv): string {
  if ('PATH' in env) return 'PATH';
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
}

/** PATH however it is spelled, since a copy of Windows' environment is no longer case blind. */
export function pathValueOf(env: NodeJS.ProcessEnv): string {
  return env[pathKeyOf(env)] ?? '';
}

/** A copy with PATH set under its own spelling and no second spelling left beside it. */
export function withPathValue(env: NodeJS.ProcessEnv, value: string): NodeJS.ProcessEnv {
  const key = pathKeyOf(env);
  const next: NodeJS.ProcessEnv = { ...env, [key]: value };
  // Two spellings reach a Windows child as one, and which one wins is a sort order.
  for (const other of Object.keys(next)) {
    if (other !== key && other.toUpperCase() === 'PATH') delete next[other];
  }
  return next;
}

/** The directory first on a PATH, once, joined with the separator the platform uses. */
export function prependedPath(
  path: string,
  directory: string,
  separator: string = delimiter,
): string {
  return path.startsWith(directory) ? path : `${directory}${separator}${path}`;
}

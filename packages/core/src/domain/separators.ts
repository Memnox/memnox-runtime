import { normalize, sep } from 'node:path';

const WINDOWS_SEPARATOR = '\\';
const SLASH = '/';

/**
 * A path spelled with `/`, as every rule and recorded repository path names one. On Windows a
 * `/` pattern never matched a `\` path, so a deny on `.ssh` let the key through; elsewhere `\` is a name.
 */
export const slashed: (path: string) => string =
  sep === WINDOWS_SEPARATOR
    ? (path) => path.split(WINDOWS_SEPARATOR).join(SLASH)
    : (path) => path;

/** A path as this platform spells it, since git answers `C:/Users/me/repo` on Windows. */
export function nativePath(path: string): string {
  return normalize(path.trim());
}

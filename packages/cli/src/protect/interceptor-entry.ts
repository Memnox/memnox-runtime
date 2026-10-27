/**
 * The interceptors as this CLI installs them. On Windows their `.cmd` shims name this node
 * and this package's entry scripts by absolute path, so they are resolved here, once.
 */
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  installInterceptors,
  INTERCEPT_BINARY,
  nativeInterceptorUnder,
  WINDOWS,
  type InterceptorInstallReport,
  type WindowsShimEntry,
} from '@memnox/interceptors';

/** Resolved through the symlink a global install leaves, which a package manager replaces. */
function windowsShimEntry(): WindowsShimEntry {
  const cli = process.argv[1] ?? '';
  return {
    node: process.execPath,
    intercept: fileURLToPath(new URL('./bin/intercept.js', import.meta.url)),
    cli: cli === '' ? cli : realpathSync(cli),
  };
}

/**
 * The native wrapper this package shipped for the machine, named where it lies rather than
 * copied, so uninstalling removes only the shims and an update brings its own.
 */
export function shippedNativeInterceptor(
  root: string = fileURLToPath(new URL('.', import.meta.url)),
  host: { platform: NodeJS.Platform; arch: string } = process,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (host.platform === WINDOWS) return undefined;
  const path = nativeInterceptorUnder(root, host.platform, host.arch);
  return exists(path) ? path : undefined;
}

export function installOwnInterceptors(home: string): Promise<InterceptorInstallReport> {
  const windows = process.platform === WINDOWS ? { windows: windowsShimEntry() } : {};
  const native = shippedNativeInterceptor();
  return installInterceptors(home, INTERCEPT_BINARY, {
    ...windows,
    ...(native === undefined ? {} : { native }),
  });
}

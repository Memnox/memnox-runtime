import { statSync } from 'node:fs';

/**
 * The daemon's own code, watched so a rebuild or an update is picked up. A service manager
 * keeps it alive, so stopping is how it restarts on the new code; a daemon still running the
 * old code answers with rules and voice commands that no longer exist.
 */

const LOOK_EVERY_MS = 20_000;

/** Started by launchd or systemd, which bring it back; run by hand, nothing would. */
export function underServiceManager(env: NodeJS.ProcessEnv): boolean {
  return (
    (env['XPC_SERVICE_NAME'] ?? '').startsWith('com.memnox') ||
    (env['INVOCATION_ID'] ?? '') !== ''
  );
}

/** Calls `changed` once when the file's modification time moves, and returns how to stop looking. */
export function watchOwnCode(
  entry: string,
  changed: () => void,
  everyMs: number = LOOK_EVERY_MS,
  modifiedAt: (path: string) => number | null = modifiedTime,
): () => void {
  const started = modifiedAt(entry);
  const timer = setInterval(() => {
    const now = modifiedAt(entry);
    if (started === null || now === null || now === started) return;
    clearInterval(timer);
    changed();
  }, everyMs);
  // Looking is never a reason to keep a process alive that was asked to stop.
  timer.unref();
  return () => clearInterval(timer);
}

function modifiedTime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    // Mid rebuild the file is briefly gone; the next look sees the new one.
    return null;
  }
}

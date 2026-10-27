import { describe, expect, it, vi } from 'vitest';
import { underServiceManager, watchOwnCode } from '../src/daemon/code-watch';

describe('the daemon picking up a rebuild of itself', () => {
  it('stops once when its own file changes, so its service manager starts the new code', () => {
    vi.useFakeTimers();
    let modified = 1;
    const changed = vi.fn();
    watchOwnCode('/memnox/index.js', changed, 1_000, () => modified);
    vi.advanceTimersByTime(3_000);
    expect(changed).not.toHaveBeenCalled();
    modified = 2;
    vi.advanceTimersByTime(3_000);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('only restarts where something brings it back', () => {
    expect(underServiceManager({ XPC_SERVICE_NAME: 'com.memnox.daemon' })).toBe(true);
    expect(underServiceManager({ INVOCATION_ID: 'abc' })).toBe(true);
    expect(underServiceManager({ XPC_SERVICE_NAME: '0' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { shippedNativeInterceptor } from '../src/protect/interceptor-entry';

describe('the native wrapper this package shipped', () => {
  const built = '/pkg/dist/native/darwin-arm64/memnox-intercept-native';

  it('is named where it was built for this platform', () => {
    const found = shippedNativeInterceptor(
      '/pkg/dist',
      { platform: 'darwin', arch: 'arm64' },
      (path) => path === built,
    );
    expect(found).toBe(built);
  });

  it('is absent for another platform, where the Node interceptor stays in front', () => {
    const found = shippedNativeInterceptor(
      '/pkg/dist',
      { platform: 'linux', arch: 'x64' },
      (path) => path === built,
    );
    expect(found).toBeUndefined();
  });

  it('is never used on Windows, whose shims are .cmd files', () => {
    const found = shippedNativeInterceptor(
      '/pkg/dist',
      { platform: 'win32', arch: 'x64' },
      () => true,
    );
    expect(found).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  ownProcessEnv,
  pathKeyOf,
  pathValueOf,
  prependedPath,
  windowsCoverageFor,
  withPathValue,
} from '../src/index';

/**
 * Windows keeps PATH as `Path`, and a copy of its environment is an ordinary object, so
 * `env.PATH` on that copy is undefined and a second spelling set beside it is a coin toss.
 */
describe('PATH however the platform spells it', () => {
  it('reads PATH as PATH where it is spelled that way', () => {
    expect(pathKeyOf({ PATH: '/usr/bin' })).toBe('PATH');
    expect(pathValueOf({ PATH: '/usr/bin' })).toBe('/usr/bin');
  });

  it('reads Windows Path from a copy of the environment', () => {
    const env = { Path: 'C:\\Windows;C:\\Git\\bin', ComSpec: 'cmd.exe' };
    expect(pathKeyOf(env)).toBe('Path');
    expect(pathValueOf(env)).toBe('C:\\Windows;C:\\Git\\bin');
  });

  it('is empty, not undefined, when there is no PATH at all', () => {
    expect(pathValueOf({})).toBe('');
  });

  it('sets the value under the spelling already there and leaves no second one', () => {
    const next = withPathValue({ Path: 'C:\\Windows', HOME: 'h' }, 'C:\\x;C:\\Windows');
    expect(next).toEqual({ Path: 'C:\\x;C:\\Windows', HOME: 'h' });
    expect('PATH' in next).toBe(false);
  });

  it('keeps PATH on macOS and Linux exactly as before', () => {
    expect(withPathValue({ PATH: '/bin', A: '1' }, '/x:/bin')).toEqual({
      PATH: '/x:/bin',
      A: '1',
    });
  });

  it('puts a directory first once, with the separator it is given', () => {
    expect(prependedPath('C:\\Windows', 'C:\\m\\bin', ';')).toBe(
      'C:\\m\\bin;C:\\Windows',
    );
    expect(prependedPath('C:\\m\\bin;C:\\Windows', 'C:\\m\\bin', ';')).toBe(
      'C:\\m\\bin;C:\\Windows',
    );
    expect(prependedPath('/usr/bin', '/h/.memnox/bin', ':')).toBe(
      '/h/.memnox/bin:/usr/bin',
    );
  });

  it("strips Memnox's own directory from a Path spelled the Windows way", () => {
    const env = ownProcessEnv('/h', { Path: `/h/.memnox/bin:/usr/bin` });
    expect(env).toEqual({ Path: '/usr/bin' });
  });
});

describe('what governs each agent on Windows', () => {
  it('lists the hook for Claude Code and the kernel guard as missing for everyone', () => {
    const [claude, cursor] = windowsCoverageFor([
      { id: 'agt_claude-code', kind: 'claude-code' },
      { id: 'agt_cursor', kind: 'cursor' },
    ]);
    expect(claude?.native.map((seam) => seam.seam)).toEqual([
      'MCP proxy',
      'PATH interceptors',
      'Claude Code hook',
    ]);
    expect(claude?.missing.map((seam) => seam.seam)).toEqual([
      'kernel guard',
      'memnox-shell as the agent shell',
    ]);
    expect(cursor?.native.map((seam) => seam.seam)).toEqual([
      'MCP proxy',
      'PATH interceptors',
    ]);
    expect(cursor?.missing.map((seam) => seam.seam)).toEqual(['kernel guard']);
  });

  it('says why the kernel guard is missing, naming both platforms that have one', () => {
    const [agent] = windowsCoverageFor([{ id: 'agt_codex-cli', kind: 'codex-cli' }]);
    expect(agent?.missing[0]?.detail).toContain('sandbox-exec');
    expect(agent?.missing[0]?.detail).toContain('Landlock');
  });
});

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { watch } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchablePaths } from '@memnox/core';
import { watchConfigPaths } from '../src/config-watch';

describe('the directories worth watching', () => {
  const deep = (home: string): string[] =>
    watchablePaths(home)
      .filter((target) => target.only === undefined)
      .map((target) => target.path);

  /* A config that does not exist yet cannot be watched, and a newly added MCP config
     is exactly the arrival worth catching, so it is the directory that is watched. */
  it('watches the directory that holds each agent config', () => {
    const paths = deep('/home/me');

    expect(paths).toContain(join('/home/me', '.claude'));
    expect(paths).toContain(join('/home/me', '.cursor'));
    expect(paths).toContain(join('/home/me', '.config', 'devin'));
  });

  /* Watched whole, home and ~/.config are every file the person owns, and on Linux the
     inotify watch limit runs out within minutes and takes the daemon with it. */
  it('never watches home or ~/.config whole', () => {
    const paths = deep('/home/me');

    expect(paths).not.toContain('/home/me');
    expect(paths).not.toContain(join('/home/me', '.config'));
  });

  it('watches a shared parent only for the agent entries named in it', () => {
    const targets = watchablePaths('/home/me');
    const home = targets.find((target) => target.path === '/home/me');
    const config = targets.find((target) => target.path === join('/home/me', '.config'));

    expect(home?.only).toContain('.claude.json');
    expect(home?.only).toContain('.cursor');
    expect(config?.only).toEqual(['devin', 'opencode']);
  });

  /* A definition installed into an agent's own directory changes what that agent may
     do and touches no config at all, so the directory it lands in is watched too. */
  it('watches the directories definitions are installed into', () => {
    const paths = deep('/home/me');

    expect(paths).toContain(join('/home/me', '.qwen', 'agents'));
    expect(paths).toContain(join('/home/me', '.github', 'agents'));
    expect(paths).toContain(join('/home/me', '.config', 'opencode', 'agents'));
  });
});

describe('waking on a change', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memnox-watch-'));
    await mkdir(join(dir, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /* The whole point: an MCP server added mid-watch is reported in seconds rather than
     on the next minute boundary, which is how long somebody would otherwise be told
     nothing had changed.

     Stubbed for the same reason the next test is. Against a real directory this raced
     the watcher's own arming — a write that landed first was never reported, the wait
     ran to its 60s interval, and the suite failed on a busy machine roughly one run in
     ten. What is asserted here is the contract: a change resolves the wait, and it
     resolves it nowhere near the interval. */
  it('returns long before the interval when a config file arrives', async () => {
    let fire: (() => void) | null = null;
    const watcher = watchConfigPaths([{ path: '/watched' }], {
      watch: ((_path: string, _options: unknown, onChange: () => void) => {
        fire = onChange;
        return { close: () => {} };
      }) as unknown as typeof watch,
    });
    const waiting = watcher.next(60_000);
    (fire as unknown as () => void)();
    const changed = await waiting;
    watcher.close();

    /* True means the change resolved the wait; the timeout path returns false. So the
       boolean already says it did not sit out the interval, and a stopwatch beside it
       would only add a way for a busy machine to fail the suite. */
    expect(changed).toBe(true);
  });

  /* Driven by a stub rather than the real filesystem: macOS coalesces and replays
     FSEvents, so a test that asserts "nothing happened" against a real directory is a
     test that fails on a busy machine and teaches everyone to re-run the suite. */
  it('gives up when nothing changed, so the interval still governs', async () => {
    const watcher = watchConfigPaths([{ path: '/watched' }], {
      watch: (() => ({ close: () => {} })) as unknown as typeof watch,
    });

    expect(await watcher.next(20)).toBe(false);
    watcher.close();
  });

  /* A shell history or a browser profile lands in home every few seconds, and none of
     it is an agent config, so a shared parent wakes only for the entries it named. */
  it('ignores an entry a shared parent did not name', async () => {
    let fire: ((event: string, name: string) => void) | null = null;
    let recursive: unknown = null;
    const watcher = watchConfigPaths([{ path: '/home/me', only: ['.claude.json'] }], {
      watch: ((
        _path: string,
        options: { recursive?: boolean },
        onChange: (event: string, name: string) => void,
      ) => {
        recursive = options.recursive;
        fire = onChange;
        return { close: () => {} };
      }) as unknown as typeof watch,
    });
    const emit = fire as unknown as (event: string, name: string) => void;
    emit('change', '.zsh_history');

    expect(recursive).toBe(false);
    expect(await watcher.next(20)).toBe(false);

    emit('rename', '.claude.json');
    expect(await watcher.next(20)).toBe(true);
    watcher.close();
  });

  it('still wakes on a change it did not make', async () => {
    let fire: ((event: string, name: string) => void) | null = null;
    const watcher = watchConfigPaths([{ path: '/watched' }], {
      watch: ((
        _path: string,
        _options: unknown,
        onChange: (event: string, name: string) => void,
      ) => {
        fire = onChange;
        return { close: () => {} };
      }) as unknown as typeof watch,
    });
    (fire as unknown as (event: string, name: string) => void)(
      'rename',
      '.claude/agents/devops-automator.md',
    );

    expect(await watcher.next(20)).toBe(true);
    watcher.close();
  });

  // A directory nobody has created is nothing to watch, and never a crash.
  it('survives a path that is not there', async () => {
    const watcher = watchConfigPaths([{ path: join(dir, 'never-created') }]);

    expect(await watcher.next(20)).toBe(false);
    watcher.close();
  });
});

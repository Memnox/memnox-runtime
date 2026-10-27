import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionPosts } from '@memnox/core';
import { names, noteCursorAsking } from '../src/cursor-asking';

const AT = new Date('2026-10-14T16:05:00.000Z');

function context(home: string) {
  return { home, agent: 'cursor', runSession: 'ses_cursor', now: () => AT };
}

function shell(command: string, cwd = '/work/eye') {
  return {
    hook_event_name: 'beforeShellExecution',
    command,
    cwd,
    conversation_id: 'c-1',
  };
}

async function homeAllowing(allow: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-cursor-asking-'));
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(
    join(home, '.cursor', 'cli-config.json'),
    JSON.stringify({ permissions: { allow, deny: [] } }),
  );
  return home;
}

describe("Cursor's command question", () => {
  it('posts it a moment ahead when its allowlist does not name the command', async () => {
    const home = await homeAllowing(['Shell(ls)']);
    await noteCursorAsking(shell('git status'), false, context(home));
    const posts = new SessionPosts(home);
    expect(await posts.open(AT.toISOString())).toEqual([]);
    const later = new Date(AT.getTime() + 5_000).toISOString();
    const [post] = await posts.open(later);
    expect(post?.sessionId).toBe('ses_cursor');
    expect(post?.summary).toContain('Run this command? git status');
  });

  it('posts nothing for a command it allows, or when Memnox answered the call itself', async () => {
    const home = await homeAllowing(['Shell(git status)']);
    await noteCursorAsking(shell('git status'), false, context(home));
    await noteCursorAsking(shell('rm -rf build'), true, context(home));
    expect(await new SessionPosts(home).open('2026-10-14T17:00:00.000Z')).toEqual([]);
  });

  it('matches an entry by the start of the command', () => {
    expect(names('git', 'git status')).toBe(true);
    expect(names('git status', 'git status')).toBe(true);
    expect(names('git', 'gitk')).toBe(false);
    expect(names('*', 'anything')).toBe(true);
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POST_KIND, SessionPosts } from '@memnox/core';
import { clearTerminalQuestion, noteTerminalQuestion } from '../src/terminal-question';

const NOW = new Date('2026-10-10T03:00:00.000Z');

async function contextAt(): Promise<Parameters<typeof noteTerminalQuestion>[1]> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-terminal-question-'));
  return { home, agent: 'claude-code', runSession: 'ses_run', now: () => NOW };
}

describe('a question an agent asks in its own terminal', () => {
  it('is posted for the voice when it waits on the person, and taken back by the next hook', async () => {
    const context = await contextAt();
    const asked = {
      hook_event_name: 'Notification',
      session_id: 'abc',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
    };
    expect(await noteTerminalQuestion(asked, context)).toBe(true);
    const posts = new SessionPosts(context.home);
    const post = await posts.read(POST_KIND.ASKING, 'ses_run');
    expect(post?.summary).toContain('Claude needs your permission to use Bash');

    // The tool ran, so the question was answered.
    const next = { hook_event_name: 'PostToolUse', session_id: 'abc' };
    expect(await noteTerminalQuestion(next, context)).toBe(false);
    await clearTerminalQuestion(next, context);
    expect(await posts.read(POST_KIND.ASKING, 'ses_run')).toBeNull();
  });

  it('posts nothing for a notification that waits on nobody', async () => {
    const context = await contextAt();
    const idle = {
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
      message: 'Claude is waiting for your input',
    };
    expect(await noteTerminalQuestion(idle, context)).toBe(true);
    expect(await new SessionPosts(context.home).open(NOW.toISOString())).toEqual([]);
  });
});

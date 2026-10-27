import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TOOL_CLASS, type Containment } from '@memnox/core';
import { EDIT_HOST } from '../src/agent-edits';
import type { ToolCall } from '../src/tool-calls';
import { withinSession } from '../src/within-session';

let repo: string;
let outside: string;
let contained: Containment;

beforeAll(async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'memnox-within-')));
  repo = join(base, 'shop');
  outside = join(base, 'elsewhere');
  await mkdir(join(repo, 'src'), { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(repo, 'link'));
  contained = { root: repo, cwd: repo, home: base };
});

function line(shell: string): ToolCall {
  return {
    host: EDIT_HOST.PRE_TOOL_USE,
    tool: 'Bash',
    sessionId: 's1',
    cwd: repo,
    requests: [],
    shell,
    nativeAsk: true,
  };
}

function write(path: string): ToolCall {
  return {
    host: EDIT_HOST.PRE_TOOL_USE,
    tool: 'Write',
    sessionId: 's1',
    cwd: repo,
    requests: [{ action: 'filesystem.write', target: path, class: TOOL_CLASS.WRITE }],
    nativeAsk: true,
  };
}

describe('a held call answered without a fingerprint', () => {
  it('is one that only deletes or writes inside the repository', () => {
    expect(withinSession(line('rm src/old.ts'), contained, {})).toBe(true);
    expect(withinSession(line('rm -rf build 2>/dev/null'), contained, {})).toBe(true);
    expect(withinSession(write(join(repo, 'src/a.ts')), contained, {})).toBe(true);
  });

  it('is never one that names a path outside, however late in the line', () => {
    expect(withinSession(line('rm -rf build /etc/hosts'), contained, {})).toBe(false);
    expect(withinSession(line('rm src/a && rm ../elsewhere/b'), contained, {})).toBe(
      false,
    );
    expect(withinSession(line('rm ~/notes.txt'), contained, {})).toBe(false);
    expect(withinSession(write(join(outside, 'a.ts')), contained, {})).toBe(false);
  });

  it('follows a link out of the repository rather than trusting its name', () => {
    expect(withinSession(write(join(repo, 'link/a.ts')), contained, {})).toBe(false);
    expect(withinSession(line('rm link/a.ts'), contained, {})).toBe(false);
  });

  it('is never one that moves, expands or runs something it cannot see into', () => {
    expect(withinSession(line('cd .. && rm shop'), contained, {})).toBe(false);
    expect(withinSession(line('rm $HOME/x'), contained, {})).toBe(false);
    expect(withinSession(line('rm {a,/etc/x}'), contained, {})).toBe(false);
    expect(withinSession(line('rm a && python x.py'), contained, {})).toBe(false);
    expect(withinSession(line('git push origin main'), contained, {})).toBe(false);
  });

  it('is never one with no repository to measure it against', () => {
    expect(withinSession(line('rm src/old.ts'), null, {})).toBe(false);
  });
});

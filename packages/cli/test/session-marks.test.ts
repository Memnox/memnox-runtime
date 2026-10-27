import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionHosts } from '@memnox/core';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import { sessionMarks } from '../src/session-tools/session-marks';

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000009';

describe('the lines a session tab is found by', () => {
  it('are its latest request and reply, and only for an app that cannot say which tab is whose', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-marks-'));
    const project = join(home, '.claude', 'projects', 'shop');
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, `${SESSION}.jsonl`),
      [
        {
          type: 'user',
          timestamp: 't1',
          message: { content: 'fix the flaky auth test please' },
        },
        {
          type: 'assistant',
          timestamp: 't2',
          message: {
            content: [{ type: 'text', text: 'The test now waits for the token.' }],
          },
        },
      ]
        .map((each) => JSON.stringify(each))
        .join('\n'),
    );
    // Only the home is read, which is all a deps needs to find the transcript.
    const deps = { home } as SessionToolDeps;
    const host = { sessionId: SESSION, agent: 'claude-code', pid: 1, seenAt: 't0' };
    await new SessionHosts(home).note(host);
    expect(await sessionMarks(deps, SESSION, { ...host, app: 'Ghostty' })).toEqual([
      'fix the flaky auth test please',
      'The test now waits for the token.',
    ]);
    expect(await sessionMarks(deps, SESSION, { ...host, app: 'iTerm2' })).toEqual([]);
  });
});

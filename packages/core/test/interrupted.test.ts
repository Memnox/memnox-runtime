import { describe, expect, it } from 'vitest';
import { interruptedRuns, relaunchOf, type RunTerminal } from '../src/index';

const run = (over: Partial<RunTerminal> = {}): RunTerminal => ({
  sessionId: 'ses_1',
  agent: 'codex',
  pid: 41,
  cwd: '/work',
  startedAt: '2026-11-11T09:00:00.000Z',
  command: ['codex'],
  ...over,
});

describe('a run a crash cut off', () => {
  it('is one whose process is gone and which nothing closed', () => {
    const cut = interruptedRuns(
      [run(), run({ sessionId: 'ses_alive', pid: 42 }), run({ sessionId: 'ses_closed' })],
      [{ sessionId: 'ses_closed', agent: 'codex', pid: 41, seenAt: '', endedAt: 'x' }],
      (pid) => pid === 42,
    );
    expect(cut.map((each) => each.sessionId)).toEqual(['ses_1']);
  });

  it('picks a Codex conversation up with its own resume verb', () => {
    const [cut] = interruptedRuns(
      [run()],
      [{ sessionId: 'ses_1', agent: 'codex', pid: 41, seenAt: '', agentSession: 'c-9' }],
      () => false,
    );
    if (cut === undefined) throw new Error('not found cut off');
    expect(relaunchOf(cut)).toEqual({
      argv: ['run', '--', 'codex', 'resume', 'c-9'],
      resumes: true,
    });
  });

  it('starts fresh, and says so, when it never learned its conversation', () => {
    const [cut] = interruptedRuns([run()], [], () => false);
    if (cut === undefined) throw new Error('not found cut off');
    expect(relaunchOf(cut).resumes).toBe(false);
  });
});

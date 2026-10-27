import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTE_KIND } from '@memnox/core';
import { turnEndKinds } from '../src/edit-pause';
import { SESSION_MOMENT } from '../src/session-events';

/* Ana's frontend agent finished its turn. Andre's backend agent asks it which fields the page
   sends. The question reaches it anyway, so the two settle it without Ana; but two agents
   thanking each other must never keep both running, so a question wakes it at most every
   two minutes. */

const MINUTE_MS = 60_000;

describe('a question from another agent at the end of a turn', () => {
  it('wakes the session, at most every two minutes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-wake-'));
    // The mark is the file's own time on disk, so the clock starts from the real one.
    let now = Date.now();
    const context = {
      home,
      agent: 'claude-code',
      pid: 1,
      cwd: home,
      now: () => new Date(now),
    };
    const pause = {
      moment: SESSION_MOMENT.TURN_END,
      sessionId: 'ses_ana',
      host: 'pre-tool-use',
    };

    expect(await turnEndKinds(pause as never, context as never)).toEqual([
      NOTE_KIND.OPERATOR,
      NOTE_KIND.AGENT_ASK,
    ]);
    now += MINUTE_MS;
    expect(await turnEndKinds(pause as never, context as never)).toEqual([
      NOTE_KIND.OPERATOR,
    ]);
    now += MINUTE_MS + 1_000;
    expect(await turnEndKinds(pause as never, context as never)).toContain(
      NOTE_KIND.AGENT_ASK,
    );
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT, NOTICE_KIND, type DaemonEvent } from '@memnox/core';
import { NewsTold } from '../src/daemon/news-told';

const AT = '2026-10-10T10:28:00.000Z';

const PAUSED: DaemonEvent = {
  kind: DAEMON_EVENT.PAUSED,
  subject: 'ses_runtime',
  agent: 'claude-code',
  summary: 'git symbolic-ref failed five times in a row',
  at: AT,
  sessionId: 'ses_runtime',
};

const HELD: DaemonEvent = {
  kind: DAEMON_EVENT.HELD,
  subject: 'apr_push',
  agent: 'claude-code',
  summary: 'push to main',
  at: AT,
};

const ASKING: DaemonEvent = {
  kind: DAEMON_EVENT.NOTICE,
  notice: NOTICE_KIND.ASKING,
  subject: 'asking_trust',
  agent: 'claude-code',
  summary: 'Do you trust this folder?',
  at: AT,
};

async function told(): Promise<NewsTold> {
  return new NewsTold(await mkdtemp(join(tmpdir(), 'memnox-news-')));
}

describe('news the Mac app hears when it opens', () => {
  it('says a paused session once, however often the app is reopened', async () => {
    const news = await told();
    expect(await news.firstHeard([PAUSED], false)).toEqual([PAUSED]);
    expect(await news.firstHeard([PAUSED], false)).toEqual([]);
  });

  it('asks again what waits on an answer, every time it opens', async () => {
    const news = await told();
    await news.firstHeard([HELD, ASKING], false);
    expect(await news.firstHeard([HELD, ASKING], false)).toEqual([HELD, ASKING]);
  });

  it('says a session paused again once the earlier pause was resumed', async () => {
    const news = await told();
    await news.firstHeard([PAUSED], false);
    await news.keep([]);
    expect(await news.firstHeard([PAUSED], false)).toEqual([PAUSED]);
  });

  it('leaves a phone hearing everything it can answer', async () => {
    const news = await told();
    await news.firstHeard([PAUSED], false);
    expect(await news.firstHeard([PAUSED], true)).toEqual([PAUSED]);
  });
});

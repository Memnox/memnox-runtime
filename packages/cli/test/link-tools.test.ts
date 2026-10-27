import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISPLAY, DisplayRequests, type DisplayDelivery } from '@memnox/core';
import { openLinkTool, searchWebTool } from '../src/session-tools/link-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';

/** The voice says where a page opened from whoever opened it, so a phone's page is never called the Mac's. */

const NOW = new Date('2026-10-15T09:00:00.000Z');
const PAGE = 'https://github.com/acme/shop/pull/49';

async function depsWith(delivery: DisplayDelivery | null): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-link-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({}),
    milestonesAt: async () => [],
    brief: async () => null,
    delivered: async () => delivery,
  };
}

describe('opening a page by voice', () => {
  it('asks for the one web page, and says it opened on the phone that opened it', async () => {
    const deps = await depsWith({
      outcome: 'typed',
      at: NOW.toISOString(),
      on: 'iPhone',
    });

    const answer = (await openLinkTool(deps, { url: PAGE })) as Record<string, unknown>;

    expect(answer).toMatchObject({ opened: PAGE, on: 'iPhone' });
    expect(String(answer['said'])).toContain('on their iPhone');
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: DISPLAY.LINK,
      sessionId: 'all',
      links: [PAGE],
    });
  });

  it('says the Mac when the Mac opened it, sorry when nothing did, and should be when nobody said', async () => {
    const mac = await openLinkTool(
      await depsWith({ outcome: 'typed', at: NOW.toISOString() }),
      { url: PAGE },
    );
    expect(mac).toMatchObject({ on: 'the Mac' });

    const failed = await openLinkTool(
      await depsWith({ outcome: 'failed', at: NOW.toISOString(), reason: 'no browser' }),
      { url: PAGE },
    );
    expect(failed).toMatchObject({ opened: false, why: 'no browser' });

    const quiet = (await openLinkTool(await depsWith(null), { url: PAGE })) as Record<
      string,
      unknown
    >;
    expect(quiet['on']).toBeUndefined();
    expect(String(quiet['said'])).toContain('should be opening');
  });

  it('refuses anything but a web address with no sign in folded in', async () => {
    const deps = await depsWith(null);
    for (const url of [
      'file:///etc/passwd',
      'slack://open',
      'https://me:pw@github.com/x',
      '',
    ])
      expect(await openLinkTool(deps, { url }), url).toMatchObject({ opened: false });
  });
});

describe('searching the web by voice', () => {
  it('opens the results page for their words in the browser', async () => {
    const deps = await depsWith({ outcome: 'typed', at: NOW.toISOString() });
    const answer = (await searchWebTool(deps, { query: 'flights to Oslo' })) as Record<
      string,
      unknown
    >;
    expect(answer['opened']).toBe('https://www.google.com/search?q=flights+to+Oslo');
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({
      display: DISPLAY.LINK,
      links: ['https://www.google.com/search?q=flights+to+Oslo'],
    });
  });

  it('asks for the words rather than opening an empty search', async () => {
    const deps = await depsWith(null);
    expect(await searchWebTool(deps, { query: '  ' })).toMatchObject({ opened: false });
    expect(await new DisplayRequests(deps.home).open(NOW.toISOString())).toEqual([]);
  });
});

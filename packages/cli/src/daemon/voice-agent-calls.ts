import {
  DAEMON_METHOD,
  type DaemonRequest,
  type DaemonResponse,
  type VoiceAgentStatus,
} from '@memnox/core';

/** Which agents can be the voice and the person's pick among them; a refusal is the string. */
export interface VoiceAgentRoster {
  list(recheck?: boolean): Promise<VoiceAgentStatus[]>;
  choose(kind: string): Promise<VoiceAgentStatus[] | string>;
}

export function isVoiceAgentMethod(method: string): boolean {
  return (
    method === DAEMON_METHOD.VOICE_AGENTS || method === DAEMON_METHOD.CHOOSE_VOICE_AGENT
  );
}

/** The Mac app's settings asking which agents can be the voice, or picking one; a recheck takes a while. */
export async function answerVoiceAgents(
  request: DaemonRequest,
  roster: VoiceAgentRoster | undefined,
): Promise<DaemonResponse> {
  if (request.method === DAEMON_METHOD.VOICE_AGENTS) {
    if (roster === undefined) {
      return { id: request.id, ok: false, error: 'no voice agents are configured' };
    }
    return { id: request.id, ok: true, voiceAgents: await roster.list(request.recheck) };
  }
  if (roster === undefined || request.voiceAgent === undefined) {
    return { id: request.id, ok: false, error: 'choosing needs an agent' };
  }
  const chosen = await roster.choose(request.voiceAgent);
  return typeof chosen === 'string'
    ? { id: request.id, ok: false, error: chosen }
    : { id: request.id, ok: true, voiceAgents: chosen };
}

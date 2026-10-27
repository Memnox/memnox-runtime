import { WORKSPACE_ASK, WorkspaceAsks, type WorkspaceAskKind } from '@memnox/core';
import { acknowledgeIncident, rejectException } from '../sync/workspace-asks';
import type { PersonCall } from '../sync/person-post';
import type { OperatorCall } from './operator-call';
import type { SessionToolDeps } from './read-tools';
import type { ToolDefinition } from './session-tools';

/**
 * Acting by voice on what the workspace just asked of the person, where nothing is loosened:
 * taking an incident, and saying no to an exception. Approving an exception is the console's,
 * and a call short of its approvals is answered on its own card with Touch ID.
 */

export const WORKSPACE_ASK_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'acknowledge_incident',
    description:
      'Take the incident you just told the person about, when they say to acknowledge it, take it or that they are on it, so the workspace stops telling everybody else and records that they have it. It changes nothing an agent may do. Do it at once, with no read back.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'reject_exception',
    description:
      'Say no to the exception you just told the person somebody asked for, when they say no, reject it or not now. Saying no publishes nothing and loosens nothing, so do it at once. Never use it to approve: approving loosens a workspace rule and is done in the console, which you tell them.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

export const WORKSPACE_ASK_CALLS: Readonly<Record<string, OperatorCall>> = {
  acknowledge_incident: (deps) =>
    actOnNewest(deps, WORKSPACE_ASK.INCIDENT, 'incident', acknowledgeIncident),
  reject_exception: (deps) =>
    actOnNewest(deps, WORKSPACE_ASK.EXCEPTION, 'exception request', rejectException),
};

/** The newest open ask of a kind, acted on once, said back in words the voice can use. */
async function actOnNewest(
  deps: SessionToolDeps,
  kind: WorkspaceAskKind,
  named: string,
  act: (home: string, id: string) => Promise<PersonCall>,
): Promise<unknown> {
  const asks = new WorkspaceAsks(deps.home);
  const moment = deps.now().toISOString();
  const ask = await asks.newest(kind, moment);
  if (ask === null) {
    return {
      done: false,
      said: `No ${named} is waiting on them right now. Say so in a sentence.`,
    };
  }
  const sent = await act(deps.home, ask.id);
  if (!sent.ok) {
    return {
      done: false,
      said: `${sent.said} Say that plainly, and never say it was done.`,
    };
  }
  await asks.settled(ask, moment);
  return { done: true, said: `Done for the ${named}. Say so in a few words.` };
}

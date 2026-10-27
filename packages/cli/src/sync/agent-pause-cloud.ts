import {
  agentIdFor,
  HTTP,
  orgConditionsPathFor,
  readAccount,
  readJsonFile,
  writeOrgConditions,
  type OrgConditionsFile,
} from '@memnox/core';
import { callCloud, CloudUnreachable } from './client';

/**
 * A pause said on this machine, told to the workspace as a freeze on this machine's own agents, so
 * teammates see it. Sent on the machine's own credential, which the cloud pins to this machine and
 * records with the person who owns it, so a pause needs nobody signed in and no admin role.
 */

/** Short, because the person already heard the agent stop and is waiting on a sentence. */
const TOLD_TIMEOUT_MS = 4_000;

export const WORKSPACE_TOLD = {
  TOLD: 'told',
  /** Not enrolled, or the enrolment was revoked, so there is no workspace to tell. */
  NO_WORKSPACE: 'no workspace',
  REFUSED: 'refused',
  UNREACHABLE: 'unreachable',
} as const;

export type WorkspaceTold = (typeof WORKSPACE_TOLD)[keyof typeof WORKSPACE_TOLD];

export interface ToldWorkspace {
  outcome: WorkspaceTold;
  /** The workspace's condition id, when it took the freeze. */
  conditionId?: string;
  /** The workspace's own sentence when it refused. */
  said?: string;
}

export type CloudCall = typeof callCloud;

interface Caller {
  baseUrl: string;
  token: string;
  workspaceId: string;
}

/** This machine's enrolment, or null where it has none to speak with. */
async function callerOf(home: string): Promise<Caller | null> {
  const account = await readAccount(home);
  if (account === null || account.revokedAt !== undefined) return null;
  return {
    baseUrl: account.baseUrl,
    token: account.token,
    workspaceId: account.workspaceId,
  };
}

/** The cloud's route for a machine's freeze on itself, which takes the machine from the credential. */
function machineFreezesPath(caller: Caller, rest = ''): string {
  return `/v1/workspaces/${encodeURIComponent(caller.workspaceId)}/state/machine-freezes${rest}`;
}

interface DeclareInput {
  kind: string;
  why: string;
  validUntil: string;
}

/** Declares the freeze on this agent on this machine alone; the cloud adds the machine itself. */
export async function declareAgentFreeze(
  home: string,
  input: DeclareInput,
  call: CloudCall = callCloud,
): Promise<ToldWorkspace> {
  const caller = await callerOf(home);
  if (caller === null) return { outcome: WORKSPACE_TOLD.NO_WORKSPACE };
  return told(async () => {
    const answer = await call<{ id?: unknown }>({
      baseUrl: caller.baseUrl,
      path: machineFreezesPath(caller),
      method: 'POST',
      token: caller.token,
      timeoutMs: TOLD_TIMEOUT_MS,
      body: {
        // No machine here: the cloud pins it from the credential, so a teammate's copy keeps working.
        agents: [agentIdFor(input.kind)],
        value: input.why,
        validUntil: input.validUntil,
      },
    });
    const id = answer.body?.id;
    if (!succeeded(answer.status) || typeof id !== 'string') return refusedBy(answer);
    return { outcome: WORKSPACE_TOLD.TOLD, conditionId: id };
  });
}

/**
 * Lifts the workspace's freeze, and drops it from this machine's copy at once rather than at the next
 * pull. The cloud lets a machine lift only what it declared, so a freeze a person put on this agent
 * answers as refused and stays held.
 */
export async function liftAgentFreeze(
  home: string,
  conditionId: string,
  call: CloudCall = callCloud,
): Promise<ToldWorkspace> {
  const caller = await callerOf(home);
  if (caller === null) return { outcome: WORKSPACE_TOLD.NO_WORKSPACE };
  return told(async () => {
    const answer = await call<unknown>({
      baseUrl: caller.baseUrl,
      path: machineFreezesPath(caller, `/${encodeURIComponent(conditionId)}/lift`),
      method: 'POST',
      token: caller.token,
      timeoutMs: TOLD_TIMEOUT_MS,
    });
    // Already ended there is what was wanted, so it reads as lifted.
    if (!succeeded(answer.status) && answer.status !== HTTP.CONFLICT)
      return refusedBy(answer);
    await forgetPulledCondition(home, conditionId);
    return { outcome: WORKSPACE_TOLD.TOLD, conditionId };
  });
}

async function told(send: () => Promise<ToldWorkspace>): Promise<ToldWorkspace> {
  try {
    return await send();
  } catch (err) {
    if (err instanceof CloudUnreachable) return { outcome: WORKSPACE_TOLD.UNREACHABLE };
    throw err;
  }
}

function succeeded(status: number): boolean {
  return status >= HTTP.OK && status < HTTP.MULTIPLE_CHOICES;
}

function refusedBy(answer: { status: number; body?: unknown }): ToldWorkspace {
  const body = answer.body;
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message) // narrowed by the `in` check above
      : `The workspace answered ${answer.status}.`;
  return { outcome: WORKSPACE_TOLD.REFUSED, said: message };
}

/** The bundle names a condition `<id>:<subject>`, one per scope entry, so both spellings go. */
async function forgetPulledCondition(home: string, conditionId: string): Promise<void> {
  const held = await readJsonFile<Partial<OrgConditionsFile>>(orgConditionsPathFor(home));
  if (
    held === null ||
    !Array.isArray(held.conditions) ||
    typeof held.syncedAt !== 'number'
  )
    return;
  const kept = held.conditions.filter(
    (condition) =>
      condition.id !== conditionId && !condition.id.startsWith(`${conditionId}:`),
  );
  if (kept.length === held.conditions.length) return;
  await writeOrgConditions(home, { syncedAt: held.syncedAt, conditions: kept });
}

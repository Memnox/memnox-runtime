import { FetchCloud, type CloudPort } from './cloud';
import { DEFAULT_CLOUD_URL, GUARD_ENV } from './guard.constants';
import { Guard, type GuardOptions } from './guard';

export * from './actions';
export * from './claude-agent-sdk';
export * from './cloud';
export * from './guard';
export * from './guard.constants';
export * from './openai-agents';
export * from './wrap';

export interface CreateGuardOptions extends Partial<GuardOptions> {
  workspace?: string;
  token?: string;
  baseUrl?: string;
  /** Injected in place of the control plane, as a test does. */
  cloud?: CloudPort;
}

/**
 * A started guard, its settings read from the environment where they are not passed, so
 * the one line an agent needs is `const guard = createGuard()`.
 */
export function createGuard(options: CreateGuardOptions = {}): Guard {
  const agent = options.agent ?? process.env[GUARD_ENV.AGENT];
  if (agent === undefined || agent === '') {
    throw new Error(`Name the agent, as createGuard({ agent }) or ${GUARD_ENV.AGENT}.`);
  }
  const cloud = options.cloud ?? cloudFromSettings(options);
  return new Guard(cloud, { ...options, agent }).start();
}

function cloudFromSettings(options: CreateGuardOptions): CloudPort {
  const token = options.token ?? process.env[GUARD_ENV.TOKEN];
  const workspace = options.workspace ?? process.env[GUARD_ENV.WORKSPACE];
  if (
    token === undefined ||
    token === '' ||
    workspace === undefined ||
    workspace === ''
  ) {
    throw new Error(
      `A guard needs the agent's credential and workspace, as options or ${GUARD_ENV.TOKEN} and ${GUARD_ENV.WORKSPACE}.`,
    );
  }
  const baseUrl = options.baseUrl ?? process.env[GUARD_ENV.URL] ?? DEFAULT_CLOUD_URL;
  return new FetchCloud({ baseUrl, workspace, token });
}

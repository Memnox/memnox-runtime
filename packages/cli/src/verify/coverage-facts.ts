import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CoverageFacts } from '@memnox/core';

import { readHealth } from '../health-probe';
import { guardProfilePath } from '../memnox-paths';
import { holdsOwnPolicyHook } from '../protect/agent-hooks';
import { DEFAULT_SHELL, loginPathConfigured } from '../protect/shell-profile';

/** What holds an agent's surfaces, read fresh from this machine, so wiring something up changes the answer. */

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy'] as const;

/** Where coverage is read from: this directory, this home and this environment. */
export interface CoverageFactsInput {
  dir: string;
  home: string;
  env: NodeJS.ProcessEnv;
  /** The agent's kind, since its own hook is in its own settings file. */
  agent: string;
}

/** The facts coverage is decided from, read fresh, so wiring something up changes the answer. */
export async function readCoverageFacts(input: CoverageFactsInput): Promise<CoverageFacts> {
  const { dir, home, env, agent } = input;
  const health = await readHealth(home, dir, env);
  return {
    interceptorsInstalled: health.interceptorsInstalled.length > 0,
    interceptorsFirstOnPath: health.interceptorDirFirstOnPath,
    gitHooksInstalled: existsSync(join(dir, '.git', 'hooks', 'pre-push')),
    osGuardWritten: existsSync(guardProfilePath(home)),
    egressProxySet: PROXY_VARS.some((name) => (env[name] ?? '') !== ''),
    loginPathConfigured: await loginPathConfigured(env['SHELL'] ?? DEFAULT_SHELL, home),
    rulesRegistered: health.registeredFiles.length > 0,
    ownPolicyHook: await holdsOwnPolicyHook(home, agent),
  };
}

/**
 * The facts with what depends on the reading process taken out, so a background service and a
 * shell compute one digest: PATH from the login profile, no proxy variable, no repository's hooks.
 */
export function processIndependent(facts: CoverageFacts): CoverageFacts {
  return {
    ...facts,
    interceptorsFirstOnPath: facts.loginPathConfigured,
    egressProxySet: false,
    gitHooksInstalled: false,
  };
}

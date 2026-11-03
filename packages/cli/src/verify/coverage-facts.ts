import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CoverageFacts } from '@memnox/core';

import { readHealth } from '../health-probe';
import { guardProfilePath } from '../memnox-paths';
import { holdsOwnPolicyHook } from '../protect/agent-hooks';
import { DEFAULT_SHELL, loginPathConfigured } from '../protect/shell-profile';

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
 * The same facts with what depends on the reading process taken out, so the digest a
 * background service computes matches the one a shell computed: PATH order is read from
 * the login profile every process shares, and neither a proxy variable nor the hooks in
 * whichever repository the reader stands in belongs to the machine.
 */
export function processIndependent(facts: CoverageFacts): CoverageFacts {
  return {
    ...facts,
    interceptorsFirstOnPath: facts.loginPathConfigured,
    egressProxySet: false,
    gitHooksInstalled: false,
  };
}

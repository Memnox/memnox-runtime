import { homedir } from 'node:os';

import {
  CODE_FINGERPRINT_FILE,
  FileAllowances,
  fingerprintPolicies,
  loadPolicyFiles,
  parentAgentsOf,
  readCodeFingerprint,
  type Policy,
  LocalGate,
  openNotice,
  SessionTasks,
  overlaysInForce,
  stateLabelsOf,
  type Containment,
  type SessionTask,
  RepositoryTasks,
} from '@memnox/core';

import { repositoryRootOf } from './seam-runtime';
import { strainHolding } from './breaker-seam';

import { containmentFor } from './containment-loader';
import type { HookConfig } from './hook-config';
import { DEFAULT_AGENT_NAME } from './tool-hook.constants';

/** Where a command runs and with what, which the daemon is handed rather than inherits. */
export interface SeamScene {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Asked three times per load, so a caller that can answer it once passes this. */
  rootOf?: (cwd: string) => string | null;
}

function ownScene(): SeamScene {
  return { cwd: process.cwd(), env: process.env };
}

/**
 * Null leaves the runtime as the only gate: no rule file and nothing to contain.
 */
export async function loadHookGate(
  config: HookConfig,
  home: string = homedir(),
  now: () => string = () => new Date().toISOString(),
  warn: (message: string) => void = (message) => {
    process.stderr.write(`[memnox] ${message}\n`);
  },
  scene: SeamScene = ownScene(),
): Promise<LocalGate | null> {
  const { task, containment } = await readSession(config, home, now, scene);
  const fingerprint = await fingerprintRules(warn, scene);
  if (
    config.policyFiles.length === 0 &&
    containment === null &&
    fingerprint.length === 0
  ) {
    return null;
  }
  const overlays = await overlaysInForce(home);

  // A registered file that is gone stopped every command on the machine, git included,
  // so it is skipped out loud and the rules that are still there stay in force.
  const sources = config.fromRegistry
    ? {
        optional: new Set(config.policyFiles),
        onSkipped: (file: string) => {
          warn(
            `${file} is registered but gone, so its rules are not in force. ` +
              '"memnox policy check --prune" forgets it.',
          );
        },
      }
    : undefined;

  const gate = new LocalGate(
    [...(await loadPolicyFiles(config.policyFiles, sources)), ...fingerprint],
    {
      agentName: config.agentName ?? DEFAULT_AGENT_NAME,
      ...(config.agentRole === undefined ? {} : { agentRole: config.agentRole }),
      ...(config.principal === undefined ? {} : { principal: config.principal }),
      task,
      stateFacts: stateLabelsOf(overlays, now()),
      ...(containment === null ? {} : { containment }),
      allowances: await new FileAllowances(home).inForce(now()),
      // An agent another agent started is held to that agent's rules as well as its own.
      parents: parentAgentsOf(scene.env, config.agentName ?? DEFAULT_AGENT_NAME),
      strain: await strainHolding(
        home,
        config.sessionId ?? config.hostSessionId,
        config.agentName ?? DEFAULT_AGENT_NAME,
      ),
    },
  );
  return noticing(gate, config, home);
}

/**
 * The conventions the repository the agent works in states for itself, as rules. A check
 * that could not be read is skipped out loud, since one bad entry must not stop every write.
 */
async function fingerprintRules(
  warn: (message: string) => void,
  scene: SeamScene,
): Promise<Policy[]> {
  const root = (scene.rootOf ?? repositoryRootOf)(scene.cwd);
  if (root === null) return [];
  const fingerprint = await readCodeFingerprint(root);
  if (fingerprint === null) return [];
  for (const issue of fingerprint.issues) {
    warn(`${CODE_FINGERPRINT_FILE}: ${issue}, so it is not enforced.`);
  }
  return fingerprintPolicies(fingerprint, root);
}

/**
 * The same agent and session every seam of one run resolves, so a credential read by
 * one seam and a push through another are seen as one session.
 */
async function noticing(
  gate: LocalGate,
  config: HookConfig,
  home: string,
): Promise<LocalGate> {
  const sessionId = config.sessionId;
  gate.attachNotice(
    await openNotice(home, {
      agent: config.agentName ?? DEFAULT_AGENT_NAME,
      ...(sessionId === undefined ? {} : { sessionId }),
    }),
  );
  return gate;
}

/**
 * Read at the moment of the decision, so a freeze or a task declared mid-run bites the
 * next command, and containment needs no rule file, so a machine with none keeps writes home.
 */
async function readSession(
  config: HookConfig,
  home: string,
  now: () => string,
  scene: SeamScene,
): Promise<{ task: SessionTask | null; containment: Containment | null }> {
  const sessionId = config.sessionId ?? config.hostSessionId;
  const declared =
    sessionId === undefined ? null : await new SessionTasks(home).read(sessionId);
  // A session nobody named a task for takes the one somebody declared for its repository.
  const task =
    declared ??
    (await new RepositoryTasks(home).inForce(
      (scene.rootOf ?? repositoryRootOf)(scene.cwd),
      now(),
    ));
  const containment = await containmentFor({
    home,
    env: scene.env,
    cwd: scene.cwd,
    ...(scene.rootOf === undefined ? {} : { rootOf: scene.rootOf }),
    now: new Date(now()),
    ...(config.agentName === undefined ? {} : { agent: config.agentName }),
    ...(task?.scope.paths === undefined ? {} : { paths: task.scope.paths }),
  });
  return { task, containment };
}

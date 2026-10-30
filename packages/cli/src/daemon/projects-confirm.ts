import { existsSync } from 'node:fs';
import {
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  projectIdOf,
  readHub,
  readProjectState,
  withAssignment,
  writeProjectState,
  type ProjectChange,
  type ProposedChange,
} from '@memnox/core';
import { syncHub } from '../mcp/hub-writer';
import { registerPolicyFile } from '../policy-registry';
import { isInside } from '../projects/project-changes';
import { applySkillsProposal } from './skills-hub-confirm';

/**
 * A signed project proposal carried out: its servers given to its agents, its skills written into
 * the repository for them, and its rule file put in force. Each is checked again, since a proposal
 * file can be written by hand and the hubs may have moved since it was raised.
 */

type Settled = { ok: true; outcome: string } | { ok: false; error: string };

/** Null where the proposal is not a project's, so the caller carries on. */
export async function applyProjectProposal(
  home: string,
  change: ProposedChange,
  now: Date,
): Promise<Settled | null> {
  if (change.kind !== PROPOSAL_KIND.PROJECT) return null;
  const project = change.project;
  if (projectIdOf(project.root) !== project.projectId || !existsSync(project.root))
    return {
      ok: false,
      error: `${project.root} is no longer the project that was proposed`,
    };
  const servers = await giveServers(home, project);
  const refused: string[] = [];
  for (const skill of project.skills) {
    const given = await applySkillsProposal(home, { assign: skill }, now);
    if (!given.ok) refused.push(given.error);
  }
  const policy = await putRulesInForce(home, project);
  const state = await readProjectState(home, project.projectId);
  if (state !== null)
    await writeProjectState(home, { ...state, appliedAt: now.toISOString() });
  const done = `${PROPOSAL_ANSWER.CONFIRMED}: ${servers} server grant${servers === 1 ? '' : 's'}, ${project.skills.length - refused.length} skill grant${project.skills.length - refused.length === 1 ? '' : 's'}${policy ? ', and its rule file in force' : ''}`;
  return refused.length === 0
    ? { ok: true, outcome: done }
    : { ok: true, outcome: `${done}; not given: ${refused.join(' ')}` };
}

/** Each server still in the hub given to its agent, written into every config in one pass. */
async function giveServers(home: string, project: ProjectChange): Promise<number> {
  let hub = await readHub(home);
  const known = project.servers.filter((each) =>
    hub.servers.some((server) => server.name === each.server),
  );
  if (known.length === 0) return 0;
  for (const assignment of known) hub = withAssignment(hub, assignment, true);
  await syncHub(home, hub);
  return known.length;
}

/** Only a file inside the repository that is still there; anything else was not what was shown. */
async function putRulesInForce(home: string, project: ProjectChange): Promise<boolean> {
  const policy = project.policy;
  if (policy === undefined || !isInside(project.root, policy) || !existsSync(policy))
    return false;
  await registerPolicyFile(home, policy);
  return true;
}

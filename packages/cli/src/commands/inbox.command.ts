/**
 * `memnox inbox`: everything waiting on you, in one list: the calls this machine is holding and
 * the questions your team routed to you, labelled with the agent and the machine they came from.
 */

import { homedir } from 'node:os';
import type { Command } from 'commander';
import { describePending, EXIT, PendingApprovals } from '@memnox/core';
import type { CliContext } from '../cli-context';
import { TONE, type FlowItem } from '../flow';
import {
  readPerson,
  teamHeld,
  type PersonCredential,
  type TeamHeld,
} from '../sync/person';

interface InboxDeps {
  home: () => string;
  now: () => Date;
}

export function registerInboxCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<InboxDeps> = {},
): void {
  const deps: InboxDeps = { home: homedir, now: () => new Date(), ...overrides };
  program
    .command('inbox')
    .description('Everything waiting on you: this machine and your workspace')
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      process.exitCode = await runInbox(context, deps, options.json === true);
    });
}

async function runInbox(
  context: CliContext,
  deps: InboxDeps,
  json: boolean,
): Promise<number> {
  const moment = deps.now().toISOString();
  const here = await new PendingApprovals(deps.home()).list(moment);
  const person = await readPerson(deps.home());
  const { team, failed: teamFailed } = await readTeam(person);
  if (json) {
    context.out.json({ here, team });
    return EXIT.OK;
  }
  const { flow } = context;
  flow.open('memnox inbox');
  const items: FlowItem[] = [
    ...here.map((each) => ({
      tone: TONE.WARN,
      text: `${each.id}  ${describePending(each, moment)}`,
      detail: ['on this machine'],
    })),
    ...team.map(teamItem),
  ];
  if (teamFailed !== null) flow.aside(teamFailed);
  if (items.length === 0) {
    flow.close('Nothing is waiting on you.');
  } else {
    flow.list(countLine(here.length, team.length), items);
    flow.close(
      'memnox approve <id> allows once, --session for the rest of it, memnox deny <id> refuses.',
    );
  }
  if (person === null)
    flow.hint('memnox signin   also shows what your workspace routes to you');
  return EXIT.OK;
}

/** What the team routed here, or why it could not be read, which is said rather than hidden. */
async function readTeam(
  person: PersonCredential | null,
): Promise<{ team: TeamHeld[]; failed: string | null }> {
  if (person === null) return { team: [], failed: null };
  try {
    return { team: await teamHeld(person), failed: null };
  } catch (err) {
    return { team: [], failed: err instanceof Error ? err.message : String(err) };
  }
}

/** "Codex on build-box", with the team's wording when it was widened to more people. */
function teamItem(held: TeamHeld): FlowItem {
  const machine = held.machineLabel ?? held.machineId;
  const needs = held.approvalsNeeded > 1 ? `, needs ${held.approvalsNeeded} people` : '';
  return {
    tone: TONE.WARN,
    text: `${held.id}  ${held.agent} on ${machine} wants to ${held.summary ?? held.operation}`,
    detail: [
      `${held.escalated ? 'asked of your team' : 'asked of you'}${needs}`,
      held.reason,
    ],
  };
}

/** Counts, the same way every other door says them: "3 waiting: 2 here, 1 from your team". */
function countLine(here: number, team: number): string {
  const total = here + team;
  if (team === 0) return `${total} waiting here`;
  if (here === 0) return `${total} waiting from your team`;
  return `${total} waiting: ${here} here, ${team} from your team`;
}

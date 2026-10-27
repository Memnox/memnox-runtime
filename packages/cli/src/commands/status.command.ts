/**
 * `memnox status`: where this machine stands, on one screen. What bare `memnox` shows once
 * setup has run, because after that the question is no longer what is here but whether it
 * is held.
 */
import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  DECISION_EFFECT,
  describeReach,
  DORMANT_AFTER_DAYS,
  ENFORCEMENT_MODE,
  LEDGER_SCAN_LIMIT,
  probationsInForce,
  ProbationRegister,
  readAccount,
  readProtectionStop,
  stopHasEnded,
  type Account,
  type HomeReady,
  type HomeWorking,
  type ProtectionStop,
  type ProbationEntry,
  type HealthFacts,
  type MemnoxEvent,
} from '@memnox/core';
import type { CliContext } from '../cli-context';
import type { FlowRow } from '../flow';
import { withEvents } from '../event-store';
import { readHealth } from '../health-probe';
import { defaultScanSeams } from '../machine-scan';
import { policySetInForce } from '../policy-path';
import { describeCount } from '../plural';
import { readKept, type Kept } from '../keeper/kept';
import { EDIT_HOOK_TARGETS } from '../protect/agent-hooks';
import { describeProbations } from '../probation-view';
import { readDormantHere } from '../keeper/keep-dormant';
import { readHome } from '../daemon/home-answer';
import { SessionViews } from '../daemon/session-view';

/** Whether anything is holding the boundary setup drew, as the screen says it. */
const DAEMON_STATE = {
  KEEPING: 'keeping',
  SILENT: 'not answering',
  ABSENT: 'not installed',
} as const;

type DaemonState = (typeof DAEMON_STATE)[keyof typeof DAEMON_STATE];

/** What one screen reports, read once so the rendering stays a pure function of it. */
interface MachineStatus {
  setUp: boolean;
  mode: string;
  daemon: DaemonState;
  agents: number;
  hooked: string[];
  /** Agents found here that setup can hook and has not, the only ones Protect my agents can still cover. */
  unhooked: string[];
  mcpServers: number;
  mcpWrapped: number;
  rules: number;
  today: { actions: number; asked: number; denied: number };
  waiting: number;
  paused: number;
  workspace: string | null;
  /** The workspace let this machine go: revoked it, or removed it. Absent is no. */
  removed?: boolean;
  /** Agents silent in the ledger for a month that still hold reach, by the name a person types. */
  dormant: { name: string; reach: string }[];
  /** Agents and servers still on probation, and when each ends on its own. */
  probation?: ProbationEntry[];
  /** Set while `memnox stop` holds, which is the first thing this screen has to say. */
  stopped?: ProtectionStop;
}

interface StatusDeps {
  home: () => string;
  project: () => string;
  read: (home: string, project: string) => Promise<MachineStatus>;
  /** What is working and what could be handed over, the two home blocks status had no row for. */
  ahead: (home: string) => Promise<Ahead>;
}

/** The home's working and ready blocks, as the Mac and the iPhone show them. */
interface Ahead {
  working: HomeWorking[];
  ready?: HomeReady;
}

export function registerStatusCommand(
  program: Command,
  context: CliContext,
  overrides: Partial<StatusDeps> = {},
): void {
  const deps: StatusDeps = {
    home: homedir,
    project: () => process.cwd(),
    read: readStatus,
    ahead: readAhead,
    ...overrides,
  };
  program
    .command('status')
    .description('Where this machine stands: what is held, and what happened today')
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const status = await deps.read(deps.home(), deps.project());
      const ahead = status.setUp
        ? await deps.ahead(deps.home()).catch((): Ahead => ({ working: [] }))
        : { working: [] };
      if (options.json === true) {
        context.out.json({ ...status, ...ahead });
        return;
      }
      renderStatus(context, status, ahead);
    });
}

/** Reads the machine: the kept boundary, the health doctor reads, the ledger since midnight. */
export async function readStatus(home: string, project: string): Promise<MachineStatus> {
  const { snapshots } = defaultScanSeams(project);
  const [kept, health, rules, snapshot, account, today, dormant, probation, stop] =
    await Promise.all([
      readKept(home),
      readHealth(home, project),
      policySetInForce(home),
      snapshots.latest(),
      readAccount(home),
      todaysEvents(home),
      readDormantHere(home, snapshots, new Date()),
      new ProbationRegister(home).all(),
      readProtectionStop(home),
    ]);
  return {
    setUp: kept !== null,
    mode: health.mode,
    daemon: daemonOf(health),
    agents: snapshot === null ? 0 : snapshot.agents.length,
    hooked: hookedOf(kept),
    unhooked: unhookedOf(snapshot === null ? [] : snapshot.agents, hookedOf(kept)),
    mcpServers: health.mcpServers,
    mcpWrapped: health.mcpWrapped,
    rules: rules.policies.length,
    today: tally(today),
    waiting: health.waitingApprovals,
    paused: health.pausedSessions,
    workspace: workspaceOf(account),
    removed: account !== null && account.revokedAt !== undefined,
    dormant: dormant.map((agent) => ({
      name: agent.name,
      reach: describeReach(agent.reach),
    })),
    probation: probationsInForce(probation, new Date()),
    ...(stop === null || stopHasEnded(stop, new Date()) ? {} : { stopped: stop }),
  };
}

async function todaysEvents(home: string): Promise<MemnoxEvent[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  try {
    return await withEvents(home, (store) =>
      store.query({ since: midnight.toISOString(), limit: LEDGER_SCAN_LIMIT }),
    );
  } catch {
    // No ledger yet is a machine nothing has run on, which is zero of everything.
    return [];
  }
}

/** Counted by what enforce would have said, so observe mode shows what it would have stopped. */
function tally(events: readonly MemnoxEvent[]): MachineStatus['today'] {
  const said = events.map((event) => event.shadowEffect ?? event.effect);
  return {
    actions: events.length,
    asked: said.filter((effect) => effect === DECISION_EFFECT.ASK).length,
    denied: said.filter((effect) => effect === DECISION_EFFECT.DENY).length,
  };
}

function daemonOf(health: HealthFacts): DaemonState {
  if (health.daemonAnswered) return DAEMON_STATE.KEEPING;
  return health.daemonStartsItself ? DAEMON_STATE.SILENT : DAEMON_STATE.ABSENT;
}

function hookedOf(kept: Kept | null): string[] {
  if (kept === null) return [];
  return kept.hooked.filter((agent) => !kept.declined.includes(agent));
}

/** By the name a screen prints, so an agent setup has no hook for, such as Claude Desktop, never counts as one it missed. */
export function unhookedOf(
  found: readonly { kind: string }[],
  hooked: readonly string[],
): string[] {
  const kinds = new Set(found.map((agent) => agent.kind));
  return EDIT_HOOK_TARGETS.filter(
    (target) => kinds.has(target.agent) && !hooked.includes(target.name),
  ).map((target) => target.name);
}

function workspaceOf(account: Account | null): string | null {
  return account === null ? null : account.workspaceId;
}

async function readAhead(home: string): Promise<Ahead> {
  const view = await readHome(home, {
    views: new SessionViews(home),
    now: new Date(),
    status: (where) => readStatus(where, where),
  });
  return {
    working: view.working,
    ...(view.ready === undefined ? {} : { ready: view.ready }),
  };
}

/** Who is working now, and the one thing the record says could stop asking. */
function renderAhead(context: CliContext, ahead: Ahead): void {
  const { flow } = context;
  if (ahead.working.length > 0) {
    flow.list(
      'Working now',
      ahead.working.map((each) => ({
        text:
          each.task === undefined ? each.agentName : `${each.agentName}: ${each.task}`,
      })),
    );
  }
  const ready = ahead.ready;
  if (ready !== undefined) {
    flow.step(
      'Ready to hand over',
      `${ready.action}: allowed ${ready.approvals} times, never refused. "memnox next --hand-over" lets it run without asking.`,
    );
  }
}

function renderStatus(context: CliContext, status: MachineStatus, ahead: Ahead): void {
  const { flow, style } = context;
  flow.open('memnox status');
  if (!status.setUp) {
    flow.close('This machine is not under Memnox yet.');
    flow.hint('"memnox setup" puts it there, with no account.');
    return;
  }
  flow.rows('This machine', [
    ...stoppedRows(context, status.stopped),
    ...holdingRows(context, status),
    ...activityRows(context, status),
  ]);
  renderAhead(context, ahead);
  if (status.stopped !== undefined) {
    flow.close(style.warn('Memnox protection is stopped on this machine.'));
    flow.hint('"memnox start" turns it back on.');
    return;
  }
  const keeping = status.daemon === DAEMON_STATE.KEEPING;
  flow.close(
    keeping
      ? style.ok('Memnox is keeping this machine.')
      : style.warn('Rules are in force, but nothing keeps new agents under Memnox.'),
  );
  if (!keeping) flow.hint('"memnox daemon --install" hands the daemon to the machine.');
  if (status.waiting > 0) flow.hint('"memnox approvals" lists what is waiting.');
  if (status.dormant.length > 0) {
    flow.hint('"memnox agents offboard <name>" retires an agent nobody uses.');
  }
  if (status.workspace === null) {
    flow.hint('"memnox login" connects this machine to your team.');
  } else if (status.removed === true) {
    flow.hint('"memnox login" connects this machine to a team again.');
  }
}

/** Who stopped protection, why, and until when, only while it is stopped. */
function stoppedRows(context: CliContext, stop: ProtectionStop | undefined): FlowRow[] {
  if (stop === undefined) return [];
  const until = stop.until === undefined ? 'until "memnox start"' : `until ${stop.until}`;
  const because = stop.reason === undefined ? '' : `: ${stop.reason}`;
  return [
    {
      label: 'protection',
      value: context.style.warn(
        `stopped by ${stop.by} at ${stop.at}, ${until}${because}`,
      ),
    },
  ];
}

/** What stands between the agents and the machine. */
function holdingRows(context: CliContext, status: MachineStatus): FlowRow[] {
  const { style } = context;
  const agents = describeCount(status.agents, 'agent');
  return [
    {
      label: 'mode',
      value: isObserving(status)
        ? `${status.mode}, watching rather than stopping`
        : status.mode,
    },
    {
      label: 'daemon',
      value:
        status.daemon === DAEMON_STATE.KEEPING
          ? style.ok('running, and keeping new agents and servers under Memnox')
          : style.warn(status.daemon),
    },
    {
      label: 'agents',
      value:
        status.hooked.length === 0
          ? agents
          : `${agents}, hooked: ${status.hooked.join(', ')}`,
    },
    {
      label: 'mcp',
      value: `${status.mcpWrapped} of ${describeCount(status.mcpServers, 'server')} through Memnox`,
    },
    { label: 'rules', value: describeCount(status.rules, 'rule') },
    ...probationRows(context, status.probation ?? []),
  ];
}

/** What is still on probation, only when something is, so a settled machine reads short. */
function probationRows(
  context: CliContext,
  probation: readonly ProbationEntry[],
): FlowRow[] {
  if (probation.length === 0) return [];
  return [
    { label: 'probation', value: context.style.warn(describeProbations(probation)) },
  ];
}

/** What happened since midnight, what is waiting, and whether any of it reaches a team. */
function activityRows(context: CliContext, status: MachineStatus): FlowRow[] {
  const { style } = context;
  // In observe nothing was stopped, so it says what enforce would have done.
  const would = isObserving(status) ? 'would have been ' : '';
  const { today } = status;
  return [
    {
      label: 'today',
      value: `${describeCount(today.actions, 'action')}, ${today.asked} ${would}asked, ${today.denied} ${would}denied`,
    },
    {
      label: 'waiting',
      value:
        status.waiting + status.paused === 0
          ? 'nothing'
          : style.warn(
              `${describeCount(status.waiting, 'approval')}, ${describeCount(status.paused, 'paused session')}`,
            ),
    },
    dormantRow(context, status),
    {
      label: 'team',
      value:
        status.workspace === null
          ? 'not connected, so nothing leaves this machine'
          : status.removed === true
            ? style.warn(
                `removed from ${status.workspace}, so nothing leaves this machine`,
              )
            : status.workspace,
    },
  ];
}

/** Standing authority with no work behind it, which is reach nobody would miss. */
function dormantRow(context: CliContext, status: MachineStatus): FlowRow {
  if (status.dormant.length === 0) return { label: 'dormant', value: 'none' };
  const agents = status.dormant.map((agent) => `${agent.name} (${agent.reach})`);
  return {
    label: 'dormant',
    value: context.style.warn(
      `${describeCount(status.dormant.length, 'agent')} idle ${DORMANT_AFTER_DAYS} days and still holding reach: ${agents.join('; ')}`,
    ),
  };
}

function isObserving(status: MachineStatus): boolean {
  return status.mode !== ENFORCEMENT_MODE.ENFORCE;
}

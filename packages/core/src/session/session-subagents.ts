import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { shortDigest } from '../domain/digest';
import { JsonRecordDir } from '../store/json-records';

/**
 * The agents a session handed work to, written by its hook: what each was asked to do, and
 * what each has been doing since. Their tool calls reach the ledger under the parent's session,
 * so without this a session busy through three helpers reads as one agent doing everything.
 */
export const SUBAGENTS_DIR = 'subagents';

/** A helper the session launched, in the words it was launched with. */
export interface SubagentLaunch {
  kind: 'launch';
  sessionId: string;
  description: string;
  type?: string;
  /** In the background, so its end is not the launch's end. */
  background: boolean;
  at: string;
}

/** What one helper has been doing, from its own tool calls. */
export interface SubagentActivity {
  kind: 'activity';
  sessionId: string;
  agentId: string;
  type?: string;
  firstAt: string;
  lastAt: string;
  actions: number;
  lastTool?: string;
  /** Where it works, which is a worktree when it was given one of its own. */
  cwd?: string;
}

type SubagentRecord = SubagentLaunch | SubagentActivity;

/** A helper with something recorded this recently is working now. */
export const SUBAGENT_WORKING_MS = 2 * 60 * 1_000;
/** Enough of a session's helpers to describe it, never a history. */
const MOST_SHOWN = 10;

export interface SubagentSummary {
  launched: { description: string; type?: string; at: string; background: boolean }[];
  working: {
    type?: string;
    lastTool?: string;
    actions: number;
    quietForSeconds: number;
    cwd?: string;
  }[];
  finished: number;
}

export class SessionSubagents {
  private readonly records: JsonRecordDir<SubagentRecord>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, SUBAGENTS_DIR));
  }

  async launched(launch: Omit<SubagentLaunch, 'kind'>): Promise<void> {
    const id = `${idFor(launch.sessionId)}__l_${shortDigest(`${launch.at}${launch.description}`)}`;
    await this.records.write(id, { kind: 'launch', ...launch });
  }

  /** One file per helper, so helpers running side by side never write over each other. */
  async acted(input: {
    sessionId: string;
    agentId: string;
    type?: string;
    tool?: string;
    cwd?: string;
    at: string;
  }): Promise<void> {
    const id = `${idFor(input.sessionId)}__a_${idFor(input.agentId)}`;
    const was = await this.records.read(id);
    const before = was?.kind === 'activity' ? was : undefined;
    await this.records.write(id, {
      kind: 'activity',
      sessionId: input.sessionId,
      agentId: input.agentId,
      ...(input.type === undefined ? {} : { type: input.type }),
      firstAt: before?.firstAt ?? input.at,
      lastAt: input.at,
      actions: (before?.actions ?? 0) + 1,
      ...(input.tool === undefined ? {} : { lastTool: input.tool }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    });
  }

  async of(sessionId: string): Promise<SubagentRecord[]> {
    return (await this.records.all()).filter((each) => each.sessionId === sessionId);
  }
}

/** A session's helpers as a person would ask about them: launched, working now, and done. */
export function summarizeSubagents(
  records: readonly SubagentRecord[],
  moment: Date,
): SubagentSummary {
  const launches = records
    .filter((each): each is SubagentLaunch => each.kind === 'launch')
    .sort((a, b) => b.at.localeCompare(a.at));
  const activity = records.filter(
    (each): each is SubagentActivity => each.kind === 'activity',
  );
  const quiet = (each: SubagentActivity): number =>
    moment.getTime() - Date.parse(each.lastAt);
  const working = activity
    .filter((each) => quiet(each) < SUBAGENT_WORKING_MS)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return {
    launched: launches.slice(0, MOST_SHOWN).map((each) => ({
      description: each.description,
      ...(each.type === undefined ? {} : { type: each.type }),
      at: each.at,
      background: each.background,
    })),
    working: working.slice(0, MOST_SHOWN).map((each) => ({
      ...(each.type === undefined ? {} : { type: each.type }),
      ...(each.lastTool === undefined ? {} : { lastTool: each.lastTool }),
      actions: each.actions,
      quietForSeconds: Math.round(quiet(each) / 1_000),
      ...(each.cwd === undefined ? {} : { cwd: each.cwd }),
    })),
    finished: activity.length - working.length,
  };
}

/** A session or agent id as a file name, since an agent's own ids can hold characters a path cannot. */
function idFor(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

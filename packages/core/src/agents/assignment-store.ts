import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import {
  assignmentBlockFrom,
  assignmentStandingFor,
  isTrusted,
  STANDING,
  systemClock,
  type AssignmentBlock,
  type AssignmentClock,
  type AssignmentStanding,
  type HeldAssignments,
} from './agent-assignment';

/** Where this machine keeps the assignments Memnox Cloud sent, and what its gates noted. */

const ASSIGNMENTS_FILE = 'assignments.json';

export function assignmentsPathFor(home: string): string {
  return join(home, MEMNOX_HOME, 'agents', ASSIGNMENTS_FILE);
}

export async function readHeldAssignments(home: string): Promise<HeldAssignments | null> {
  return heldFrom(await readJsonFile<Partial<HeldAssignments>>(assignmentsPathFor(home)));
}

/** The same read, for a gate that lives as long as an MCP server and decides synchronously. */
export function readHeldAssignmentsSync(home: string): HeldAssignments | null {
  try {
    // The shape is checked field by field in heldFrom.
    return heldFrom(
      JSON.parse(
        readFileSync(assignmentsPathFor(home), 'utf8'),
      ) as Partial<HeldAssignments>,
    );
  } catch {
    return null;
  }
}

function heldFrom(raw: Partial<HeldAssignments> | null): HeldAssignments | null {
  if (raw === null || typeof raw !== 'object') return null;
  const block = assignmentBlockFrom(raw.block);
  const numbers = [raw.confirmedAtWall, raw.confirmedAtMono, raw.highWaterWall];
  if (block === null || !numbers.every((each) => typeof each === 'number')) return null;
  return {
    block,
    confirmedAtWall: raw.confirmedAtWall as number,
    confirmedAtMono: raw.confirmedAtMono as number,
    highWaterWall: raw.highWaterWall as number,
    ...(typeof raw.pendingSince === 'number' ? { pendingSince: raw.pendingSince } : {}),
    since: typeof raw.since === 'object' && raw.since !== null ? raw.since : {},
  };
}

/**
 * Keeps a block the cloud just sent as confirmed now, noting each install whose agent
 * changed so permission given under its old agent stops counting from this moment.
 */
export async function confirmAssignments(
  home: string,
  block: AssignmentBlock,
  clock: AssignmentClock = systemClock(),
): Promise<HeldAssignments> {
  const before = await readHeldAssignments(home);
  const previous = new Map(
    (before?.block.assignments ?? []).map((each) => [each.id, each]),
  );
  const since: Record<string, number> = {};
  for (const each of block.assignments) {
    const was = previous.get(each.id);
    const unchanged = was !== undefined && was.profile === each.profile;
    since[each.id] = unchanged ? (before?.since[each.id] ?? clock.wall) : clock.wall;
  }
  const held: HeldAssignments = {
    block,
    confirmedAtWall: clock.wall,
    confirmedAtMono: clock.mono,
    highWaterWall: clock.wall,
    since,
  };
  await writeJsonFile(assignmentsPathFor(home), held);
  await resetMarks(home, clock);
  return held;
}

/**
 * Renews the lease of what this machine already holds, as a 304 or a heartbeat does, only
 * when the cloud's version is the one held; any other version waits for the pull.
 */
export async function renewAssignments(
  home: string,
  version: number,
  clock: AssignmentClock = systemClock(),
): Promise<boolean> {
  const held = await readHeldAssignments(home);
  if (held === null || held.block.version !== version) return false;
  const { pendingSince: _pending, ...rest } = held;
  await writeJsonFile(assignmentsPathFor(home), {
    ...rest,
    confirmedAtWall: clock.wall,
    confirmedAtMono: clock.mono,
    highWaterWall: clock.wall,
  });
  await resetMarks(home, clock);
  return true;
}

/** The cloud said something changed: nothing held counts until the new bundle lands. */
export async function markAssignmentsPending(
  home: string,
  clock: AssignmentClock = systemClock(),
): Promise<void> {
  const held = await readHeldAssignments(home);
  if (held === null) return;
  await writeJsonFile(assignmentsPathFor(home), { ...held, pendingSince: clock.wall });
}

/** How far the wall clock must move before a gate writes it down, so a busy hook is not a busy disk. */
const MARK_STEP_MS = 30_000;

/**
 * What the gates on this machine note as they decide, kept apart from the assignments so a
 * hook writing its mark can never overwrite a block the daemon just confirmed: the latest
 * wall time seen, and when an install of each agent was last gated under that agent's role.
 */
export interface AssignmentMarks {
  highWaterWall: number;
  gated: Record<string, number>;
}

export function assignmentMarksPathFor(home: string): string {
  return join(home, MEMNOX_HOME, 'agents', 'assignment-marks.json');
}

function marksFrom(raw: unknown): AssignmentMarks {
  if (typeof raw !== 'object' || raw === null) return { highWaterWall: 0, gated: {} };
  // Narrowed to an object above, and both fields are checked here.
  const { highWaterWall, gated } = raw as Partial<AssignmentMarks>;
  return {
    highWaterWall: typeof highWaterWall === 'number' ? highWaterWall : 0,
    gated: typeof gated === 'object' && gated !== null ? gated : {},
  };
}

export async function readAssignmentMarks(home: string): Promise<AssignmentMarks> {
  return marksFrom(await readJsonFile<unknown>(assignmentMarksPathFor(home)));
}

function readAssignmentMarksSync(home: string): AssignmentMarks {
  try {
    return marksFrom(JSON.parse(readFileSync(assignmentMarksPathFor(home), 'utf8')));
  } catch {
    return marksFrom(null);
  }
}

/** The held block with the gates' own high water folded in, so either one catches a turned back clock. */
function withMarks(
  held: HeldAssignments | null,
  marks: AssignmentMarks,
): HeldAssignments | null {
  if (held === null) return null;
  return { ...held, highWaterWall: Math.max(held.highWaterWall, marks.highWaterWall) };
}

/** Whether a gate deciding now should write its mark, which it does at most twice a minute per agent. */
function markDue(
  marks: AssignmentMarks,
  standing: AssignmentStanding,
  clock: AssignmentClock,
): boolean {
  if (clock.wall >= marks.highWaterWall + MARK_STEP_MS) return true;
  if (standing.state !== STANDING.CURRENT) return false;
  return clock.wall >= (marks.gated[standing.profile] ?? 0) + MARK_STEP_MS;
}

function markedAfter(
  marks: AssignmentMarks,
  standing: AssignmentStanding,
  clock: AssignmentClock,
): AssignmentMarks {
  return {
    highWaterWall: Math.max(marks.highWaterWall, clock.wall),
    gated:
      standing.state === STANDING.CURRENT
        ? { ...marks.gated, [standing.profile]: clock.wall }
        : marks.gated,
  };
}

/**
 * The standing a gate opening now should hold for one install: read from disk at every gate,
 * which is every hook call, so a lease is checked before each action rather than once a day.
 * Only a fresh standing writes a mark, so a clock already turned back is never written down.
 */
export async function assignmentStandingOn(
  home: string,
  agentName: string,
  clock: AssignmentClock = systemClock(),
): Promise<AssignmentStanding> {
  const marks = await readAssignmentMarks(home);
  const standing = assignmentStandingFor(
    withMarks(await readHeldAssignments(home), marks),
    agentName,
    clock,
  );
  if (isTrusted(standing) && markDue(marks, standing, clock)) {
    await writeJsonFile(
      assignmentMarksPathFor(home),
      markedAfter(marks, standing, clock),
    );
  }
  return standing;
}

/** The standing for a long lived gate, read from disk at each call it decides. */
export function assignmentStandingNow(
  home: string,
  agentName: string,
  clock: () => AssignmentClock = systemClock,
): () => AssignmentStanding {
  return () => {
    const now = clock();
    const marks = readAssignmentMarksSync(home);
    const standing = assignmentStandingFor(
      withMarks(readHeldAssignmentsSync(home), marks),
      agentName,
      now,
    );
    if (isTrusted(standing) && markDue(marks, standing, now)) {
      // Not awaited, since the decision must not wait on a disk; a lost mark only loses a step.
      void writeJsonFile(
        assignmentMarksPathFor(home),
        markedAfter(marks, standing, now),
      ).catch(() => undefined);
    }
    return standing;
  };
}

/**
 * Hearing from the cloud is the one thing that may move the high water back, since a clock a
 * person corrected must not lock the gate for good; the cloud's word is fresh whatever the clock says.
 */
async function resetMarks(home: string, clock: AssignmentClock): Promise<void> {
  const marks = await readAssignmentMarks(home);
  await writeJsonFile(assignmentMarksPathFor(home), {
    ...marks,
    highWaterWall: clock.wall,
  });
}

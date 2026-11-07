import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { JsonRecordDir, readJsonArray, writeJsonFile } from '../store/json-records';
import type { AgentWork } from './agent-work';

/**
 * Where agent work is kept: under `~/.memnox/work/`, or in the project it is scoped to under
 * `<project>/.memnox/work/`, with the home keeping the list of projects that hold any.
 */

export const WORK_DIR = 'work';
/** Beside the folder rather than in it, so the list is never read as a piece of work. */
const PROJECT_ROOTS_FILE = 'work-roots.json';

function homeWorkDir(home: string): string {
  return join(home, MEMNOX_HOME, WORK_DIR);
}

function projectWorkDir(root: string): string {
  return join(root, MEMNOX_HOME, WORK_DIR);
}

export class AgentWorks {
  constructor(private readonly home: string) {}

  async write(work: AgentWork): Promise<void> {
    if (work.projectRoot !== undefined) await this.rememberRoot(work.projectRoot);
    await this.dirFor(work.projectRoot).write(work.id, work);
  }

  /** Every piece of work kept here and in each project that holds any, newest change first. */
  async all(): Promise<AgentWork[]> {
    const roots = await this.roots();
    const found = (
      await Promise.all([
        this.dirFor(undefined).all(),
        ...roots.map((root) => this.dirFor(root).all()),
      ])
    )
      .flat()
      .filter(isWork);
    const unique = new Map(found.map((each) => [each.id, each]));
    return [...unique.values()].sort((one, two) =>
      two.updatedAt.localeCompare(one.updatedAt),
    );
  }

  async read(id: string): Promise<AgentWork | undefined> {
    return (await this.all()).find((each) => each.id === id);
  }

  /** The work a handoff belongs to, found by the handoff's own id. */
  async withHandoff(handoffId: string): Promise<AgentWork | undefined> {
    return (await this.all()).find((each) =>
      each.handoffs.some((handoff) => handoff.id === handoffId),
    );
  }

  private dirFor(root: string | undefined): JsonRecordDir<AgentWork> {
    return new JsonRecordDir(
      root === undefined ? homeWorkDir(this.home) : projectWorkDir(root),
    );
  }

  private roots(): Promise<string[]> {
    return readJsonArray<string>(join(this.home, MEMNOX_HOME, PROJECT_ROOTS_FILE)).then(
      (roots) => roots.filter((each) => typeof each === 'string'),
    );
  }

  private async rememberRoot(root: string): Promise<void> {
    const roots = await this.roots();
    if (roots.includes(root)) return;
    await writeJsonFile(join(this.home, MEMNOX_HOME, PROJECT_ROOTS_FILE), [
      ...roots,
      root,
    ]);
  }
}

/** A file in a shared repository is anybody's to edit, so only what reads as work is kept. */
function isWork(value: AgentWork): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.id === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.handoffs) &&
    Array.isArray(value.progress) &&
    Array.isArray(value.sessions)
  );
}

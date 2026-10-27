import { isAbsolute, join, relative } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { JsonRecordDir } from '../store/json-records';

/**
 * The terminal tab a `memnox run` started in, noted before its agent starts. An agent can stop to
 * ask the person something before its first hook runs, such as whether to trust the folder, and
 * until then this is the only record of which tab it is waiting in.
 */

export const RUN_TERMINALS_DIR = 'run-terminals';

export interface RunTerminal {
  sessionId: string;
  agent: string;
  /** The `memnox run` process, which lives exactly as long as the agent under it. */
  pid: number;
  /** The terminal device, such as `ttys004`, which is how its tab is found in Terminal and iTerm2. */
  tty?: string;
  /** The app the tab is in, as a person names it, such as `Terminal`. */
  app?: string;
  appPath?: string;
  cwd: string;
  startedAt: string;
}

export class RunTerminals {
  private readonly records: JsonRecordDir<RunTerminal>;

  constructor(home: string) {
    this.records = new JsonRecordDir(join(home, MEMNOX_HOME, RUN_TERMINALS_DIR));
  }

  note(terminal: RunTerminal): Promise<void> {
    return this.records.write(idFor(terminal.sessionId), terminal);
  }

  read(sessionId: string): Promise<RunTerminal | null> {
    return this.records.read(idFor(sessionId));
  }

  /** Gone with its run, so a tab that closed is never pressed into. */
  forget(sessionId: string): Promise<void> {
    return this.records.remove(idFor(sessionId));
  }

  /** Every run noted and not yet forgotten, so a session is listed before its agent's first hook. */
  all(): Promise<RunTerminal[]> {
    return this.records.all();
  }

  /** The newest run started in this folder or under it since a moment, or null when none was. */
  async startedIn(folder: string, since: string): Promise<RunTerminal | null> {
    const found = (await this.records.all())
      .filter((each) => each.startedAt >= since && within(folder, each.cwd))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return found[0] ?? null;
  }
}

function within(folder: string, cwd: string): boolean {
  const path = relative(folder, cwd);
  return !path.startsWith('..') && !isAbsolute(path);
}

function idFor(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}

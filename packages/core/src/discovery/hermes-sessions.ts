import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Hermes keeps every session and its messages in `~/.hermes/state.db`, and runs with no hook the
 * ledger could key its sessions by. So on a server where Hermes is the agent, what it is doing is
 * read from its own database, read only, never written, and only the words a person would see.
 */

const HERMES_STATE = join('.hermes', 'state.db');

/** Long enough that a database Hermes is writing to answers, short enough that a list never hangs. */
const BUSY_TIMEOUT_MS = 500;

const MOST_SESSIONS = 20;
const MOST_MESSAGES = 14;
const MOST_TEXT_CHARS = 420;

/** One Hermes session as the switcher lists it. */
export interface HermesSession {
  id: string;
  /** What Hermes calls it, where somebody named it. */
  title?: string;
  startedAt: string;
  endedAt?: string;
  lastActive: string;
  /** Where it works, which names the repository on a card. */
  directory?: string;
  toolCalls: number;
  /** Where Hermes was driven from, such as `cli` or `acp`, so a client's own sessions can be told apart. */
  source?: string;
}

/** One line of what was said, oldest first: the person, Hermes, or a tool it ran. */
export interface HermesMessage {
  at: string;
  role: 'person' | 'agent' | 'tool';
  text: string;
}

interface SessionRow {
  id: string;
  source: string | null;
  display_name: string | null;
  started_at: number;
  ended_at: number | null;
  last_message: number | null;
  cwd: string | null;
  git_repo_root: string | null;
  tool_call_count: number | null;
}

interface MessageRow {
  role: string;
  content: string | null;
  tool_name: string | null;
  timestamp: number;
}

/**
 * The sessions active since `since`, newest first, or none where Hermes keeps no database here.
 * `skipSources` is left out before the limit, so a client opening many sessions never crowds the rest out.
 */
export function readHermesSessions(
  home: string,
  since: Date,
  skipSources: readonly string[] = [],
): HermesSession[] {
  return withHermes(
    home,
    (db) => {
      const hasSource = hasColumn(db, 'sessions', 'source');
      const source = hasSource ? 's.source' : 'NULL';
      const skipping = hasSource && skipSources.length > 0;
      const where = skipping
        ? `WHERE COALESCE(s.source, '') NOT IN (${skipSources.map(() => '?').join(', ')})`
        : '';
      const rows = db
        .prepare(
          `SELECT s.id, ${source} AS source, s.display_name, s.started_at, s.ended_at, s.cwd,
                s.git_repo_root, s.tool_call_count, MAX(m.timestamp) AS last_message
           FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
          ${where}
          GROUP BY s.id
         HAVING COALESCE(MAX(m.timestamp), s.started_at) >= ?
          ORDER BY COALESCE(MAX(m.timestamp), s.started_at) DESC
          LIMIT ?`,
        )
        .all(
          ...(skipping ? skipSources : []),
          since.getTime() / 1_000,
          MOST_SESSIONS,
        ) as SessionRow[];
      return rows.map(sessionOf);
    },
    [],
  );
}

/** The latest lines of one session, oldest first, the way the live window shows a conversation. */
export function readHermesMessages(home: string, sessionId: string): HermesMessage[] {
  return withHermes(
    home,
    (db) => {
      const rows = db
        .prepare(
          `SELECT role, content, tool_name, timestamp FROM messages
          WHERE session_id = ? AND active = 1
          ORDER BY timestamp DESC, id DESC LIMIT ?`,
        )
        .all(sessionId, MOST_MESSAGES * 2) as MessageRow[];
      return rows.reverse().flatMap(messageOf).slice(-MOST_MESSAGES);
    },
    [],
  );
}

/** An older Hermes kept no `source`, and naming a column it lacks would read the whole list as nothing. */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  // PRAGMA rows are SQLite's own fixed shape, of which only the name is read.
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((each) => each.name === column);
}

function withHermes<T>(home: string, read: (db: Database.Database) => T, none: T): T {
  const path = join(home, HERMES_STATE);
  if (!existsSync(path)) return none;
  let db: Database.Database | null = null;
  try {
    db = new Database(path, {
      readonly: true,
      fileMustExist: true,
      timeout: BUSY_TIMEOUT_MS,
    });
    return read(db);
  } catch {
    // A schema Hermes changed, or a database it holds locked, reads as nothing rather than a fault.
    return none;
  } finally {
    db?.close();
  }
}

function sessionOf(row: SessionRow): HermesSession {
  const started = instant(row.started_at);
  const directory = row.git_repo_root ?? row.cwd ?? undefined;
  return {
    id: row.id,
    ...(row.display_name === null || row.display_name === ''
      ? {}
      : { title: row.display_name }),
    startedAt: started,
    ...(row.ended_at === null ? {} : { endedAt: instant(row.ended_at) }),
    lastActive: row.last_message === null ? started : instant(row.last_message),
    ...(directory === undefined ? {} : { directory }),
    toolCalls: row.tool_call_count ?? 0,
    ...(row.source === null || row.source === '' ? {} : { source: row.source }),
  };
}

/** The person's and Hermes's words, and a tool by name only, since its output is not for a screen. */
function messageOf(row: MessageRow): HermesMessage[] {
  const at = instant(row.timestamp);
  if (row.role === 'tool') {
    return row.tool_name === null ? [] : [{ at, role: 'tool', text: row.tool_name }];
  }
  const text = (row.content ?? '').trim();
  if (text === '') return [];
  const said =
    text.length > MOST_TEXT_CHARS ? `${text.slice(0, MOST_TEXT_CHARS)}…` : text;
  if (row.role === 'user') return [{ at, role: 'person', text: said }];
  if (row.role === 'assistant') return [{ at, role: 'agent', text: said }];
  return [];
}

/** Hermes keeps seconds since the epoch as a real number. */
function instant(seconds: number): string {
  return new Date(seconds * 1_000).toISOString();
}

/**
 * A database statement reached through an MCP tool, ruled on the way the shell seam rules
 * `psql -c`: by its statement, its table and whose database it is.
 */
import type { ToolClass } from '../discovery/classify';
import { nameSegments } from '../discovery/surface';
import { boundedAlternative, hostnameOf, inspectSql, isLocalHost, SQL_RISK } from './sql';
import { databaseStatementOf } from './tool-call';

/**
 * The statement a database call makes, as a rule's `arguments` reads it. Derived by the seam
 * and never taken from the call, so an agent cannot name its own statement to pass a rule.
 */
export const STATEMENT_ARGUMENT = 'memnox_statement';

/** The namespace such a statement is ruled under, beside `psql` and the other clients. */
export const DATABASE_ACTION_PREFIX = 'database';

/** Argument names an MCP database tool takes its connection under. */
const CONNECTION_ARGUMENTS = [
  'connectionString',
  'connection_string',
  'databaseUrl',
  'database_url',
  'url',
  'dsn',
  'host',
];

/** Variables a wrapped database server reads its connection from. */
const CONNECTION_VARIABLES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_CONNECTION_STRING',
  'MYSQL_URL',
];

/** A database that is a file on this machine, so nobody else's data is in it. */
const FILE_DATABASES = ['sqlite', 'sqlite3', 'duckdb'];

const CONNECTION_URL = /^[a-z][\w+.-]*:\/\/\S+$/i;
const HOST_FLAGS = ['-h', '--host'];

/** What one database call does, read where it is made. */
export interface DatabaseToolCall {
  /** The action a rule names: `database.delete`, or `database.delete-unbounded`. */
  action: string;
  /** The statement alone, as `arguments` carries it: `delete-unbounded`. */
  statement: string;
  class: ToolClass;
  /** True only where the call shows the database is this machine's. Unknown is somebody else's. */
  local: boolean;
  /** The host where one was named, else the server, and absent for a local database. */
  target?: string;
  /** The same change bounded to the rows a task needs, on the table it named. */
  alternative?: string;
}

/** Where the call goes: the server it is made through, and what that server was started with. */
export interface DatabaseWhere {
  server: string;
  /** The wrapped server's command line, which the proxy holds and a hook does not. */
  command?: readonly string[];
  /** The wrapped server's environment, likewise. */
  env?: NodeJS.ProcessEnv;
}

/** Null for anything but a statement that changes something, which needs no reading here. */
export function databaseToolCall(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  where: DatabaseWhere,
): DatabaseToolCall | null {
  const text = databaseStatementOf(tool, args);
  if (text === null) return null;
  const sql = inspectSql(text);
  if (sql.risk === SQL_RISK.UNKNOWN || sql.risk === SQL_RISK.READS) return null;
  const statement = `${sql.statement.toLowerCase()}${sql.risk === SQL_RISK.UNBOUNDED ? '-unbounded' : ''}`;
  const host = hostOf(args, where);
  const local =
    host === undefined
      ? [tool, where.server].some((name) =>
          nameSegments(name).some((word) => FILE_DATABASES.includes(word)),
        )
      : isLocalHost(host);
  const alternative = boundedAlternative(sql);
  return {
    action: `${DATABASE_ACTION_PREFIX}.${statement}`,
    statement,
    class: sql.class,
    local,
    ...(local ? {} : { target: host ?? where.server }),
    ...(alternative === null ? {} : { alternative }),
  };
}

/**
 * The call's own arguments with the statement stamped on where the database is local, and
 * any value the agent put under that name dropped, since only the seam may say it.
 */
export function withStatement<T>(
  args: Readonly<Record<string, T>>,
  call: DatabaseToolCall | null,
): Record<string, T | string> {
  const own = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== STATEMENT_ARGUMENT),
  );
  return call === null || !call.local
    ? own
    : { ...own, [STATEMENT_ARGUMENT]: call.statement };
}

/** The host the call, the server's command line or its environment names, in that order. */
function hostOf(
  args: Readonly<Record<string, unknown>>,
  where: DatabaseWhere,
): string | undefined {
  for (const key of CONNECTION_ARGUMENTS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') return hostnameOf(value.trim());
  }
  const command = where.command ?? [];
  for (const [index, arg] of command.entries()) {
    const flagged = HOST_FLAGS.includes(arg) ? command[index + 1] : undefined;
    if (flagged !== undefined) return flagged;
    if (CONNECTION_URL.test(arg) && !/^https?:/i.test(arg)) return hostnameOf(arg);
  }
  for (const name of CONNECTION_VARIABLES) {
    const value = where.env?.[name];
    if (value !== undefined && value.trim() !== '') return hostnameOf(value.trim());
  }
  return undefined;
}

/**
 * A database client takes its statement as an argument, so `psql -c "DROP TABLE users"`
 * is ruled on as a drop rather than as a connection.
 */

import { TOOL_CLASS, type ToolClass } from '../discovery/classify';

/**
 * Flags whose value is the statement itself, per client. A drop-in client speaks its
 * original's grammar, so the same statement is read the same way whichever name ran it.
 */
const STATEMENT_FLAGS: Readonly<Record<string, readonly string[]>> = {
  psql: ['-c', '--command'],
  pgcli: ['-c', '--command'],
  mysql: ['-e', '--execute'],
  mariadb: ['-e', '--execute'],
  mycli: ['-e', '--execute'],
  mongosh: ['--eval'],
  sqlite3: [],
};

export const SQL_RISK = {
  /** Drops or truncates. The table is gone and no transaction brings it back. */
  DROPS: 'drops',
  /** A delete or update with no WHERE, which is every row. */
  UNBOUNDED: 'unbounded',
  /** An ordinary write. */
  WRITES: 'writes',
  READS: 'reads',
  /** Nothing recognisable. Reported as unknown, never assumed harmless. */
  UNKNOWN: 'unknown',
} as const;

export type SqlRisk = (typeof SQL_RISK)[keyof typeof SQL_RISK];

export interface SqlFinding {
  risk: SqlRisk;
  class: ToolClass;
  /** The clause that decided it, so the refusal can quote the reason. */
  because: string;
  /** The statement's leading keyword. Never the whole statement, which holds values. */
  statement: string;
  /** The table or collection it acts on, where the statement names one plainly. */
  table?: string;
}

/** Strips string literals and comments, so a value can never look like a keyword. */
function scrub(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Any object, since a dropped view or function is as gone as a dropped table.
const DROPPING = /\b(DROP|TRUNCATE)\b/i;
const DELETING = /\bDELETE\s+FROM\b/i;
const UPDATING = /\bUPDATE\b/i;
// `COPY ... FROM` loads rows; `SELECT ... INTO` makes a table; the rest change the schema,
// run code, or rewrite storage.
const WRITING =
  /\b(INSERT|ALTER|CREATE|GRANT|REVOKE|REPLACE|MERGE|COPY\s+\S+(\s*\([^)]*\))?\s+FROM|SELECT\b[^;]*\bINTO\b|DO|CALL|EXEC(UTE)?|VACUUM|REINDEX|CLUSTER|REFRESH|LOCK|COMMENT\s+ON|SECURITY\s+LABEL|IMPORT|LOAD)\b/i;
// A psql meta-command such as `\dt` only ever describes.
const READING =
  /\b(SELECT|SHOW|EXPLAIN|DESCRIBE|DESC|WITH|TABLE|VALUES|COPY)\b|^\\[a-z]/i;
const HAS_WHERE = /\bWHERE\b/i;
// Optionally schema qualified. A quoted name was emptied by the scrub, so it is left out rather than guessed.
const NAME = String.raw`(\w+(?:\.\w+)?)\b(?!\s*\.?"")`;
const TABLE_AFTER: readonly RegExp[] = [
  new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?${NAME}`, 'i'),
  new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?${NAME}`, 'i'),
  new RegExp(
    String.raw`\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+EXISTS\s+)?${NAME}`,
    'i',
  ),
  new RegExp(String.raw`^\s*UPDATE\s+(?:ONLY\s+)?${NAME}`, 'i'),
];

/** The table a statement acts on, as written; never a guess. */
function tableIn(sql: string): string | undefined {
  for (const pattern of TABLE_AFTER) {
    const name = pattern.exec(sql)?.[1];
    if (name !== undefined) return name;
  }
  return undefined;
}

interface SqlRule {
  applies: (sql: string) => boolean;
  risk: SqlRisk;
  class: ToolClass;
  because: (statement: string) => string;
}

function isUnbounded(pattern: RegExp): (sql: string) => boolean {
  return (sql) => pattern.test(sql) && !HAS_WHERE.test(sql);
}

/** First match wins, most dangerous first. A `WHERE` is the difference between a row and every row. */
const SQL_RULES: readonly SqlRule[] = [
  {
    applies: (sql) => DROPPING.test(sql),
    risk: SQL_RISK.DROPS,
    class: TOOL_CLASS.DESTRUCTIVE,
    because: () => 'it drops or truncates, and no transaction brings that back',
  },
  {
    applies: isUnbounded(DELETING),
    risk: SQL_RISK.UNBOUNDED,
    class: TOOL_CLASS.DESTRUCTIVE,
    because: () => 'a DELETE with no WHERE is every row',
  },
  {
    applies: isUnbounded(UPDATING),
    risk: SQL_RISK.UNBOUNDED,
    class: TOOL_CLASS.DESTRUCTIVE,
    because: () => 'an UPDATE with no WHERE is every row',
  },
  {
    applies: (sql) => DELETING.test(sql) || UPDATING.test(sql) || WRITING.test(sql),
    risk: SQL_RISK.WRITES,
    class: TOOL_CLASS.WRITE,
    because: (statement) => `it is a ${statement}`,
  },
  {
    applies: (sql) => READING.test(sql),
    risk: SQL_RISK.READS,
    class: TOOL_CLASS.READ,
    because: (statement) => `it is a ${statement}`,
  },
];

// Lowest first, so a script is as dangerous as its worst statement.
const RISK_RANK: readonly SqlRisk[] = [
  SQL_RISK.UNKNOWN,
  SQL_RISK.READS,
  SQL_RISK.WRITES,
  SQL_RISK.UNBOUNDED,
  SQL_RISK.DROPS,
];

function inspectOne(sql: string): SqlFinding {
  const statement = (/^[A-Za-z]+/.exec(sql)?.[0] ?? 'unknown').toUpperCase();
  const rule = SQL_RULES.find((candidate) => candidate.applies(sql));
  if (rule === undefined) {
    return {
      risk: SQL_RISK.UNKNOWN,
      class: TOOL_CLASS.UNKNOWN,
      because: 'no statement here was recognised',
      statement,
    };
  }
  const table = tableIn(sql);
  return {
    risk: rule.risk,
    class: rule.class,
    because: rule.because(statement),
    statement,
    ...(table === undefined ? {} : { table }),
  };
}

/**
 * The way forward from a statement that takes every row: the same change bounded to the rows
 * the task needs, on the table it named. Null for anything narrower, which needs no redirect.
 */
export function boundedAlternative(
  finding: SqlFinding,
  grammar: 'sql' | 'mongo' = 'sql',
): string | null {
  const on = finding.table === undefined ? 'that table' : finding.table;
  const some =
    finding.table === undefined ? 'the test rows' : `the test ${finding.table}`;
  const bound = grammar === 'mongo' ? 'a filter' : 'a WHERE';
  if (finding.risk === SQL_RISK.UNBOUNDED) {
    return `add ${bound} to the ${finding.statement} on ${on} that bounds it to the rows this task needs, such as only ${some}, and run it again.`;
  }
  if (finding.risk === SQL_RISK.DROPS) {
    const remove = grammar === 'mongo' ? 'a deleteMany' : 'a DELETE';
    return `keep ${on} and remove only the rows this task needs with ${remove} bounded by ${bound}, such as only ${some}.`;
  }
  return null;
}

/** Read from the statement rather than the tool, which is the only signal before the query runs. */
export function inspectSql(raw: string): SqlFinding {
  // Each statement on its own, because a WHERE in one bounds nothing in the next.
  const statements = scrub(raw)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  let worst = inspectOne(statements[0] ?? '');
  for (const statement of statements.slice(1)) {
    const finding = inspectOne(statement);
    if (RISK_RANK.indexOf(finding.risk) > RISK_RANK.indexOf(worst.risk)) worst = finding;
  }
  return worst;
}

/**
 * Every statement on this command line, joined, since `psql -c "SELECT 1" -c "DROP TABLE t"`
 * runs both. Null when this binary takes no statement, or none was passed.
 */
export function statementIn(
  binary: string,
  args: readonly string[],
  stdin?: string,
): string | null {
  const flags = STATEMENT_FLAGS[binary];
  if (flags === undefined) return null;

  const statements: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    // Inside the bounds the loop checks, so never undefined.
    const arg = args[index] as string;
    for (const flag of flags) {
      if (arg === flag) {
        const value = args[index + 1];
        if (value !== undefined) statements.push(value);
        index += 1;
        break;
      }
      // `-c"SELECT 1"` and `--eval=x` are both ordinary ways to write it.
      if (arg.startsWith(`${flag}=`)) {
        statements.push(arg.slice(flag.length + 1));
        break;
      }
      if (flag.length === 2 && arg.startsWith(flag) && arg.length > 2) {
        statements.push(arg.slice(2));
        break;
      }
    }
  }
  // `sqlite3 app.db "DROP TABLE t"` takes the statement as the second positional.
  if (binary === 'sqlite3') {
    const positional = args.filter((arg) => !arg.startsWith('-'));
    if (positional[1] !== undefined) statements.push(positional[1]);
  }
  if (stdin !== undefined && stdin.trim() !== '') statements.push(stdin);
  return statements.length === 0 ? null : statements.join(';\n');
}

const MONGO_RULES: readonly {
  pattern: RegExp;
  risk: SqlRisk;
  class: ToolClass;
  because?: string;
}[] = [
  {
    pattern: /\.(drop|dropDatabase|dropIndex(es)?|dropUser|dropAllUsers)\s*\(/,
    risk: SQL_RISK.DROPS,
    class: TOOL_CLASS.DESTRUCTIVE,
    because: 'it drops a collection or a database',
  },
  {
    pattern: /\.(deleteMany|remove|updateMany)\s*\(\s*(\{\s*\})?\s*[,)]/,
    risk: SQL_RISK.UNBOUNDED,
    class: TOOL_CLASS.DESTRUCTIVE,
    because: 'an empty filter is every document',
  },
  {
    pattern:
      /\.(insert\w*|update\w*|delete\w*|remove|replaceOne|findOneAnd\w+|findAndModify|bulkWrite|create\w*|rename\w*|save|grant\w*|revoke\w*|runCommand|adminCommand|eval)\s*\(|\$(out|merge)\b/,
    risk: SQL_RISK.WRITES,
    class: TOOL_CLASS.WRITE,
  },
  {
    pattern:
      /\.(find|findOne|aggregate|count\w*|estimatedDocumentCount|distinct|getCollectionNames|getCollectionInfos|getIndexes|stats|explain|listCollections|serverStatus|version|hostInfo)\s*\(|^\s*show\s+\w+|^\s*(db|use\s+\w+)\s*;?\s*$/m,
    risk: SQL_RISK.READS,
    class: TOOL_CLASS.READ,
  },
];

/**
 * Every string in one quote emptied to a pair of quotes, a backslash escaping the next character,
 * in one pass. A quote with no close is left as written, and so is the rest after it, since the
 * same scan from any later quote would find no close either.
 */
function emptiedStrings(text: string, quote: string): string {
  let out = '';
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(quote, at);
    if (open === -1) break;
    let close = -1;
    for (let next = open + 1; next < text.length; next += 1) {
      if (text[next] === '\\') next += 1;
      else if (text[next] === quote) {
        close = next;
        break;
      }
    }
    if (close === -1) break;
    out += `${text.slice(at, open)}${quote}${quote}`;
    at = close + 1;
  }
  return out + text.slice(at);
}

/** mongosh takes JavaScript rather than SQL, so it is read by its method names instead. */
export function inspectMongo(raw: string): SqlFinding {
  const script = emptiedStrings(emptiedStrings(raw, "'"), '"').replace(
    /\/\/[^\n]*/g,
    ' ',
  );
  const statement = /\.(\w+)\s*\(/.exec(script)?.[1] ?? 'unknown';
  const table = /\bdb\.(\w+)\.\w+\s*\(/.exec(script)?.[1];
  // First match wins, most dangerous first, as the SQL rules are ordered.
  const rule = MONGO_RULES.find((candidate) => candidate.pattern.test(script));
  if (rule === undefined) {
    return {
      risk: SQL_RISK.UNKNOWN,
      class: TOOL_CLASS.UNKNOWN,
      because: 'no statement here was recognised',
      statement,
    };
  }
  return {
    risk: rule.risk,
    class: rule.class,
    because: rule.because ?? `it calls ${statement}`,
    statement,
    ...(table === undefined ? {} : { table }),
  };
}

/** The statement read by the grammar its client speaks. */
export function inspectStatement(binary: string, statement: string): SqlFinding {
  return binary === 'mongosh' ? inspectMongo(statement) : inspectSql(statement);
}

export function isDatabaseClient(binary: string): boolean {
  return STATEMENT_FLAGS[binary] !== undefined;
}

const HOST_FLAGS = ['-h', '--host'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/** The host a client is pointed at, which decides whether this is somebody else's data. */
export function nonLocalHost(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): string | null {
  const target = hostFlagIn(args) ?? env['DATABASE_URL'] ?? env['MONGODB_URI'];
  if (target === undefined) return null;
  const host = hostnameOf(target);
  return LOCAL_HOSTS.includes(host) ? null : host;
}

/** The value after `-h` or `--host`, or glued to `--host=`; a flag given last has none. */
function hostFlagIn(args: readonly string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (HOST_FLAGS.includes(arg)) return args[index + 1];
    if (arg.startsWith('--host=')) return arg.slice('--host='.length);
  }
  return undefined;
}

/** Whether a host is this machine, which is what makes a database the person's own. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.includes(host.toLowerCase());
}

/** The host out of a connection string, or the value itself where it is a bare host. */
export function hostnameOf(target: string): string {
  if (!/^\w+:\/\//.test(target)) return target;
  try {
    return new URL(target).hostname;
  } catch {
    // Not a URL after all; the raw value is the best answer available.
    return target;
  }
}

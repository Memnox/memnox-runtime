/**
 * The native wrapper's half of the protocol: one command line ruled on by the daemon, so a
 * wrapped command pays a connect rather than a Node start. Anything the daemon cannot rule
 * on exactly as the Node interceptor would is answered `node`, and the Node one runs.
 */

export const INTERCEPT_METHOD = {
  /** Rule on a whole command line, as `memnox-intercept` would before running it. */
  INTERCEPT: 'intercept',
  /** The client acted on the plan it was given, so the daemon may write the row for it. */
  INTERCEPT_ACTED: 'intercept-acted',
  /** The command the plan allowed has ended, with its exit code. */
  INTERCEPT_RAN: 'intercept-ran',
} as const;

/** Bumped whenever either side changes shape; a mismatch is answered `node`. */
export const FAST_INTERCEPT_VERSION = 1;

export const INTERCEPT_PLAN = {
  /** Run the real binary and report how it ended, which writes the row. */
  RUN: 'run',
  /** Run the real binary with nothing recorded: a person typed it, or protection is stopped. */
  PASS: 'pass',
  /** Print the message and exit with the code given, without running anything. */
  REFUSE: 'refuse',
  /** Hand the same argv to the Node interceptor, which is always right. */
  NODE: 'node',
} as const;

export type InterceptPlanKind = (typeof INTERCEPT_PLAN)[keyof typeof INTERCEPT_PLAN];

export interface InterceptRequestFields {
  /** On INTERCEPT: the protocol version the client speaks. */
  fast?: number;
  /**
   * On INTERCEPT: the binary the wrapper stands for, then its arguments. Ruled on in memory
   * and never stored or logged; the ledger keeps their digest, as on every other path.
   */
  argv?: string[];
  /** On INTERCEPT: the environment the command would run with, read the way Node would read it. */
  env?: Record<string, string>;
  /** On INTERCEPT: the directory the command runs in. */
  cwd?: string;
  /** On INTERCEPT: the client's parent, which is whatever ran the command. */
  ppid?: number;
}

export interface InterceptResponseFields {
  /** On INTERCEPT: the protocol version the daemon answered in. */
  fast?: number;
  /** On INTERCEPT: what the client does next. */
  plan?: InterceptPlanKind;
  /** On RUN and PASS: the binary to run, found the way the Node interceptor finds it. */
  real?: string;
  /** On RUN and PASS: PATH for the command, with the interceptor directory taken off. */
  path?: string;
  /** On REFUSE: the exit code. */
  exitCode?: number;
  /** Lines for stderr, in order: warnings before a run, the refusal, a pause after one. */
  notes?: string[];
}

/** One INTERCEPT line, exactly as the native client writes it; the golden fixture pins it. */
export interface InterceptLine {
  argv: readonly string[];
  env: readonly (readonly [string, string])[];
  cwd: string;
  ppid: number;
}

/** The bytes the native client sends, key for key, so a test can hold both sides to them. */
export function encodeInterceptLine(line: InterceptLine): string {
  const env = `{${line.env.map(([name, value]) => `${JSON.stringify(name)}:${JSON.stringify(value)}`).join(',')}}`;
  return (
    `{"id":1,"method":${JSON.stringify(INTERCEPT_METHOD.INTERCEPT)},"fast":${FAST_INTERCEPT_VERSION},` +
    `"argv":${JSON.stringify(line.argv)},"cwd":${JSON.stringify(line.cwd)},` +
    `"ppid":${line.ppid},"env":${env}}\n`
  );
}

export function isInterceptMethod(method: string): boolean {
  return (Object.values(INTERCEPT_METHOD) as readonly string[]).includes(method);
}

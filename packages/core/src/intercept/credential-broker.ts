import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import { pipeNameFor, usesNamedPipes } from '../daemon/endpoint';
import { looksLikeCredential } from '../discovery/credentials';
import { verbTableFor } from '../verbs/tables';

/**
 * Credentials kept out of an agent's environment and handed back one binary at a time,
 * so `env` and a talked-into `curl -d "$(env)"` find nothing while `gh` finds its token.
 * Out of the environment, which is not a vault against a same-user process asking on purpose.
 */

/** Where a session's broker listens, set in the agent's environment by `memnox run`. */
export const BROKER_VAR = 'MEMNOX_CREDENTIAL_BROKER';

export type HeldCredentials = Readonly<Record<string, string>>;

/** One question per connection: which binary is about to run. */
export interface BrokerRequest {
  binary: string;
}

export interface BrokerReply {
  /** Only the names that binary is entitled to. Empty for a binary nobody mapped. */
  variables: Record<string, string>;
}

/**
 * Whole families a verb table names one member of, since a table lists the variable that
 * proves a login and a CLI reads its neighbours too: `aws` wants the secret beside the id.
 */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  aws: ['AWS_'],
  gh: ['GH_', 'GITHUB_'],
  git: ['GH_', 'GITHUB_'],
  gcloud: ['CLOUDSDK_', 'GOOGLE_'],
  az: ['AZURE_', 'ARM_'],
  terraform: ['TF_VAR_', 'AWS_', 'ARM_', 'GOOGLE_'],
  vercel: ['VERCEL_'],
  railway: ['RAILWAY_'],
  fly: ['FLY_'],
  heroku: ['HEROKU_'],
  netlify: ['NETLIFY_'],
  stripe: ['STRIPE_'],
  npm: ['NPM_'],
  pnpm: ['NPM_'],
  yarn: ['NPM_', 'YARN_'],
  docker: ['DOCKER_'],
  psql: ['PG'],
  // The agents themselves, whose own model key must stay with them or they cannot start.
  claude: ['ANTHROPIC_', 'CLAUDE_'],
  codex: ['OPENAI_', 'CODEX_'],
  gemini: ['GEMINI_', 'GOOGLE_'],
  'cursor-agent': ['CURSOR_'],
};

/** Ours, and the ones every process needs, never held whatever they are called. */
const NEVER_HELD: readonly string[] = [BROKER_VAR, 'PATH', 'HOME', 'SHELL', 'USER'];

/**
 * The environment split in two: what the agent starts with, and what is held back from
 * it. What the agent's own binary is entitled to stays, since that is its model key.
 */
export function holdCredentials(
  env: NodeJS.ProcessEnv,
  agentBinary: string,
): {
  passed: NodeJS.ProcessEnv;
  held: HeldCredentials;
} {
  const passed: NodeJS.ProcessEnv = {};
  const held: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const hold =
      !NEVER_HELD.includes(name) &&
      looksLikeCredential(name) &&
      !entitledTo(agentBinary, name);
    if (hold) held[name] = value;
    else passed[name] = value;
  }
  return { passed, held };
}

/** Whether a variable is one this binary is handed: named by its table, or of its family. */
export function entitledTo(binary: string, name: string): boolean {
  const table = verbTableFor(binary);
  const named = (table?.credential ?? []).filter((entry) => !entry.startsWith('~'));
  if (named.includes(name)) return true;
  return (FAMILIES[binary] ?? []).some((prefix) => name.startsWith(prefix));
}

/** The held variables this binary may have, and none of the others. */
export function credentialsFor(
  binary: string,
  held: HeldCredentials,
): Record<string, string> {
  const handed: Record<string, string> = {};
  for (const [name, value] of Object.entries(held)) {
    if (entitledTo(binary, name)) handed[name] = value;
  }
  return handed;
}

/** One socket per session beside the other per-session state, or one pipe per session on Windows. */
export function brokerPathFor(
  home: string,
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (usesNamedPipes(platform)) return pipeNameFor(home, `memnox-broker-${sessionId}`);
  return join(home, MEMNOX_HOME, 'brokers', `${sessionId}.sock`);
}

/** A request off the wire, or null for anything that is not one. */
export function parseBrokerRequest(line: string): BrokerRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const binary = (parsed as Record<string, unknown>)['binary'];
  // A basename only: a path would let a caller name any file as the binary it is.
  if (typeof binary !== 'string' || binary === '' || binary.includes('/')) return null;
  return { binary };
}

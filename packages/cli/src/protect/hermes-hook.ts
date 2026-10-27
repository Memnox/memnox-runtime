import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq } from 'yaml';
import { DISCOVERED_AGENT_KIND } from '@memnox/core';
import { EDIT_HOOK_BINARY, HERMES_EVENT } from '@memnox/interceptors';
import { namedHookCommand } from './claude-hook';
import { BACKUP_SUFFIX } from './json-config';

/**
 * The policy hook in Hermes, as the shell hooks its `config.yaml` declares. They fire in
 * the CLI and in the gateway alike, which is what puts a Hermes nobody is watching in the
 * ledger: its sessions start, act and end through the same hook every other agent runs.
 */

const HERMES_DIR = '.hermes';
export const HERMES_CONFIG = join(HERMES_DIR, 'config.yaml');
/**
 * Where Hermes keeps the shell hooks a person approved. A gateway has no terminal to ask
 * on and skips any hook missing from it, so setup's yes is written here as well.
 */
export const HERMES_ALLOWLIST = join(HERMES_DIR, 'shell-hooks-allowlist.json');

const HOOKS_KEY = 'hooks';

/** The longest Hermes lets a shell hook run, so a question routed to a person has time. */
const MOST_HOOK_SECONDS = 300;

interface HermesHookEvent {
  event: string;
  timeout?: number;
}

/** Before a tool, to rule; after one, a turn and a model call, to record and hand notes over. */
const HERMES_HOOK_EVENTS: readonly HermesHookEvent[] = [
  { event: HERMES_EVENT.PRE_TOOL_CALL, timeout: MOST_HOOK_SECONDS },
  { event: HERMES_EVENT.POST_TOOL_CALL },
  { event: HERMES_EVENT.PRE_LLM_CALL },
  { event: HERMES_EVENT.TURN_END },
  { event: HERMES_EVENT.SESSION_FINALIZE },
];

/** Padding off, or the default rewrites `["a"]` as `[ "a" ]` on lines nothing here touched. */
const WRITE = { flowCollectionPadding: false } as const;

export function hermesHookCommand(): string {
  return namedHookCommand(DISCOVERED_AGENT_KIND.HERMES);
}

function isOurs(entry: unknown): boolean {
  if (!isMap(entry)) return false;
  const command = entry.get('command');
  return typeof command === 'string' && command.includes(EDIT_HOOK_BINARY);
}

/**
 * Double quoted, so the file spells the command the way the keeper looks for it, and an
 * install it already made reads as current rather than rewritten on every pass.
 */
function quoted(command: string): Scalar<string> {
  const scalar = new Scalar(command);
  scalar.type = Scalar.QUOTE_DOUBLE;
  return scalar;
}

/** The config with every entry this wrote taken out, then the current ones added. Null where it will not parse. */
export function withHermesHook(raw: string, command: string): string | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  for (const each of HERMES_HOOK_EVENTS) {
    const kept = entriesAt(doc.getIn([HOOKS_KEY, each.event])).filter(
      (entry) => !isOurs(entry),
    );
    const entry = new YAMLMap();
    entry.set('command', quoted(command));
    if (each.timeout !== undefined) entry.set('timeout', each.timeout);
    const seq = new YAMLSeq();
    seq.items = [...kept, entry];
    doc.setIn([HOOKS_KEY, each.event], seq);
  }
  return doc.toString(WRITE);
}

/** The config with every entry this wrote taken out and nothing else. Null where it will not parse. */
export function withoutHermesHook(raw: string): string | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  const hooks = doc.get(HOOKS_KEY);
  if (!isMap(hooks)) return raw;
  for (const pair of [...hooks.items]) {
    const entries = entriesAt(pair.value);
    if (!isSeq(pair.value) || !entries.some(isOurs)) continue;
    const kept = entries.filter((entry) => !isOurs(entry));
    if (kept.length === 0) hooks.delete(pair.key);
    else pair.value.items = kept;
  }
  if (hooks.items.length === 0) doc.delete(HOOKS_KEY);
  return doc.toString(WRITE);
}

function entriesAt(node: unknown): unknown[] {
  return isSeq(node) ? [...node.items] : [];
}

/** One approval as Hermes writes it, keyed on the exact event and command. */
interface Approval {
  event?: unknown;
  command?: unknown;
  [key: string]: unknown;
}

async function readApprovals(home: string): Promise<Approval[]> {
  try {
    const parsed = JSON.parse(await readFile(join(home, HERMES_ALLOWLIST), 'utf8')) as {
      approvals?: unknown;
    };
    // Each entry is narrowed by the filters that read it.
    return Array.isArray(parsed.approvals) ? (parsed.approvals as Approval[]) : [];
  } catch {
    // Absent, or torn: nothing approved yet, which is what Hermes reads it as too.
    return [];
  }
}

function approvalIsOurs(approval: Approval): boolean {
  return (
    typeof approval.command === 'string' && approval.command.includes(EDIT_HOOK_BINARY)
  );
}

async function writeApprovals(
  home: string,
  approvals: readonly Approval[],
): Promise<void> {
  await writeFile(
    join(home, HERMES_ALLOWLIST),
    `${JSON.stringify({ approvals }, null, 2)}\n`,
    'utf8',
  );
}

/** The hook in Hermes's config and its approval beside it, only where Hermes is installed. */
export async function installHermesHook(
  home: string,
  now: () => string = () => new Date().toISOString(),
): Promise<boolean> {
  if (!existsSync(join(home, HERMES_DIR))) return false;
  const path = join(home, HERMES_CONFIG);
  const raw = existsSync(path) ? await readFile(path, 'utf8') : '';
  const command = hermesHookCommand();
  const next = withHermesHook(raw, command);
  // A config with YAML errors is left as it is, since writing it back would be a guess.
  if (next === null) return false;
  if (next !== raw) {
    if (existsSync(path)) await writeFile(`${path}${BACKUP_SUFFIX}`, raw, 'utf8');
    await writeFile(path, next, 'utf8');
  }
  const approvals = await readApprovals(home);
  const approved = (event: string): boolean =>
    approvals.some((each) => each.event === event && each.command === command);
  if (HERMES_HOOK_EVENTS.every(({ event }) => approved(event))) return true;
  const others = approvals.filter((each) => !approvalIsOurs(each));
  const approvedAt = now();
  await writeApprovals(home, [
    ...others,
    ...HERMES_HOOK_EVENTS.map(({ event }) => ({
      event,
      command,
      approved_at: approvedAt,
      script_mtime_at_approval: null,
    })),
  ]);
  return true;
}

/** Every entry and approval this wrote taken back out; true when the config changed. */
export async function removeHermesHook(home: string): Promise<boolean> {
  const path = join(home, HERMES_CONFIG);
  if (!existsSync(path)) return false;
  const raw = await readFile(path, 'utf8');
  const next = withoutHermesHook(raw);
  const approvals = await readApprovals(home);
  if (approvals.some(approvalIsOurs)) {
    await writeApprovals(
      home,
      approvals.filter((each) => !approvalIsOurs(each)),
    );
  }
  if (next === null || next === raw) return false;
  await writeFile(path, next, 'utf8');
  return true;
}

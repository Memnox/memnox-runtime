import { join } from 'node:path';
import { DISCOVERED_AGENT_KIND, type DiscoveredAgentKind } from './discovery.constants';
import { parseTomlTables, stringAt, type TomlTables } from './detectors/toml-tables';
import type { MachineReader } from './ports';

/**
 * Whether an agent stops to ask before it acts. Read off the setting the product itself
 * reads, because an agent that approves its own actions is bounded only by the account
 * and the machine it runs on, and that is the one fact a reach count does not carry.
 */
export const APPROVAL_STATE = {
  /** It acts without a person confirming each step. */
  AUTO: 'auto',
  /** It asks, at least for what its own defaults consider risky. */
  ASKS: 'asks',
  /** A model approves its actions and a person sees only what the model leaves. */
  MODEL_REVIEWED: 'model-reviewed',
  /** Nothing on disk says, so neither answer is printed as a fact. */
  UNKNOWN: 'unknown',
} as const;

export type ApprovalState = (typeof APPROVAL_STATE)[keyof typeof APPROVAL_STATE];

export interface ApprovalPosture {
  state: ApprovalState;
  /** The setting as it is spelled in the file, so the line can be checked by hand. */
  setting?: string;
  declaredIn?: string;
}

const UNKNOWN_POSTURE: ApprovalPosture = { state: APPROVAL_STATE.UNKNOWN };

/** Claude Code's modes that skip the prompt for every tool, not only for edits. */
const CLAUDE_AUTO_MODES: readonly string[] = ['bypassPermissions'];

/** Claude Code's mode in which a model answers the permission prompt and a person sees the rest. */
const CLAUDE_MODEL_MODES: readonly string[] = ['auto'];

/** An allow entry naming the shell with no argument pattern lets every command through. */
const CLAUDE_UNSCOPED_SHELL: readonly string[] = ['Bash', 'Bash(*)', 'Bash(*:*)'];

/** Codex's policy that never asks, whatever the command. */
const CODEX_AUTO_POLICIES: readonly string[] = ['never'];

/** A product with no reader here is unknown, never assumed to ask. */
export async function approvalPostureOf(
  kind: DiscoveredAgentKind,
  reader: MachineReader,
  projectDirs: readonly string[],
): Promise<ApprovalPosture> {
  if (kind === DISCOVERED_AGENT_KIND.CLAUDE_CODE) {
    return claudeCodePosture(reader, projectDirs);
  }
  if (kind === DISCOVERED_AGENT_KIND.CODEX_CLI) return codexPosture(reader);
  return UNKNOWN_POSTURE;
}

/**
 * Read most specific first, as Claude Code does: the first file naming a `defaultMode`
 * decides it, while allow lists merge, so an unscoped shell in any of them lets it through.
 */
async function claudeCodePosture(
  reader: MachineReader,
  projectDirs: readonly string[],
): Promise<ApprovalPosture> {
  const files = [
    ...projectDirs.flatMap((dir) => [
      join(dir, '.claude', 'settings.local.json'),
      join(dir, '.claude', 'settings.json'),
    ]),
    join(reader.homeDir(), '.claude', 'settings.json'),
  ];
  return claudeDecision(await claudeSettingsIn(reader, files));
}

interface Found {
  value: string;
  path: string;
}

/** What the files say, most specific first: the first mode named, and the first unscoped shell. */
interface ClaudeSettings {
  mode: Found | null;
  shell: Found | null;
  anyRead: string | null;
}

async function claudeSettingsIn(
  reader: MachineReader,
  files: readonly string[],
): Promise<ClaudeSettings> {
  const found: ClaudeSettings = { mode: null, shell: null, anyRead: null };
  for (const path of files) {
    const permissions = permissionsIn(await reader.read(path));
    if (permissions === null) continue;
    found.anyRead ??= path;
    const declared = stringField(permissions, 'defaultMode');
    if (found.mode === null && declared !== null) found.mode = { value: declared, path };
    const unscoped = unscopedShell(permissions);
    if (found.shell === null && unscoped !== null)
      found.shell = { value: unscoped, path };
  }
  return found;
}

function claudeDecision({ mode, shell, anyRead }: ClaudeSettings): ApprovalPosture {
  if (mode !== null && CLAUDE_AUTO_MODES.includes(mode.value)) {
    return {
      state: APPROVAL_STATE.AUTO,
      setting: `defaultMode = "${mode.value}"`,
      declaredIn: mode.path,
    };
  }
  if (shell !== null) {
    return {
      state: APPROVAL_STATE.AUTO,
      setting: `allow includes "${shell.value}"`,
      declaredIn: shell.path,
    };
  }
  if (mode !== null && CLAUDE_MODEL_MODES.includes(mode.value)) {
    return {
      state: APPROVAL_STATE.MODEL_REVIEWED,
      setting: `defaultMode = "${mode.value}"`,
      declaredIn: mode.path,
    };
  }
  if (anyRead === null) return UNKNOWN_POSTURE;
  return {
    state: APPROVAL_STATE.ASKS,
    setting: `defaultMode = "${mode?.value ?? 'default'}"`,
    declaredIn: mode?.path ?? anyRead,
  };
}

function unscopedShell(permissions: Record<string, unknown>): string | null {
  const allow = permissions['allow'];
  if (!Array.isArray(allow)) return null;
  const shell = allow.find(
    (entry): entry is string =>
      typeof entry === 'string' && CLAUDE_UNSCOPED_SHELL.includes(entry),
  );
  return shell ?? null;
}

/** The `permissions` object of a settings file, or null when the file says nothing. */
function permissionsIn(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A file that does not parse is not evidence either way.
    return null;
  }
  if (!isRecord(parsed)) return null;
  const permissions = parsed['permissions'];
  return isRecord(permissions) ? permissions : null;
}

/** Codex reads the active profile's policy first and the top level after it. */
async function codexPosture(reader: MachineReader): Promise<ApprovalPosture> {
  const path = join(reader.homeDir(), '.codex', 'config.toml');
  const raw = await reader.read(path);
  if (raw === null) return UNKNOWN_POSTURE;
  const parsed = parseTomlTables(raw);
  const policy = codexSetting(parsed, 'approval_policy');
  // Unset is the product's own default, which asks before anything outside the sandbox.
  if (policy === null) {
    return {
      state: APPROVAL_STATE.ASKS,
      setting: 'approval_policy unset',
      declaredIn: path,
    };
  }
  const sandbox = codexSetting(parsed, 'sandbox_mode');
  const setting =
    `approval_policy = "${policy}"` +
    (sandbox === null ? '' : `, sandbox_mode = "${sandbox}"`);
  return {
    state: CODEX_AUTO_POLICIES.includes(policy)
      ? APPROVAL_STATE.AUTO
      : APPROVAL_STATE.ASKS,
    setting,
    declaredIn: path,
  };
}

function codexSetting(parsed: TomlTables, key: string): string | null {
  const profile = stringAt(parsed, '', 'profile');
  const fromProfile =
    profile === null ? null : stringAt(parsed, `profiles.${profile}`, key);
  return fromProfile ?? stringAt(parsed, '', key);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

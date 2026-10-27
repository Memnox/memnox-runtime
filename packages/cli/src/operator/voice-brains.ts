import { onPath } from '../on-path';

/**
 * Every agent the voice can think with, in the order it is preferred: the ones that can be
 * shut into reading first, since the voice reads untrusted text and must never act on it.
 */

export const VOICE_BRAIN = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
  CURSOR: 'cursor',
  HERMES: 'hermes',
  OPENCLAW: 'openclaw',
} as const;

export type VoiceBrainKind = (typeof VOICE_BRAIN)[keyof typeof VOICE_BRAIN];

export interface VoiceBrainSpec {
  kind: VoiceBrainKind;
  /** As a person names it, which is also what the answer is credited to. */
  label: string;
  /** The binary, and what starts it speaking the Agent Client Protocol; Claude Code needs neither. */
  command: string;
  args: readonly string[];
  /** Modes that stop it editing or running anything, the first one it offers is taken. */
  readOnlyModes: readonly string[];
  /** Whether it can be shut into reading at all; one that cannot is used only when nothing else answers. */
  sealed: boolean;
  /** Whether it takes the operator server per session; one that does not needs it on its own config. */
  sessionTools: boolean;
  /** What to install when its binary is missing, said rather than guessed at. */
  install: string;
}

export const VOICE_BRAINS: readonly VoiceBrainSpec[] = [
  {
    kind: VOICE_BRAIN.CLAUDE_CODE,
    label: 'Claude Code',
    command: 'claude',
    args: [],
    readOnlyModes: [],
    sealed: true,
    sessionTools: true,
    install: 'install Claude Code and run claude once to log in',
  },
  {
    kind: VOICE_BRAIN.CODEX,
    label: 'Codex',
    command: 'codex-acp',
    args: [],
    readOnlyModes: ['read-only'],
    sealed: true,
    sessionTools: true,
    install: 'npm install -g @agentclientprotocol/codex-acp, then codex login',
  },
  {
    kind: VOICE_BRAIN.CURSOR,
    label: 'Cursor',
    command: 'cursor-agent',
    args: ['acp'],
    // Ask edits nothing and runs nothing, where plan may still run a command to look around.
    readOnlyModes: ['ask'],
    sealed: true,
    sessionTools: true,
    install: 'install the Cursor CLI and run cursor-agent login',
  },
  {
    kind: VOICE_BRAIN.HERMES,
    label: 'Hermes',
    command: 'hermes',
    args: ['acp'],
    // It has no read-only mode: this one asks before an edit or a dangerous command, and Memnox refuses every ask.
    readOnlyModes: ['default'],
    sealed: false,
    sessionTools: true,
    install: 'install Hermes Agent and run hermes setup',
  },
  {
    kind: VOICE_BRAIN.OPENCLAW,
    label: 'OpenClaw',
    command: 'openclaw',
    args: ['acp'],
    readOnlyModes: [],
    sealed: false,
    // Its bridge refuses per-session servers, so memnox-operator goes on its gateway instead.
    sessionTools: false,
    install: 'install OpenClaw and add memnox-operator to its gateway MCP servers',
  },
];

/** Where an env names the brain, so a person can pin one without running setup. */
export const VOICE_BRAIN_VAR = 'MEMNOX_VOICE_BRAIN';

export function voiceBrainSpec(kind: string): VoiceBrainSpec | null {
  return VOICE_BRAINS.find((spec) => spec.kind === kind) ?? null;
}

/** The brains whose binary is here, in the order they are preferred. */
export function installedBrains(
  path = process.env['PATH'] ?? '',
  isFound?: (candidate: string) => boolean,
): VoiceBrainSpec[] {
  return VOICE_BRAINS.filter((spec) => onPath(spec.command, path, isFound));
}

/** Said once at the top of a conversation with a brain that could not be shut into reading. */
export function unsealedNote(spec: VoiceBrainSpec): string {
  return `I am answering through ${spec.label}, which can run ordinary shell commands without asking. `;
}

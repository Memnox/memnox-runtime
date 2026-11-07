/**
 * `/fingerprint` in each agent: a hook can tell a person a repository has no fingerprint but
 * cannot put a prompt in their input, so the prompt is one word they can type instead.
 */
import { join } from 'node:path';
import { NATIVE_PLACED, placeNativeFile, removeNativeFile } from '@memnox/core';

/** How a file of ours is told from one a person wrote under the same name, which is kept. */
const OURS = 'memnox: written by memnox setup, and removed with the session tools';

const STEPS = `Record this repository's code fingerprint with Memnox.

1. Call the memnox-session "fingerprint" tool with no arguments and follow what it says to write.
2. Read enough of this repository to see how its code is actually written: its README, its layout, a few files from each layer, and how often the patterns you mean to enforce appear.
3. Call the "fingerprint" tool again with the yaml.
4. Tell me what was recorded, which checks are enforced, which were dropped and why, and remind me to review and commit .memnox/code-fingerprint.yaml.

If the repository already states one, say so and tell me what it enforces instead.`;

const DESCRIPTION =
  "Record how this repository's code is written, as its Memnox code fingerprint";

const MARKDOWN_WITH_DESCRIPTION = `---
description: ${DESCRIPTION}
---
${STEPS}

<!-- ${OURS} -->
`;

const MARKDOWN = `# Fingerprint

${STEPS}

<!-- ${OURS} -->
`;

const TOML = `# ${OURS}
description = "${DESCRIPTION}"
prompt = """
${STEPS}
"""
`;

/** One agent's command: where it lives, what it says, and what the person types. */
export interface FingerprintCommand {
  /** As `SESSION_TARGETS` names the agent, so it is written only where the tool it calls is. */
  agent: string;
  file: string;
  text: string;
  typed: string;
}

export const FINGERPRINT_COMMANDS: readonly FingerprintCommand[] = [
  {
    agent: 'Claude Code',
    file: join('.claude', 'commands', 'fingerprint.md'),
    text: MARKDOWN_WITH_DESCRIPTION,
    typed: '/fingerprint',
  },
  {
    agent: 'Codex',
    file: join('.codex', 'prompts', 'fingerprint.md'),
    text: MARKDOWN_WITH_DESCRIPTION,
    typed: '/prompts:fingerprint',
  },
  {
    agent: 'Gemini CLI',
    file: join('.gemini', 'commands', 'fingerprint.toml'),
    text: TOML,
    typed: '/fingerprint',
  },
  {
    agent: 'Cursor',
    file: join('.cursor', 'commands', 'fingerprint.md'),
    text: MARKDOWN,
    typed: '/fingerprint',
  },
  {
    agent: 'Windsurf',
    file: join('.codeium', 'windsurf', 'global_workflows', 'fingerprint.md'),
    text: MARKDOWN,
    typed: '/fingerprint',
  },
];

/** Written for each agent named, and never over a command a person wrote; the files written. */
export async function placeFingerprintCommands(
  home: string,
  agents: readonly string[],
): Promise<string[]> {
  const written: string[] = [];
  for (const command of FINGERPRINT_COMMANDS) {
    if (!agents.includes(command.agent)) continue;
    if (await placeOne(home, command)) written.push(join(home, command.file));
  }
  return written;
}

async function placeOne(home: string, command: FingerprintCommand): Promise<boolean> {
  const placed = await placeNativeFile(
    { path: join(home, command.file), content: command.text },
    OURS,
  );
  return placed === NATIVE_PLACED.WRITTEN;
}

/** Every one of ours taken out, and only ours; the files removed. */
export async function removeFingerprintCommands(home: string): Promise<string[]> {
  const removed: string[] = [];
  for (const command of FINGERPRINT_COMMANDS) {
    const path = join(home, command.file);
    if (await removeNativeFile(path, OURS)) removed.push(path);
  }
  return removed;
}

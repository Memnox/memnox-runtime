import type { DiscoveredAgentKind } from '../../discovery/discovery.constants';
import { CLAUDE_CODE_FORMAT } from './claude-code';
import { CODEX_FORMAT } from './codex';
import { COPILOT_FORMAT } from './copilot';
import { CURSOR_FORMAT } from './cursor';
import { GEMINI_CLI_FORMAT } from './gemini-cli';
import { OPENCODE_FORMAT } from './opencode';
import type { SkillFormat } from './translation';
import { WINDSURF_FORMAT } from './windsurf';

export * from './translation';

/** Every agent a skill can be written into, in the order a screen lists them. */
export const SKILL_FORMATS: readonly SkillFormat[] = [
  CLAUDE_CODE_FORMAT,
  CODEX_FORMAT,
  CURSOR_FORMAT,
  GEMINI_CLI_FORMAT,
  OPENCODE_FORMAT,
  COPILOT_FORMAT,
  WINDSURF_FORMAT,
];

export function skillFormatFor(agent: string): SkillFormat | null {
  return SKILL_FORMATS.find((format) => format.agent === agent) ?? null;
}

/** Whether this agent takes skills at all. */
export function takesSkills(agent: string): agent is DiscoveredAgentKind {
  return skillFormatFor(agent) !== null;
}

import { OURS_MARKER, withNativeBlock } from '../distribute/native-files';
import type {
  SkillCalibration,
  SkillDraft,
  SkillStatsView,
  SkillView,
} from '../daemon/skills-hub';

/**
 * Skills that get better with use: how often each was used and how often what ran inside it failed
 * or was refused, and a suggested SKILL.md built from its fix backlog and those failures. Built
 * here by rule from what was written down, never by a model; the person accepts it through SKILL_PUT.
 */

/** What happened inside one skill's turn, as read from a transcript. */
export const SKILL_OUTCOME = {
  USE: 'use',
  FAILURE: 'failure',
  REFUSAL: 'refusal',
} as const;

export type SkillOutcome = (typeof SKILL_OUTCOME)[keyof typeof SKILL_OUTCOME];

export interface SkillEvent {
  skill: string;
  /** ISO 8601. */
  at: string;
  outcome: SkillOutcome;
  /** On a failure or a refusal: the first line of what the tool said. */
  said?: string;
}

/** The fence around the section a calibration writes, so a second one replaces the first. */
export const KNOWN_ISSUES_MARKERS = {
  begin: `<!-- ${OURS_MARKER}: known issues from the fix backlog -->`,
  end: '<!-- memnox: end of the known issues -->',
};

const SECTION_HEADING = '## Known issues / fixes';
/** Recent failures a view and a calibration carry, newest first. */
const MOST_FAILURES_SHOWN = 5;

/** A skill name as an agent invokes it: a plugin's `plugin:name` is the same skill as `name`. */
export function skillNameInvoked(invoked: string): string {
  const colon = invoked.lastIndexOf(':');
  return (colon < 0 ? invoked : invoked.slice(colon + 1)).trim();
}

/** Every named skill's counts, a skill never used included at nought. */
export function skillStatsOf(
  names: readonly string[],
  events: readonly SkillEvent[],
  notes: ReadonlyMap<string, readonly string[]>,
): SkillStatsView[] {
  return names.map((name) => {
    const own = events.filter((event) => event.skill === name);
    const uses = own.filter((event) => event.outcome === SKILL_OUTCOME.USE);
    const lastUsedAt = uses
      .map((event) => event.at)
      .sort()
      .at(-1);
    return {
      name,
      uses: uses.length,
      failures: own.filter((event) => event.outcome === SKILL_OUTCOME.FAILURE).length,
      refusals: own.filter((event) => event.outcome === SKILL_OUTCOME.REFUSAL).length,
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
      notes: [...(notes.get(name) ?? [])],
      recentFailures: recentFailures(own),
    };
  });
}

function recentFailures(events: readonly SkillEvent[]): string[] {
  const said = events
    .filter((event) => event.outcome !== SKILL_OUTCOME.USE && event.said !== undefined)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((event) => event.said ?? '');
  return [...new Set(said)].slice(0, MOST_FAILURES_SHOWN);
}

/** The next version: a patch step on a dotted number, else a `.1` after whatever it was. */
export function nextSkillVersion(version: string): string {
  const parts = version.split('.');
  const last = parts.at(-1) ?? '';
  if (/^\d+$/.test(last))
    return [...parts.slice(0, -1), String(Number(last) + 1)].join('.');
  return `${version}.1`;
}

/** The section's lines: each note, then what failed, each said once. */
function sectionOf(notes: readonly string[], failures: readonly string[]): string {
  const lines = [
    SECTION_HEADING,
    '',
    ...notes.map((note) => `- ${note}`),
    ...failures.map((said) => `- When it failed: ${said}`),
  ];
  return lines.join('\n');
}

/** A skill to calibrate: as the hub shows it, its counts, and the text files beside its instructions. */
export interface SkillToCalibrate {
  skill: SkillView;
  stats: SkillStatsView;
  files: readonly { path: string; text: string }[];
}

/** The suggested change, or null where the backlog is empty and nothing failed. */
export function calibrateSkill({
  skill,
  stats,
  files,
}: SkillToCalibrate): SkillCalibration | null {
  const notes = stats.notes.map((note) => note.trim()).filter((note) => note !== '');
  if (notes.length === 0 && stats.recentFailures.length === 0) return null;
  const section = sectionOf(notes, stats.recentFailures);
  const instructions = withNativeBlock(skill.instructions, section, KNOWN_ISSUES_MARKERS);
  return {
    name: skill.name,
    section,
    before: skill.instructions.split('\n'),
    after: instructions.split('\n'),
    draft: { ...draftOf(skill, instructions), files: [...files] },
    notes: notes.length,
    failures: stats.recentFailures.length,
  };
}

/** The skill as SKILL_PUT takes it, its reach exactly as accepted so the put widens nothing. */
function draftOf(skill: SkillView, instructions: string): SkillDraft {
  return {
    name: skill.name,
    version: nextSkillVersion(skill.version),
    description: skill.description,
    ...(skill.category === undefined ? {} : { category: skill.category }),
    ...(skill.publisher === undefined ? {} : { publisher: skill.publisher }),
    instructions,
    tools: [...skill.tools],
    mcpServers: [...skill.mcpServers],
    dependencies: [...skill.dependencies],
    agents: [...skill.agents],
    permissions: { ...skill.permissions },
  };
}

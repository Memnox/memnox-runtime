import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  NATIVE_PLACED,
  placeNativeFile,
  placeNativeFolder,
  removeNativeFile,
  removeNativeFolder,
  skillFormatFor,
  TOOL_CLASS,
  writeSkillsHub,
  type HubSkill,
  type NativePlaced,
  type SkillAssignment,
  type SkillsHub,
  type SkillsSyncSummary,
  type SkillWritten,
  type Translation,
} from '@memnox/core';
import {
  CONFIG_RULE,
  recordConfigChanges,
  type ConfigRecord,
} from '../keeper/config-events';
import { readKeptSkill, type KeptSkill } from './skill-standing';

/**
 * Writing what the hub holds into each agent's own folders, through the marked writer: only files
 * the hub wrote are ever changed or removed, and a skill of the same name a person wrote is left.
 */

export interface SkillsSynced {
  hub: SkillsHub;
  summary: SkillsSyncSummary;
}

const OPERATION = {
  WRITTEN: 'skills.written',
  REMOVED: 'skills.removed',
} as const;

const SOMEBODY_ELSES =
  'You already have a skill with this name here, so it is left as it is.';

/** One skill wanted in one agent's folder, translated. */
interface Wanted {
  skill: string;
  agent: SkillAssignment['agent'];
  root: string;
  translation: Translation;
}

/** Every enabled, accepted skill written where it is assigned; a held one stays as last written. */
export async function syncSkills(
  home: string,
  hub: SkillsHub,
  now: Date,
): Promise<SkillsSynced> {
  const wanted: Wanted[] = [];
  const kept: SkillWritten[] = [];
  const skipped: SkillsSyncSummary['skipped'] = [];
  for (const skill of hub.skills.filter((each) => each.enabled)) {
    const read = await readKeptSkill(home, skill);
    if (read.held !== undefined || read.skill === undefined) {
      kept.push(...hub.written.filter((each) => each.skill === skill.name));
      continue;
    }
    wanted.push(...wantedOf(home, skill, read, skipped));
  }
  const removed = await removeStale(hub.written, [...wanted, ...kept]);
  const placed = await placeWanted(hub.written, wanted, skipped);
  const next = { ...hub, written: [...kept, ...placed.written] };
  await writeSkillsHub(home, next);
  await recordConfigChanges(home, [...placed.records, ...removed.records], now);
  return {
    hub: next,
    summary: {
      written: placed.records.length,
      removed: removed.records.length,
      files: [...placed.records, ...removed.records].flatMap((each) => each.file ?? []),
      skipped,
    },
  };
}

function wantedOf(
  home: string,
  skill: HubSkill,
  read: KeptSkill,
  skipped: SkillsSyncSummary['skipped'],
): Wanted[] {
  const canonical = read.skill;
  if (canonical === undefined) return [];
  return skill.assignments.flatMap((assignment) => {
    const format = skillFormatFor(assignment.agent);
    const root = rootOf(home, skill, assignment);
    if (format === null) {
      skipped.push({
        skill: skill.name,
        agent: assignment.agent,
        path: root,
        reason: 'Memnox writes no skill format for this agent yet.',
      });
      return [];
    }
    const hasSkillsFolder = existsSync(join(root, format.installedDir, 'skills'));
    const translation = format.translate(canonical, {
      project: root !== home,
      hasSkillsFolder,
    });
    return [{ skill: skill.name, agent: assignment.agent, root, translation }];
  });
}

/** A project skill goes into its repository unless it is assigned to another; a personal one into home. */
function rootOf(home: string, skill: HubSkill, assignment: SkillAssignment): string {
  if (assignment.project !== undefined) return assignment.project;
  return skill.project ?? home;
}

function pathOf(translation: Translation): string {
  return 'folder' in translation ? translation.folder.dir : translation.file.path;
}

function sameSpot(written: SkillWritten, root: string, path: string): boolean {
  return written.root === root && written.path === path;
}

/** Everything the hub wrote before and does not want now, taken out where it is still ours. */
async function removeStale(
  written: readonly SkillWritten[],
  keep: readonly (Wanted | SkillWritten)[],
): Promise<{ records: ConfigRecord[] }> {
  const records: ConfigRecord[] = [];
  for (const each of written) {
    const stays = keep.some((other) =>
      'translation' in other
        ? sameSpot(each, other.root, pathOf(other.translation))
        : sameSpot(each, other.root, other.path),
    );
    if (stays) continue;
    const full = join(each.root, each.path);
    const gone =
      each.markerFile === undefined
        ? await removeNativeFile(full)
        : await removeNativeFolder({
            dir: full,
            markerFile: each.markerFile,
            files: each.files ?? [],
          });
    if (gone)
      records.push(
        recordOf(
          OPERATION.REMOVED,
          each,
          `took the skill ${each.skill} out of ${each.agent}`,
        ),
      );
  }
  return { records };
}

async function placeWanted(
  before: readonly SkillWritten[],
  wanted: readonly Wanted[],
  skipped: SkillsSyncSummary['skipped'],
): Promise<{ written: SkillWritten[]; records: ConfigRecord[] }> {
  const written: SkillWritten[] = [];
  const records: ConfigRecord[] = [];
  for (const each of wanted) {
    const record = writtenOf(each);
    const previous = before.find((other) => sameSpot(other, each.root, record.path));
    const placed = await placeOne(each, previous);
    if (placed === NATIVE_PLACED.KEPT) {
      skipped.push({
        skill: each.skill,
        agent: each.agent,
        path: join(each.root, record.path),
        reason: SOMEBODY_ELSES,
      });
      continue;
    }
    written.push(record);
    if (placed === NATIVE_PLACED.WRITTEN)
      records.push(
        recordOf(
          OPERATION.WRITTEN,
          record,
          `wrote the skill ${each.skill} into ${each.agent}`,
        ),
      );
  }
  return { written, records };
}

function placeOne(
  each: Wanted,
  previous: SkillWritten | undefined,
): Promise<NativePlaced> {
  const { translation, root } = each;
  if ('file' in translation)
    return placeNativeFile({
      path: join(root, translation.file.path),
      content: translation.file.content,
    });
  const folder = translation.folder;
  return placeNativeFolder(
    { ...folder, dir: join(root, folder.dir) },
    { previous: previous === undefined ? [] : (previous.files ?? []) },
  );
}

function writtenOf(each: Wanted): SkillWritten {
  const { translation } = each;
  const where = { skill: each.skill, agent: each.agent, root: each.root };
  if ('file' in translation) return { ...where, path: translation.file.path };
  return {
    ...where,
    path: translation.folder.dir,
    markerFile: translation.folder.markerFile,
    files: translation.folder.files.map((file) => file.relative),
  };
}

function recordOf(
  operation: string,
  written: SkillWritten,
  summary: string,
): ConfigRecord {
  return {
    operation,
    agent: written.agent,
    file: join(written.root, written.path),
    summary,
    class: TOOL_CLASS.WRITE,
    rule: CONFIG_RULE.SKILLS,
  };
}

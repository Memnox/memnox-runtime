import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  calibrateSkill,
  MEMNOX_HOME,
  readCanonicalSkill,
  readSkillsHub,
  skillDirFor,
  skillNamed,
  skillStatsOf,
  type SkillCalibration,
  type SkillStatsView,
} from '@memnox/core';
import { recentTranscriptUsage } from '../daemon/transcript-usage';
import { readSkillsView } from './skills-view';

/**
 * A skill's fix backlog and its counts: a note is one line added to a file of the backlog's own,
 * kept outside the skill's folder so writing one never changes what was accepted, and a
 * calibration is the suggestion the hub accepts through SKILL_PUT like any other new version.
 */

/** Outside `~/.memnox/skills`, whose every folder there is read as a skill's version. */
const NOTES_DIR = 'skill-notes';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** One note is a line; past this it is a document, which belongs in the skill itself. */
const MOST_NOTE_CHARS = 500;

function notesPathFor(home: string, name: string): string | null {
  return SAFE_NAME.test(name) ? join(home, MEMNOX_HOME, NOTES_DIR, `${name}.md`) : null;
}

/** The backlog, oldest first; a skill nobody noted has none. */
async function readSkillNotes(home: string, name: string): Promise<string[]> {
  const path = notesPathFor(home, name);
  if (path === null) return [];
  const text = await readFile(path, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line !== '');
}

/** One line added to the backlog, or why it was not. */
export async function addSkillNote(
  home: string,
  name: string,
  note: string,
): Promise<{ refused: string } | { added: true }> {
  const path = notesPathFor(home, name);
  if (path === null)
    return { refused: `${name} is not a skill name a backlog can be kept for.` };
  const line = note.replace(/\s+/g, ' ').trim();
  if (line === '') return { refused: 'Say what to note.' };
  if (line.length > MOST_NOTE_CHARS)
    return { refused: `Keep a note to ${MOST_NOTE_CHARS} characters; it is one fix.` };
  if (skillNamed(await readSkillsHub(home), name) === undefined)
    return { refused: `No skill ${name} in the hub.` };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `- ${line}\n`, 'utf8');
  return { added: true };
}

/** Every hub skill's counts over the chats lately, with its backlog. */
export async function readSkillStats(home: string, now: Date): Promise<SkillStatsView[]> {
  const [hub, usage] = await Promise.all([
    readSkillsHub(home),
    recentTranscriptUsage(home, now),
  ]);
  const names = hub.skills.map((skill) => skill.name);
  const notes = new Map(
    await Promise.all(
      names.map(async (name): Promise<[string, string[]]> => [
        name,
        await readSkillNotes(home, name),
      ]),
    ),
  );
  return skillStatsOf(names, usage.skills, notes);
}

/** The suggested change for one skill, null where nothing was noted and nothing failed. */
export async function calibrate(
  home: string,
  name: string,
  now: Date,
): Promise<{ refused: string } | { calibration: SkillCalibration | null }> {
  const hub = await readSkillsHub(home);
  const kept = skillNamed(hub, name);
  const view = (await readSkillsView(home)).skills.find((each) => each.name === name);
  if (kept === undefined || view === undefined)
    return { refused: `No skill ${name} in the hub.` };
  const stats = (await readSkillStats(home, now)).find((each) => each.name === name);
  if (stats === undefined) return { calibration: null };
  const read = await readCanonicalSkill(
    skillDirFor(home, {
      name,
      scope: kept.scope,
      version: kept.current,
      ...(kept.project === undefined ? {} : { project: kept.project }),
    }),
  );
  if ('problems' in read) return { refused: read.problems.join(' ') };
  // A put carries text files only, so a skill with any other kind is changed in its own folder.
  if (read.skill.files.some((file) => Buffer.from(file.bytes).includes(0)))
    return {
      refused: `${name} keeps files that are not text, so change it in its own folder.`,
    };
  const files = read.skill.files.map((file) => ({
    path: file.path,
    text: Buffer.from(file.bytes).toString('utf8'),
  }));
  return { calibration: calibrateSkill({ skill: view, stats, files }) };
}

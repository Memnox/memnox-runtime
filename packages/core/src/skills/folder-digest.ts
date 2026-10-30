import { createHash } from 'node:crypto';
import { SKILL_INSTRUCTIONS, type CanonicalSkill } from './skill';

/**
 * One digest over every file of a skill, sorted by path, so a change to any file of it, a script as
 * much as the instructions, reads as a changed skill. The manifest is left out, since it states the digest.
 */

const DIGEST_PREFIX = 'sha256:';

export function folderDigest(
  skill: Pick<CanonicalSkill, 'instructions' | 'files'>,
): string {
  const files = [
    { path: SKILL_INSTRUCTIONS, bytes: Buffer.from(skill.instructions, 'utf8') },
    ...skill.files,
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const file of files) {
    // Path and length before the bytes, so moving bytes from one file to the next changes the digest.
    hash.update(`${file.path}\u0000${file.bytes.length}\u0000`);
    hash.update(file.bytes);
  }
  return `${DIGEST_PREFIX}${hash.digest('hex')}`;
}

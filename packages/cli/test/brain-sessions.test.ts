import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBrainSessions, rememberBrainSession } from '../src/operator/brain-sessions';
import { brainSessionsPath } from '../src/memnox-paths';

describe("the voice brain's own sessions in an agent", () => {
  it('keeps each session once, and reads back none where nothing was kept', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-brain-sessions-'));
    expect(await readBrainSessions(home)).toEqual(new Set());

    await rememberBrainSession(home, 'ses-1');
    await rememberBrainSession(home, 'ses-2');
    await rememberBrainSession(home, 'ses-1');

    expect(await readBrainSessions(home)).toEqual(new Set(['ses-1', 'ses-2']));
  });

  it('is bounded, the oldest dropped first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-brain-sessions-'));
    for (let each = 0; each < 505; each += 1) {
      await rememberBrainSession(home, `ses-${each}`);
    }

    const kept = JSON.parse(await readFile(brainSessionsPath(home), 'utf8')) as string[];
    expect(kept).toHaveLength(500);
    expect(kept[0]).toBe('ses-5');
    expect(kept.at(-1)).toBe('ses-504');
  });
});

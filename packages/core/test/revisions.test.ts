import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeRevisionChange,
  EarnedAllowances,
  FileRevisions,
  REVISION_KIND,
  REVISIONS_KEPT,
  revisionChange,
  writePolicyDocumentFile,
  DECISION_EFFECT,
  type Policy,
} from '../src/index';

const AT = '2026-11-11T12:00:00.000Z';

const rule = (name: string): Policy => ({
  name,
  match: { actions: ['git.push-force'] },
  decision: {
    effect: DECISION_EFFECT.DENY,
    reason: 'force pushes rewrite shared history',
  },
});

async function place(): Promise<{ home: string; file: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-revisions-'));
  return { home, file: join(home, 'memnox.policies.toml') };
}

describe('every change to the rules is kept', () => {
  it('keeps what the file said before each write, and names what changed', async () => {
    const { home, file } = await place();
    const revisions = new FileRevisions(home);
    await writePolicyDocumentFile(
      file,
      { version: 1, policies: [rule('no-force')] },
      revisions,
    );
    await writePolicyDocumentFile(
      file,
      { version: 1, policies: [rule('no-force'), rule('no-reset')] },
      revisions,
    );

    const [newest, first] = await revisions.list(REVISION_KIND.RULES);
    expect(first?.content).toBe('');
    expect(newest?.n).toBe(2);
    const now = await readFile(file, 'utf8');
    if (newest === undefined) throw new Error('no revision kept');
    expect(describeRevisionChange(revisionChange(newest, now))).toBe('added no-reset');
  });

  it('puts a file back, and keeps what stood so the revert can be undone', async () => {
    const { home, file } = await place();
    const revisions = new FileRevisions(home);
    await writePolicyDocumentFile(
      file,
      { version: 1, policies: [rule('no-force')] },
      revisions,
    );
    const before = await readFile(file, 'utf8');
    await writePolicyDocumentFile(file, { version: 1, policies: [] }, revisions);

    await revisions.revert(2, AT);

    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await revisions.list())[0]?.n).toBe(3);
  });

  it('says nothing about a revision it no longer has', async () => {
    const { home } = await place();
    expect(await new FileRevisions(home).revert(7, AT)).toBeNull();
  });

  it('keeps only the newest, so the folder never grows', async () => {
    const { home, file } = await place();
    const revisions = new FileRevisions(home);
    for (let n = 0; n < REVISIONS_KEPT + 3; n += 1) {
      await writeFile(file, `# ${n}\n`);
      await revisions.keep(file, REVISION_KIND.RULES, AT);
    }
    const kept = await revisions.list();
    expect(kept).toHaveLength(REVISIONS_KEPT);
    expect(kept[0]?.n).toBe(REVISIONS_KEPT + 3);
  });

  it('keeps a step for each grant the autopilot makes', async () => {
    const { home } = await place();
    await new EarnedAllowances(home).add({
      id: 'alw_1',
      actions: ['npm.test'],
      by: 'autopilot',
      since: AT,
      until: '2026-11-18T12:00:00.000Z',
    });
    expect(await new FileRevisions(home).list(REVISION_KIND.ALLOWANCES)).toHaveLength(1);
  });
});

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPolicyFiles } from '../src/gate/policy-sources';
import { orgPolicyPathFor } from '../src/policy/org-bundle';

describe('the files a seam reads its rules from', () => {
  it("keeps the workspace's rules when the environment names other files", async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-sources-'));
    const org = orgPolicyPathFor(home);
    await mkdir(dirname(org), { recursive: true });
    await writeFile(org, '{"version":1,"policies":[]}');

    expect(await readPolicyFiles('/work/mine.toml', home)).toEqual([
      '/work/mine.toml',
      org,
    ]);
    expect(await readPolicyFiles(`${org},/work/mine.toml`, home)).toEqual([
      org,
      '/work/mine.toml',
    ]);
  });

  it('adds nothing on a machine that never pulled a workspace bundle', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-sources-'));

    expect(await readPolicyFiles('/work/mine.toml', home)).toEqual(['/work/mine.toml']);
  });
});

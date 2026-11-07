import { describe, expect, it } from 'vitest';
import { projectLookup } from '../src/projects/project-at';

describe('a folder project lookup for a long-lived seam', () => {
  it('asks once per folder while the answer is fresh, and again once it is not', async () => {
    let clock = 0;
    const asked: string[] = [];
    const lookup = projectLookup('/home', {
      find: async (_home, cwd) => {
        asked.push(cwd);
        return 'billing';
      },
      now: () => clock,
    });

    expect(await lookup('/work/billing')).toBe('billing');
    expect(await lookup('/work/billing')).toBe('billing');
    expect(asked).toEqual(['/work/billing']);
    clock = 60_000;
    await lookup('/work/billing');
    expect(asked).toHaveLength(2);
  });

  it('names no project when the lookup fails, so only the machine rules decide', async () => {
    const lookup = projectLookup('/home', {
      find: async () => {
        throw new Error('git is gone');
      },
    });

    expect(await lookup('/work/billing')).toBeUndefined();
  });
});

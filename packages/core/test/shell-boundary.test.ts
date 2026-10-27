import { describe, expect, it } from 'vitest';
import { LocalGate } from '../src/gate/local-gate';
import { resolveShellLine } from '../src/intercept/resolve';

/* The project boundary held the file tools and nothing else: `cd` somewhere else and a
   write with a relative path, or an interpreter opening a file by its absolute path,
   edited another repository without anybody being asked. */
const ROOT = '/Users/me/work/cloud';
const ENV = { HOME: '/Users/me', PWD: ROOT };

const effectsOf = (line: string): string[] => {
  const gate = new LocalGate(
    [
      {
        name: 'allow-all',
        match: { actions: ['*'] },
        decision: { effect: 'allow', reason: 'this machine trusts its agents' },
      },
    ] as never,
    {
      agentName: 'claude-code',
      containment: { root: ROOT, cwd: ROOT, home: '/Users/me' },
    },
  );
  return resolveShellLine(line, ENV).actions.map(
    (each) =>
      gate.evaluate({
        action: each.action,
        toolClass: each.class,
        ...(each.target === undefined ? {} : { target: each.target }),
      }).effect,
  );
};

describe('the project boundary, through the shell', () => {
  it.each([
    "cd /Users/me/work/runtime && sed -i '' s/a/b/ src/gate.ts",
    "cd /Users/me/work/runtime && python3 - <<'EOF'\nopen('src/gate.ts','w').write('x')\nEOF",
    `python3 -c "open('/Users/me/work/runtime/src/gate.ts','w').write('x')"`,
    'git -C /Users/me/work/runtime commit -am wip',
    'cd /Users/me/work/runtime && $EDITOR src/gate.ts',
    'cd /Users/me/work/runtime && f=$(ls src | head -1); sed -i "" s/a/b/ $f',
  ])('asks before `%s` reaches another repository', (line) => {
    expect(effectsOf(line)).toContain('ask');
  });

  it.each([
    "cd /Users/me/work/cloud/src && sed -i '' s/a/b/ gate.ts",
    'cat /Users/me/work/runtime/src/gate.ts',
    'grep -r lease /Users/me/work/runtime/src',
    'pnpm test',
    'cd /Users/me/work/runtime && f=$(grep -rl lease src | head -1); grep -n token $f',
  ])('leaves `%s` alone, inside the project or only reading', (line) => {
    expect(effectsOf(line)).not.toContain('ask');
  });
});

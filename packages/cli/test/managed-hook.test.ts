import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_SEAT } from '@memnox/core';
import { describe, expect, it } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { installClaudeHook } from '../src/protect/claude-hook';
import {
  hookSeatOf,
  managedSettingsPath,
  runManagedHook,
  withManagedHook,
  withoutManagedHook,
} from '../src/protect/managed-hook';
import { plainStyle } from '../src/style';

const COMMAND = 'memnox-edit-hook --policy --agent claude-code';

async function machine(): Promise<{ home: string; managedDir: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), 'memnox-managed-'));
  const home = join(root, 'home');
  const managedDir = join(root, 'managed');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(managedDir, { recursive: true });
  return { home, managedDir, target: join(managedDir, 'managed-settings.json') };
}

function context(): { context: CliContext; said: () => string } {
  const output = new RecordedOutput();
  const run = new CliContext(output, plainStyle);
  // As `memnox protect` does before any branch, since a hint is drawn only on an open rail.
  run.flow.open('memnox protect');
  return {
    context: run,
    said: () => [...output.lines, ...output.notes].join('\n'),
  };
}

const userSettings = (home: string): string => join(home, '.claude', 'settings.json');

describe('the hook in managed settings', () => {
  it('keeps what an MDM profile already put there, and adds ours', () => {
    const next = withManagedHook({ model: 'opus', env: { A: '1' } }, COMMAND, false);
    expect(next['model']).toBe('opus');
    expect(JSON.stringify(next['hooks'])).toContain(COMMAND);
    expect(next['allowManagedHooksOnly']).toBeUndefined();
  });

  it('switches user hooks off only when asked, and a revert undoes only its own switch', () => {
    const exclusive = withManagedHook({}, COMMAND, true);
    expect(exclusive['allowManagedHooksOnly']).toBe(true);
    expect(withoutManagedHook(exclusive)).toEqual({});

    // An administrator's own switch is theirs, so taking our hook out leaves it standing.
    const theirs = withManagedHook({ allowManagedHooksOnly: true }, COMMAND, true);
    expect(withoutManagedHook(theirs)).toEqual({ allowManagedHooksOnly: true });
  });

  it('knows the managed file on the two platforms that have one', () => {
    expect(managedSettingsPath('darwin')).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    );
    expect(managedSettingsPath('linux')).toBe('/etc/claude-code/managed-settings.json');
    expect(managedSettingsPath('win32')).toBeNull();
  });

  it('reads where the hook sits off the two files', () => {
    const hooked = JSON.stringify(withManagedHook({}, COMMAND, false));
    expect(hookSeatOf(null, null)).toBe(HOOK_SEAT.NONE);
    expect(hookSeatOf(hooked, null)).toBe(HOOK_SEAT.USER);
    expect(hookSeatOf(null, hooked)).toBe(HOOK_SEAT.MANAGED);
    expect(hookSeatOf(hooked, hooked)).toBe(HOOK_SEAT.BOTH);
  });
});

describe('memnox protect --managed', () => {
  it('writes the managed file where it may, and takes the user copy out', async () => {
    const { home, target } = await machine();
    await installClaudeHook(home);
    const { context: run } = context();

    await runManagedHook(
      run,
      { reverting: false, exclusive: false },
      {
        home: () => home,
        target: () => target,
      },
    );

    const seat = hookSeatOf(
      await readFile(userSettings(home), 'utf8'),
      await readFile(target, 'utf8'),
    );
    expect(seat).toBe(HOOK_SEAT.MANAGED);
  });

  it('stages the file and names the sudo command where root owns it, leaving the user copy', async () => {
    const { home, managedDir, target } = await machine();
    await installClaudeHook(home);
    await chmod(managedDir, 0o500);
    const { context: run, said } = context();

    try {
      await runManagedHook(
        run,
        { reverting: false, exclusive: false },
        {
          home: () => home,
          target: () => target,
        },
      );
    } finally {
      await chmod(managedDir, 0o700);
    }

    expect(existsSync(target)).toBe(false);
    const staged = join(
      home,
      '.memnox',
      'managed',
      'claude-code',
      'managed-settings.json',
    );
    expect(await readFile(staged, 'utf8')).toContain(COMMAND);
    expect(said()).toContain(`sudo install -m 0644 "${staged}" "${target}"`);
    // No moment with neither copy in place: the user one stays until the managed one is live.
    expect(await readFile(userSettings(home), 'utf8')).toContain('memnox-edit-hook');
  });

  it('takes the user copy out on the second run, once the staged file is installed', async () => {
    const { home, target } = await machine();
    await installClaudeHook(home);
    await writeFile(
      target,
      JSON.stringify(withManagedHook({}, COMMAND, false), null, 2) + '\n',
    );

    await runManagedHook(
      context().context,
      { reverting: false, exclusive: false },
      {
        home: () => home,
        target: () => target,
      },
    );

    expect(await readFile(userSettings(home), 'utf8')).not.toContain('memnox-edit-hook');
  });

  it('moves the hook back into the user file on revert', async () => {
    const { home, target } = await machine();
    await writeFile(
      target,
      JSON.stringify(withManagedHook({ model: 'opus' }, COMMAND, true)),
    );

    await runManagedHook(
      context().context,
      { reverting: true, exclusive: false },
      {
        home: () => home,
        target: () => target,
      },
    );

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ model: 'opus' });
    expect(await readFile(userSettings(home), 'utf8')).toContain('memnox-edit-hook');
  });

  it('leaves a managed file that is not JSON alone and says so', async () => {
    const { home, target } = await machine();
    await writeFile(target, '{ not json');

    await expect(
      runManagedHook(
        context().context,
        { reverting: false, exclusive: false },
        {
          home: () => home,
          target: () => target,
        },
      ),
    ).rejects.toThrow(/not plain JSON/);
    expect(await readFile(target, 'utf8')).toBe('{ not json');
  });
});

import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerUpdateCommand, type UpdateDeps } from '../src/commands/update.command';
import {
  INSTALL_METHOD,
  installOf,
  isNewer,
  pinnedTo,
  recordUpdate,
} from '../src/commands/update/install';
import type { Verdict } from '../src/commands/update/provenance';
import { keepBoundary } from '../src/keeper/kept';
import type { Wiring } from '../src/setup-wiring';

/**
 * `memnox update` says what is installed and what is out, and upgrades only after a yes,
 * with the command for how this copy was installed. Nothing here reaches a network or
 * runs a package manager: the lookup, the installer and the rewiring are all injected.
 */

const NPM_ENTRY = '/usr/local/lib/node_modules/memnox/dist/index.js';

interface Harness {
  out: RecordedOutput;
  run: ReturnType<typeof vi.fn>;
  rewire: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
}

async function update(
  overrides: Partial<UpdateDeps>,
  args: string[] = ['update'],
): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-update-'));
  const out = new RecordedOutput();
  const program = new Command();
  const run = vi.fn(async () => true);
  const rewire = vi.fn(async () => true);
  const verify = vi.fn(async (): Promise<Verdict> => ({
    ok: true,
    checked: ['memnox@0.13.0'],
  }));
  const record = vi.fn(async () => undefined);
  registerUpdateCommand(program, new CliContext(out, plainStyle), {
    home: () => home,
    installed: () => '0.12.0',
    latest: async () => '0.13.0',
    install: () => installOf(NPM_ENTRY),
    confirm: async () => true,
    run,
    rewire,
    verify,
    record,
    now: () => new Date('2026-10-08T09:00:00Z'),
    ...overrides,
  });
  await program.parseAsync(args, { from: 'user' });
  return { out, run, rewire, verify, record };
}

describe('memnox update', () => {
  it('upgrades with the command for how it was installed, after a yes', async () => {
    const { out, run } = await update({});

    expect(out.text).toContain('0.12.0');
    expect(out.text).toContain('0.13.0');
    expect(run).toHaveBeenCalledWith(['npm', 'install', '-g', 'memnox@0.13.0']);
    expect(out.text).toContain('now 0.13.0');
  });

  it('rewires a machine that was set up, through the new install', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-update-kept-'));
    await keepBoundary(home, ['Claude Code']);
    const { rewire } = await update({ home: () => home });

    expect(rewire).toHaveBeenCalledOnce();
  });

  it('verifies the exact version before installing it, and keeps the line', async () => {
    const { out, run, verify, record } = await update({});

    expect(verify).toHaveBeenCalledWith('0.13.0');
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0] ?? 0,
    );
    expect(out.text).toContain('Verified');
    expect(record).toHaveBeenCalledWith(expect.any(String), {
      at: '2026-10-08T09:00:00.000Z',
      from: '0.12.0',
      to: '0.13.0',
      verified: true,
    });
  });

  it('refuses to install a release that fails verification, naming why', async () => {
    const exitCode = process.exitCode;
    const verify = vi.fn(async (): Promise<Verdict> => ({
      ok: false,
      reason:
        'memnox@0.13.0 was published without provenance, so nothing ties it to https://github.com/Memnox/memnox',
    }));
    const { out, run, rewire, record } = await update({ verify });
    const failed = process.exitCode;
    process.exitCode = exitCode;

    expect(run).not.toHaveBeenCalled();
    expect(rewire).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(failed).toBe(1);
    expect(out.text).toContain(
      'Memnox 0.13.0 was not installed, because memnox@0.13.0 was published without provenance, so nothing ties it to https://github.com/Memnox/memnox.',
    );
    expect(out.text).toContain('memnox update --skip-verify');
  });

  it('installs unverified only when told to, says so and records it', async () => {
    const { out, run, verify, record } = await update({}, ['update', '--skip-verify']);

    expect(verify).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(out.text).toContain('Not verified');
    expect(record).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ verified: false, to: '0.13.0' }),
    );
  });

  it('changes nothing when the person says no', async () => {
    const { out, run, rewire } = await update({ confirm: async () => false });

    expect(run).not.toHaveBeenCalled();
    expect(rewire).not.toHaveBeenCalled();
    expect(out.text).toContain('Nothing was changed');
  });

  it('updates without asking when told yes, as the Mac app does with no terminal', async () => {
    const confirm = vi.fn(async () => false);
    const { run } = await update({ confirm }, ['update', '--yes']);

    expect(confirm).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(['npm', 'install', '-g', 'memnox@0.13.0']);
  });

  it('says so offline, with the command to run by hand', async () => {
    const { out, run } = await update({ latest: async () => null });

    expect(run).not.toHaveBeenCalled();
    expect(out.text).toContain('could not be looked up');
    expect(out.text).toContain('npm install -g memnox@latest');
  });

  it('asks nothing when this is already the latest', async () => {
    const confirm = vi.fn(async () => true);
    const { out, run } = await update({ latest: async () => '0.12.0', confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(out.text).toContain('latest version');
  });

  it('prints the command rather than guessing where the install is unrecognised', async () => {
    const { out, run } = await update({
      install: () => installOf('/Users/ada/src/memnox/dist/index.js'),
    });

    expect(run).not.toHaveBeenCalled();
    expect(out.text).toContain('npm install -g memnox@latest');
  });

  it('rewires in place when the new install is asked to, leaving the rules alone', async () => {
    const wire = vi.fn(async () => ({ interceptors: 7 }) as Wiring);
    const { out } = await update({ wire }, ['update', '--rewire']);

    expect(wire).toHaveBeenCalledOnce();
    expect(out.text).toContain('7 interceptors');
  });
});

describe('how this copy was installed', () => {
  it('reads the method off the resolved path', () => {
    expect(installOf(NPM_ENTRY).method).toBe(INSTALL_METHOD.NPM);
    expect(
      installOf('/Users/ada/Library/pnpm/global/5/node_modules/memnox/dist/index.js'),
    ).toMatchObject({
      method: INSTALL_METHOD.PNPM,
      command: ['pnpm', 'add', '-g', 'memnox@latest'],
    });
    expect(
      installOf('/Users/ada/.npm/_npx/1a2b/node_modules/memnox/dist/index.js'),
    ).toMatchObject({
      method: INSTALL_METHOD.NPX,
      command: null,
    });
    expect(installOf('').method).toBe(INSTALL_METHOD.UNKNOWN);
  });

  it('pins the upgrade to the version that was verified', () => {
    expect(pinnedTo(['npm', 'install', '-g', 'memnox@latest'], '0.14.0')).toEqual([
      'npm',
      'install',
      '-g',
      'memnox@0.14.0',
    ]);
  });

  it('keeps each update as one owner only line', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-update-log-'));
    const line = {
      at: '2026-10-08T09:00:00.000Z',
      from: '0.12.0',
      to: '0.13.0',
      verified: false,
    };
    await recordUpdate(home, line);
    await recordUpdate(home, { ...line, verified: true });
    const path = join(home, '.memnox', 'updates.jsonl');
    const rows = (await readFile(path, 'utf8')).trim().split('\n');

    expect(rows.map((row) => JSON.parse(row) as unknown)).toEqual([
      line,
      { ...line, verified: true },
    ]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('compares versions as numbers', () => {
    expect(isNewer('0.13.0', '0.12.0')).toBe(true);
    expect(isNewer('0.12.10', '0.12.9')).toBe(true);
    expect(isNewer('0.12.0', '0.12.0')).toBe(false);
    expect(isNewer('0.11.9', '0.12.0')).toBe(false);
  });
});

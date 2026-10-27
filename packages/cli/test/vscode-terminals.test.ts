import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { CLI_VERSION } from '../src/defaults';
import {
  builtVersion,
  refreshVscodeTerminals,
  runVscodeTerminals,
  TERMINALS_EXTENSION,
  type TerminalsSeams,
} from '../src/protect/vscode-terminals';

const CODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';

/** Every call recorded; zip runs for real, so the package is the one an editor would get. */
async function seamsFor(calls: string[][]): Promise<TerminalsSeams> {
  const script = join(await mkdtemp(join(tmpdir(), 'memnox-vscode-script-')), 'e.js');
  await writeFile(script, 'exports.activate = () => {};\n');
  return {
    exists: (path) => path === CODE,
    script: () => script,
    run: (file, args, cwd) => {
      calls.push([file, ...args]);
      // The editor lists what it installed, which is how an install is believed.
      if (args[0] === '--list-extensions')
        return Promise.resolve({ ok: true, output: `${TERMINALS_EXTENSION}\n` });
      if (file !== '/usr/bin/zip') return Promise.resolve({ ok: true, output: '' });
      return new Promise((resolve) =>
        execFile(file, [...args], { cwd }, (error, out) =>
          resolve({ ok: error === null, output: out }),
        ),
      );
    },
  };
}

function installs(calls: readonly string[][]): string[][] {
  return calls.filter((each) => each[0] === CODE && each[1] === '--install-extension');
}

function listing(vsix: string): Promise<string> {
  return new Promise((resolve) =>
    execFile('/usr/bin/unzip', ['-Z1', vsix], (_error, out) => resolve(out)),
  );
}

describe('the extension that shows a session its own VS Code terminal', () => {
  it('packages itself and installs into the editors that are here', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-vscode-'));
    const calls: string[][] = [];
    const out = new RecordedOutput();
    await runVscodeTerminals(new CliContext(out), home, false, await seamsFor(calls));

    const install = calls.find((each) => each[0] === CODE);
    expect(install?.slice(1, 2)).toEqual(['--install-extension']);
    const vsix = install?.[2] ?? '';
    expect((await listing(vsix)).split('\n').sort()).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'extension.vsixmanifest',
        'extension/package.json',
        'extension/dist/extension.js',
      ]),
    );
  });

  it("finds an editor installed under the person's own Applications folder", async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-vscode-'));
    const own = join(
      home,
      'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    );
    const calls: string[][] = [];
    const seams = await seamsFor(calls);
    await runVscodeTerminals(new CliContext(new RecordedOutput()), home, false, {
      ...seams,
      exists: (path) => path === own,
    });
    expect(
      calls.some((each) => each[0] === own && each[1] === '--install-extension'),
    ).toBe(true);
  });

  it('puts itself in as the daemon starts only where the copy there is not the one it ships', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-vscode-'));
    const calls: string[][] = [];
    const seams = await seamsFor(calls);
    const extensions = join(home, '.vscode', 'extensions');
    await mkdir(join(extensions, `${TERMINALS_EXTENSION}-0.13.14`), { recursive: true });
    const said: string[] = [];
    await refreshVscodeTerminals(home, (line) => said.push(line), seams);
    expect(installs(calls)).toHaveLength(1);
    expect(said).toEqual([expect.stringContaining('put into VS Code')]);

    // This very build there now, as the editor unpacks it, so the next start changes nothing.
    const build = builtVersion(await readFile(seams.script() ?? '', 'utf8'));
    await mkdir(join(extensions, `${TERMINALS_EXTENSION}-${build}`), { recursive: true });
    calls.length = 0;
    await refreshVscodeTerminals(home, (line) => said.push(line), seams);
    expect(calls).toEqual([]);
  });

  it('puts itself back when the editor uninstalled it and left the folder behind', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-vscode-'));
    const calls: string[][] = [];
    const seams = await seamsFor(calls);
    const extensions = join(home, '.vscode', 'extensions');
    const folder = `${TERMINALS_EXTENSION}-0.13.14`;
    await mkdir(join(extensions, folder, 'dist'), { recursive: true });
    await writeFile(
      join(extensions, folder, 'dist', 'extension.js'),
      await readFile(seams.script() ?? '', 'utf8'),
    );
    await writeFile(
      join(extensions, '.obsolete'),
      JSON.stringify({ [folder]: true, 'someone.else-1.0.0': true }),
    );
    await refreshVscodeTerminals(home, () => undefined, seams);
    expect(installs(calls)).toHaveLength(1);
    // The removed copy goes with its mark, so the install is not made into a folder the editor wrote off.
    expect(existsSync(join(extensions, folder))).toBe(false);
    expect(JSON.parse(await readFile(join(extensions, '.obsolete'), 'utf8'))).toEqual({
      'someone.else-1.0.0': true,
    });
  });

  it('takes itself back out by its id', async () => {
    const calls: string[][] = [];
    const home = await mkdtemp(join(tmpdir(), 'memnox-vscode-'));
    await runVscodeTerminals(
      new CliContext(new RecordedOutput()),
      home,
      true,
      await seamsFor(calls),
    );
    expect(calls).toEqual([[CODE, '--uninstall-extension', TERMINALS_EXTENSION]]);
  });
});

describe('the version an extension build carries', () => {
  it('names each build apart, so a reinstall never lands in the folder the editor just marked removed', () => {
    const first = builtVersion('exports.activate = () => {};\n');
    expect(first.startsWith(`${CLI_VERSION}-`)).toBe(true);
    expect(builtVersion('exports.activate = () => {};\n')).toBe(first);
    expect(builtVersion('exports.activate = () => 1;\n')).not.toBe(first);
  });
});

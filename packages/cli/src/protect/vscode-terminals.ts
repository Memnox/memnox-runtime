import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMNOX_HOME } from '@memnox/core';
import type { CliContext } from '../cli-context';
import { CLI_VERSION } from '../defaults';

/**
 * The Memnox extension in VS Code and the editors built on it, which brings forward the
 * integrated terminal a session runs in. Those editors offer no AppleScript for their
 * terminals, so this is the only way the voice can take somebody to the right one.
 */

/** What the Mac opens a link to, and what an uninstall names. */
export const TERMINALS_EXTENSION = 'memnox.memnox-terminals';

/** Each editor by its app bundle and the CLI inside it, since none of them is on PATH by default, and where it keeps extensions. */
const EDITORS: readonly Editor[] = [
  {
    name: 'VS Code',
    app: 'Visual Studio Code.app',
    bin: 'Contents/Resources/app/bin/code',
    extensions: '.vscode/extensions',
  },
  {
    name: 'Cursor',
    app: 'Cursor.app',
    bin: 'Contents/Resources/app/bin/cursor',
    extensions: '.cursor/extensions',
  },
  {
    name: 'Windsurf',
    app: 'Windsurf.app',
    bin: 'Contents/Resources/app/bin/windsurf',
    extensions: '.windsurf/extensions',
  },
];

/** Where an app is installed: for everyone, or under the person's own home when they could not install it for everyone. */
const APP_FOLDERS = ['/Applications', 'Applications'] as const;

interface Editor {
  name: string;
  app: string;
  bin: string;
  /** Under the home folder, holding one folder per installed extension and version. */
  extensions: string;
}

/** An editor found on this Mac, with the path to its CLI. */
interface InstalledEditor extends Editor {
  cli: string;
}

/** The editors installed here, each with the CLI in whichever applications folder holds it. */
function installedEditors(home: string, seams: TerminalsSeams): InstalledEditor[] {
  return EDITORS.flatMap((each) => {
    const cli = APP_FOLDERS.map((folder) =>
      join(folder.startsWith('/') ? folder : join(home, folder), each.app, each.bin),
    ).find((path) => seams.exists(path));
    return cli === undefined ? [] : [{ ...each, cli }];
  });
}

const EDITOR_TIMEOUT_MS = 60_000;

export interface TerminalsSeams {
  /** Runs a program with no shell, and says whether it exited cleanly and what it printed. */
  run: (file: string, args: readonly string[], cwd?: string) => Promise<Ran>;
  exists: (path: string) => boolean;
  /** The extension's built script, which ships beside this command. */
  script: () => string | null;
}

interface Ran {
  ok: boolean;
  output: string;
}

interface EditorOutcome {
  editor: string;
  done: boolean;
  why?: string;
}

export async function runVscodeTerminals(
  context: CliContext,
  home: string,
  reverting: boolean,
  seams: TerminalsSeams = NODE_SEAMS,
): Promise<void> {
  const { flow } = context;
  flow.open(reverting ? 'memnox protect --revert-vscode' : 'memnox protect --vscode');
  const editors = installedEditors(home, seams);
  if (editors.length === 0) {
    flow.close('No VS Code, Cursor or Windsurf in /Applications, so nothing changed.');
    return;
  }
  const outcomes = reverting
    ? await Promise.all(editors.map((each) => uninstallFrom(each, seams)))
    : await installInto(editors, home, seams);
  render(context, outcomes, reverting);
}

/**
 * Puts the extension into every editor here whose installed copy is not the one this memnox ships,
 * run as the daemon starts, which it does after every update. An older copy answers for the Mac
 * and the voice then says typing failed when it went in, so nobody should have to run protect again.
 */
export async function refreshVscodeTerminals(
  home: string,
  log: (message: string) => void,
  seams: TerminalsSeams = NODE_SEAMS,
): Promise<void> {
  const script = seams.script();
  if (script === null) return;
  const shipped = await readFile(script, 'utf8').catch(() => null);
  if (shipped === null) return;
  const here = installedEditors(home, seams);
  const version = builtVersion(shipped);
  const held = await Promise.all(
    here.map((each) => holdsBuild(join(home, each.extensions), version)),
  );
  const behind = here.filter((_each, index) => held[index] !== true);
  if (behind.length === 0) return;
  for (const outcome of await installInto(behind, home, seams)) {
    log(
      outcome.done
        ? `The Memnox extension was put into ${outcome.editor}, so the voice can type into its terminals; a window already open takes it once its extensions restart.`
        : `The Memnox extension could not be put into ${outcome.editor}: ${outcome.why ?? ''}`,
    );
  }
}

/** The file an editor lists the extension folders it uninstalled in, until it next restarts. */
const OBSOLETE = '.obsolete';

/** Whether this exact build sits in the extensions folder and the editor has not written it off. */
async function holdsBuild(folder: string, version: string): Promise<boolean> {
  const name = `${TERMINALS_EXTENSION}-${version}`;
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.includes(name) && !(await obsolete(folder)).has(name);
}

/**
 * The folders an editor uninstalled but has not yet deleted, which it lists in `.obsolete` and
 * never loads, so a copy named there answers no link however exactly it matches.
 */
async function obsolete(folder: string): Promise<Set<string>> {
  const text = await readFile(join(folder, OBSOLETE), 'utf8').catch(() => null);
  if (text === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return new Set();
    return new Set(
      Object.entries(parsed)
        .filter(([, marked]) => marked === true)
        .map(([name]) => name),
    );
  } catch {
    return new Set();
  }
}

/** Every editor's row, then what changed for the voice, or that nothing did. */
function render(
  { flow, style }: CliContext,
  outcomes: readonly EditorOutcome[],
  reverting: boolean,
): void {
  const done = reverting ? 'removed' : 'installed';
  flow.rows(
    reverting ? 'Removed' : 'Installed',
    outcomes.map((each) => ({
      label: each.editor,
      value: each.done ? done : `not done: ${each.why ?? ''}`,
    })),
  );
  if (!outcomes.some((each) => each.done)) {
    flow.close(style.warn('Nothing changed.'));
    return;
  }
  if (reverting) {
    flow.close('The voice brings the editor forward again, without choosing a terminal.');
    return;
  }
  flow.close(
    'Asking the voice to go to a session now shows the very terminal it runs in.',
  );
  flow.hint('Reload any window already open, so it picks the extension up.');
  flow.hint('Undo with "memnox protect --revert-vscode".');
}

async function installInto(
  editors: readonly InstalledEditor[],
  home: string,
  seams: TerminalsSeams,
): Promise<EditorOutcome[]> {
  const packaged = await packageExtension(home, seams);
  if (typeof packaged !== 'string') {
    return editors.map((each) => ({ editor: each.name, done: false, why: packaged.why }));
  }
  return Promise.all(
    editors.map(async (each) => {
      await forgetRemovedCopies(join(home, each.extensions));
      const ran = await seams.run(each.cli, ['--install-extension', packaged, '--force']);
      if (!ran.ok) return { editor: each.name, done: false, why: lastLine(ran.output) };
      // An install the editor did not register answers no link, so only its own list is believed.
      const listed = await seams.run(each.cli, ['--list-extensions']);
      return listed.output.toLowerCase().includes(TERMINALS_EXTENSION)
        ? { editor: each.name, done: true }
        : { editor: each.name, done: false, why: NOT_REGISTERED };
    }),
  );
}

const NOT_REGISTERED =
  'the editor took the package but does not list it, so reload its windows and run memnox protect --vscode again';

/**
 * A copy of this extension the editor marked removed, deleted with its mark, since an install of the
 * same version lands in that folder and the editor goes on treating it as uninstalled.
 */
async function forgetRemovedCopies(folder: string): Promise<void> {
  const removed = await obsolete(folder);
  const ours = [...removed].filter((name) => name.startsWith(`${TERMINALS_EXTENSION}-`));
  if (ours.length === 0) return;
  for (const name of ours) await rm(join(folder, name), { recursive: true, force: true });
  const path = join(folder, OBSOLETE);
  const marks = await readFile(path, 'utf8').then(
    (text): unknown => JSON.parse(text),
    () => null,
  );
  if (typeof marks !== 'object' || marks === null) return;
  // Only this extension's own marks are taken out; every other extension's stay as the editor left them.
  const kept = Object.fromEntries(
    Object.entries(marks).filter(([name]) => !ours.includes(name)),
  );
  await writeFile(path, JSON.stringify(kept));
}

async function uninstallFrom(
  editor: InstalledEditor,
  seams: TerminalsSeams,
): Promise<EditorOutcome> {
  const ran = await seams.run(editor.cli, ['--uninstall-extension', TERMINALS_EXTENSION]);
  return ran.ok
    ? { editor: editor.name, done: true }
    : { editor: editor.name, done: false, why: lastLine(ran.output) };
}

/**
 * The extension as a `.vsix`, which is a zip of its manifest and files. Built here from the
 * script that ships with memnox, so the extension is always the version of the CLI beside it.
 */
async function packageExtension(
  home: string,
  seams: TerminalsSeams,
): Promise<string | { why: string }> {
  const script = seams.script();
  if (script === null) return { why: 'the extension was not built into this memnox' };
  const root = join(home, MEMNOX_HOME, 'vscode');
  const staging = join(root, 'staging');
  await rm(staging, { recursive: true, force: true });
  await mkdir(join(staging, 'extension', 'dist'), { recursive: true });
  await copyFile(script, join(staging, 'extension', 'dist', 'extension.js'));
  const version = builtVersion(await readFile(script, 'utf8'));
  await writeFile(
    join(staging, 'extension', 'package.json'),
    `${JSON.stringify(manifest(version), null, 2)}\n`,
  );
  await writeFile(join(staging, 'extension.vsixmanifest'), vsixManifest(version));
  await writeFile(join(staging, '[Content_Types].xml'), CONTENT_TYPES);
  const vsix = join(root, `memnox-terminals-${version}.vsix`);
  await rm(vsix, { force: true });
  const zipped = await seams.run('/usr/bin/zip', ['-r', '-X', '-q', vsix, '.'], staging);
  return zipped.ok ? vsix : { why: `zip failed: ${lastLine(zipped.output)}` };
}

/** How much of the script's digest names a build, enough that two builds never share a folder. */
const BUILD_DIGEST_CHARS = 8;

/**
 * The CLI version with the digest of the script and the manifest around it, so every build installs into a
 * folder of its own: reinstalling the same version lands in the folder the editor just marked removed, and
 * a manifest change alone, such as the windows it starts in, was never installed while only the script counted.
 */
export function builtVersion(script: string): string {
  const digest = createHash('sha256')
    .update(script)
    .update(JSON.stringify(manifest('')))
    .digest('hex')
    .slice(0, BUILD_DIGEST_CHARS);
  return `${CLI_VERSION}-${digest}`;
}

/** What VS Code reads as the extension's package.json: it runs in every window, quiet until a request names one of its terminals. */
function manifest(version: string): Record<string, unknown> {
  return {
    name: 'memnox-terminals',
    displayName: 'Memnox terminals',
    description:
      'Lets the Memnox voice bring forward the terminal a session runs in, and type a confirmed instruction into it.',
    publisher: 'memnox',
    version,
    license: 'Apache-2.0',
    engines: { vscode: '^1.74.0' },
    // Every window, once it has started, so the one holding a session's terminal is watching when words arrive for it.
    activationEvents: ['onUri', 'onStartupFinished'],
    main: './dist/extension.js',
  };
}

function vsixManifest(version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="memnox-terminals" Version="${version}" Publisher="memnox" />
    <DisplayName>Memnox terminals</DisplayName>
    <Description xml:space="preserve">Lets the Memnox voice bring forward the terminal a session runs in, and type a confirmed instruction into it.</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.74.0" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

function lastLine(output: string): string {
  const lines = output.split('\n').filter((line) => line.trim() !== '');
  return (lines[lines.length - 1] ?? 'it gave no reason').trim();
}

const NODE_SEAMS: TerminalsSeams = {
  run: (file, args, cwd) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        { timeout: EDITOR_TIMEOUT_MS, ...(cwd === undefined ? {} : { cwd }) },
        (error, stdout, stderr) =>
          resolve({ ok: error === null, output: `${stdout}${stderr}` }),
      );
    }),
  exists: existsSync,
  script: () => {
    const here = dirname(fileURLToPath(import.meta.url));
    return (
      ['vscode/extension.js', '../vscode/extension.js']
        .map((relative) => join(here, relative))
        .find((path) => existsSync(path)) ?? null
    );
  },
};

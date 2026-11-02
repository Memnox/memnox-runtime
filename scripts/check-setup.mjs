/**
 * Says what this machine is missing before the first `pnpm test`, so a newcomer reads one line
 * per gap rather than a red suite whose failures name nothing they could install.
 *
 * Every check is something a fresh clone has failed on: a Node outside the CI matrix, a pnpm that
 * misreads the lockfile, no Noise addon for this platform, no `zip` for the VS Code package, a
 * root user that makes the permission tests pass for the wrong reason, and native Windows, whose
 * suite CI does not hold green yet. It reads nothing outside the checkout and changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TESTED_NODE_MAJORS = [22, 24];
const MIN_NODE_MAJOR = 22;
const WINDOWS = process.platform === 'win32';

const gaps = [];
const notes = [];

function onPath(command) {
  try {
    execFileSync(WINDOWS ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  gaps.push(`Node ${process.versions.node} is too old; install Node 24 (see .nvmrc).`);
} else if (!TESTED_NODE_MAJORS.includes(nodeMajor)) {
  notes.push(
    `Node ${process.versions.node} is outside what CI tests (${TESTED_NODE_MAJORS.join(' and ')}); .nvmrc names 24.`,
  );
}

const { packageManager } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const wantedPnpm = String(packageManager).replace(/^pnpm@/, '');
const agent = process.env.npm_config_user_agent ?? '';
const runningPnpm = /pnpm\/(\S+)/.exec(agent)?.[1];
if (runningPnpm !== undefined && runningPnpm !== wantedPnpm) {
  gaps.push(
    `pnpm ${runningPnpm} is running but this repo pins ${wantedPnpm}; run corepack enable (npm install -g corepack first on Node 25 or later).`,
  );
}

if (!onPath('git'))
  gaps.push('git is not on PATH; on a fresh Mac run xcode-select --install.');

try {
  createRequire(import.meta.url)(join(ROOT, 'native', 'noise', 'index.js'));
} catch {
  gaps.push(
    'No Noise addon loads, so about forty pairing tests fail; install Rust from https://rustup.rs and run pnpm --filter @memnox/noise build.',
  );
}

if (!WINDOWS) {
  for (const tool of ['zip', 'unzip']) {
    if (!onPath(tool))
      gaps.push(`${tool} is not on PATH; the VS Code package tests need it.`);
  }
  if (process.getuid?.() === 0) {
    gaps.push(
      'Running as root makes the file permission tests pass whatever they check; use an ordinary user.',
    );
  }
} else {
  notes.push(
    'Native Windows builds and runs Memnox, but CI does not hold its test suite green yet; run the suite in WSL 2 for a result you can trust.',
  );
}

for (const note of notes) console.log(`note  ${note}`);
for (const gap of gaps) console.log(`fix   ${gap}`);
if (gaps.length === 0)
  console.log('ready  pnpm build && pnpm test should pass on this machine.');
process.exitCode = gaps.length === 0 ? 0 : 1;

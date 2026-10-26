/** Points every test at a throwaway home, so a seam a test forgot to inject never reaches the real one. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, sep } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'memnox-test-home-'));
process.env['HOME'] = home;
process.env['USERPROFILE'] = home;

// pnpm puts the workspace's own bins on PATH, so a build would read as `memnox-session` installed.
const workspaceBins = `${sep}node_modules${sep}.bin`;
process.env['PATH'] = (process.env['PATH'] ?? '')
  .split(delimiter)
  .filter((entry) => !entry.startsWith(process.cwd()) || !entry.endsWith(workspaceBins))
  .join(delimiter);

// Nothing in a test registers a personal space with the real control plane: this port answers nobody.
process.env['MEMNOX_CLOUD_URL'] = 'http://127.0.0.1:9';

// Registering a space hashes about a million times for the cloud's five zeros, which a slower machine
// cannot fit in a test's timeout; the proof is still made and checked, just against fewer.
process.env['MEMNOX_DEVICE_SPACE_WORK_ZEROS'] = '2';

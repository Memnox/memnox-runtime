import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  MEMNOX_HOME,
  parseConfig,
  renderConfig,
  type MemnoxConfig,
} from './config';
import { writeAtomic } from '../store/atomic-file';
import {
  APPROVAL_ROUTE,
  type ApprovalRoute,
} from '../constants/approval-route.constants';

/** Where this machine's own settings live, named here so nothing spells the path twice. */
export function configPathFor(home: string): string {
  return join(home, MEMNOX_HOME, CONFIG_FILE);
}

/**
 * First run writes the defaults; every run after that reads what is there. Rewriting
 * the file on each start would silently undo an edit somebody made on purpose.
 */
export async function loadOrCreateConfig(home: string): Promise<MemnoxConfig> {
  const path = configPathFor(home);
  try {
    return parseConfig(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // First run: the file does not exist yet, which is the one silent case here.
    await saveConfig(home, DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

/** Where questions go, from `config.toml`; in the session where nothing says otherwise. */
export async function readApprovalRoute(home: string): Promise<ApprovalRoute> {
  try {
    return parseConfig(await readFile(configPathFor(home), 'utf8')).approvals;
  } catch {
    return APPROVAL_ROUTE.SESSION;
  }
}

/** Whether the autopilot may grant, read without creating the file: off wherever it is unsaid. */
export async function readAutopilot(home: string): Promise<boolean> {
  try {
    return parseConfig(await readFile(configPathFor(home), 'utf8')).autopilot;
  } catch {
    return false;
  }
}

export async function saveConfig(home: string, config: MemnoxConfig): Promise<void> {
  const path = configPathFor(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeAtomic(path, renderConfig(config));
}

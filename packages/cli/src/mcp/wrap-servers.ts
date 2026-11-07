/** Routing every MCP server on this machine through the proxy, and putting them back. */
import { join } from 'node:path';
import { planUnwrap, planUpgrade, planWrap, type ServerLaunch } from '@memnox/core';
import type { CliContext } from '../cli-context';
import { TONE } from '../flow';
import { unwrapProjectLocally, wrapProjectLocally } from './project-overrides';
import {
  isProxyOnPath,
  readConfigs,
  writeRelaunches,
  type BinaryResolver,
  type ConfigFile,
} from './server-configs';

/** Where the local copies of a repository's servers are written. */
const CLAUDE_CONFIG = '.claude.json';

/**
 * Wraps what is there, silently, for `setup` to call rather than tell somebody to. Skipped
 * where the proxy is not on PATH, since wrapping onto a missing binary stops agents starting.
 */
export async function wrapEveryServer(
  home: string,
  project: string,
  resolveBinary?: BinaryResolver,
): Promise<{ wrapped: number; skipped: boolean; names: string[]; files: string[] }> {
  if (!isProxyOnPath(resolveBinary)) {
    return { wrapped: 0, skipped: true, names: [], files: [] };
  }
  // Named, so the daemon can say which server it just put through the proxy.
  const names: string[] = [];
  // And where, so the ledger row names the file that changed.
  const files: string[] = [];
  for (const file of await readConfigs(home, project)) {
    const done =
      file.shared === true
        ? await wrapShared(home, project, file)
        : await wrapOwn(home, file);
    names.push(...done);
    if (done.length > 0) {
      files.push(file.shared === true ? join(home, CLAUDE_CONFIG) : file.path);
    }
  }
  return { wrapped: names.length, skipped: false, names, files };
}

/** A config only this machine reads, rewritten in place. */
async function wrapOwn(home: string, file: ConfigFile): Promise<string[]> {
  const plan = planWrap(file.servers, file.agent);
  // And the lines wrapped without the agent's name, so a refusal elsewhere names it.
  const upgrades = planUpgrade(file.servers, file.agent);
  if (plan.wrap.length === 0 && upgrades.length === 0) return [];
  await writeRelaunches(home, file, [...plan.wrap, ...upgrades]);
  return plan.wrap.map((each) => each.name);
}

/**
 * Only a repository's own shared servers, behind the proxy through Claude Code's local scope, for
 * opening a project. Governing what the repository already gives changes nobody's reach.
 */
export async function wrapProjectServers(
  home: string,
  project: string,
  resolveBinary?: BinaryResolver,
): Promise<string[]> {
  if (!isProxyOnPath(resolveBinary)) return [];
  const names: string[] = [];
  for (const file of await readConfigs(home, project))
    if (file.shared === true) names.push(...(await wrapShared(home, project, file)));
  return names;
}

/**
 * A repository's own file, left as the team committed it: an older wrap in it is put back,
 * and its servers go behind the proxy as local copies only this machine reads.
 */
async function wrapShared(
  home: string,
  project: string,
  file: ConfigFile,
): Promise<string[]> {
  const originals = await putBack(home, file);
  return wrapProjectLocally(home, project, originals);
}

/**
 * Puts every wrapped server back and answers how many, for `uninstall` too. The original
 * command is read out of the wrapped entry rather than the backup, so it survives `--purge`.
 */
export async function unwrapEveryServer(
  home: string,
  project: string,
  context: CliContext,
): Promise<number> {
  let restored = 0;
  for (const file of await readConfigs(home, project)) {
    const { restore } = planUnwrap(file.servers);
    const local =
      file.shared === true
        ? await unwrapProjectLocally(home, project, await putBack(home, file))
        : [];
    if (restore.length === 0 && local.length === 0) continue;
    context.flow.list(file.path, [
      ...restore.map((each) => ({
        tone: TONE.OK,
        text: `${each.name}  proxy → ${each.after.command}`,
      })),
      ...local.map((name) => ({
        tone: TONE.OK,
        text: `${name}  local proxy copy removed`,
      })),
    ]);
    restored += restore.length + local.length;
    if (file.shared !== true && restore.length > 0) {
      await writeRelaunches(home, file, restore);
    }
  }
  return restored;
}

/** The file's servers as launched before any wrap, writing it back where one was found. */
async function putBack(
  home: string,
  file: ConfigFile,
): Promise<Record<string, ServerLaunch>> {
  const { restore } = planUnwrap(file.servers);
  if (restore.length === 0) return file.servers;
  await writeRelaunches(home, file, restore);
  return {
    ...file.servers,
    ...Object.fromEntries(restore.map((each) => [each.name, each.after])),
  };
}
